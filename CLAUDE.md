# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP (Model Context Protocol) server exposing Trafikverket (Swedish Transport Administration) open traffic data as tools, built on the Trafikinfo API (`https://api.trafikinfo.trafikverket.se/v2/data.json`). It covers train departures/arrivals, railway messages, road incidents and measured road weather. A free API key is required and is read from the `TRAFIKVERKET_API_KEY` environment variable on every request.

## Commands

```
npm install
npm run typecheck      # tsc --noEmit
npm test                # vitest run (all tests, single run)
npm run test:watch      # vitest (watch mode)
npm run test:coverage   # vitest run --coverage
npm run build            # tsc -> dist/
npm start                 # node dist/index.js
```

Run a single test file: `npx vitest run src/__tests__/tools.test.ts` Run tests matching a name: `npx vitest run -t "getRoadWeatherTool"`

CI (`.github/workflows/ci.yml`) runs on Node 20.x/22.x/24.x: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`. Match this locally before pushing.

## Architecture

**Request flow:** `src/index.ts` (MCP server, stdio transport) -> tool module in `src/tools/*.ts` (zod schema + handler) -> `src/trafikverket-client.ts` (builds the XML query, POSTs it, unwraps the JSON result) -> helpers (`stations.ts`, `counties.ts`, `geo.ts`).

**The Trafikinfo API** is not REST-like: every call is a `POST` of an XML `<REQUEST>` containing `<LOGIN authenticationkey=.../>` and one `<QUERY objecttype=... schemaversion=...>` with an optional `<FILTER>` (EQ, GT, GTE, LT, LTE, WITHIN, AND, OR), `<INCLUDE>` field list, `orderby` and `limit`. The `.json` URL suffix makes the response JSON: `{ RESPONSE: { RESULT: [ { <ObjectType>: [...] } ] } }`, or `{ ERROR: { SOURCE, MESSAGE } }` inside `RESULT[0]` on failure. Fields without a value are omitted, so every raw field is optional (see `src/types.ts`). Each object type has its own schema version, kept as constants next to the query that uses it:

| Tool | Object type | Schema version |
|------|-------------|----------------|
| `search_stations`, station resolution | TrainStation | 1.4 |
| `get_train_announcements` | TrainAnnouncement | 1.9 |
| `get_train_messages` | TrainMessage | 1.7 |
| `get_road_situations` | Situation | 1.5 |
| `get_road_weather` | WeatherObservation | 2 |

**Adding a new tool** touches these places:

1. `src/types.ts` - raw API types (all fields optional) and processed output types.
2. `src/tools/<name>.ts` - zod input schema (`z.object` with `.describe()` on each field) + async handler that builds the filter with the helpers from `trafikverket-client.ts`, calls `queryTrafikinfo<Raw>()` and shapes the result. Exports the schema, the handler, and the inferred input type.
3. `src/tools/index.ts` - re-export the new schema/handler/type.
4. `src/index.ts` - call `server.registerTool(name, { description, inputSchema, annotations: { title, ...READONLY_ANNOTATIONS } }, withErrorHandling(handler))`, passing the zod schema straight through as `inputSchema`.

Each tool module is a thin adapter: the SDK validates `inputSchema` automatically before the handler runs, and all HTTP and query-building logic lives in `trafikverket-client.ts`.

**Station resolution (`src/stations.ts`):** the full list of public train stations (TrainStation, `Advertised=true`) is fetched once per process and cached in memory (failures are not cached). Train announcements are filtered by `LocationSignature`, so tools accept either a signature or a name and resolve it with `resolveStation`: exact signature, exact name, then prefix/substring matches; a bare city name prefers "<city> C"; anything else ambiguous throws an error listing candidates. `stationNameMap` turns signatures in responses back into names and silently falls back to raw signatures if the station list cannot be loaded.

**Filtering strategy:** queries filter server-side where the API supports it (county, signature, time window, `WITHIN` radius), then the tools re-apply county/message-type/expiry filters client-side because a `Situation` can contain several deviations and only some may match. Tools that return many fields do not use `<INCLUDE>` (a wrong field name there is a hard API error); only the large station list does.

**Error handling:** all client functions throw `TrafikverketClientError` (with optional `statusCode`) for a missing API key, network failure, non-OK responses and API-level errors. Error messages never contain the API key. Each tool handler in `src/index.ts` is wrapped by `withErrorHandling`, which returns `{ content: [...], isError: true }` instead of throwing across the MCP boundary - never let an exception escape a `registerTool` handler.

**Units** (consistent across tools): temperature degrees Celsius, wind speed m/s, precipitation mm, humidity %, visibility metres, distances km, delays in minutes (positive = late). Times are ISO 8601 as returned by the API. Coordinates are WGS 84 (the API also offers SWEREF 99 TM, which this server does not use).

## Release process

Versioning and `CHANGELOG.md` are managed by [release-please](https://github.com/googleapis/release-please) (`.github/workflows/release-please.yml`), triggered on every push to `main`. It bumps `package.json`, updates `CHANGELOG.md`, and tags + creates a GitHub Release when its release PR is merged - no npm publish step. The server reports the version from `package.json` at runtime.

This depends on commit messages (or squash-merge PR titles) following [Conventional Commits](https://www.conventionalcommits.org/): `feat: ...` (minor bump), `fix: ...` (patch bump), `feat!: ...`/`BREAKING CHANGE:` footer (major bump), `chore:`/`docs:`/`refactor:`/`test:` (no bump, still changelogged). A plain, unprefixed commit message is treated as a chore.

## Testing conventions

Tests mock global `fetch` through `mockTrafikinfo()` in `src/__tests__/helpers.ts`, which answers each query from a fixture chosen by the `objecttype` in the request body and records the request bodies so tests can assert on the generated XML. Fixtures live in `src/__tests__/fixtures/`. Always call `resetStationCache()` in `beforeEach`/`afterEach` for tests that touch stations, and stub `TRAFIKVERKET_API_KEY` with `vi.stubEnv`.

**Important:** the fixtures were written by hand from Trafikverket's published schemas, not captured from the live API. When you have a real API key, verify these against live responses (and update the fixtures to real captures): the `WITHIN` filter syntax and the geometry field paths (`Deviation.Geometry.Point.WGS84`, `Deviation.Geometry.Line.WGS84`, `Measurepoint.Geometry.WGS84`), the `orderby` direction syntax (`LastUpdateDateTime desc`), ISO timestamps (with `Z`) in time-window filters, and the exact shape of the `WeatherObservation` measured values.

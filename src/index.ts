#!/usr/bin/env node

/**
 * Trafikverket MCP Server
 * Exposes Trafikverket (Swedish Transport Administration) open traffic data as MCP tools:
 * train departures/arrivals and disruptions, road incidents and road weather.
 */

import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import {
  searchStationsSchema,
  searchStationsTool,
  getTrainAnnouncementsSchema,
  getTrainAnnouncementsTool,
  getTrainMessagesSchema,
  getTrainMessagesTool,
  getRoadSituationsSchema,
  getRoadSituationsTool,
  getRoadWeatherSchema,
  getRoadWeatherTool,
} from './tools/index.js';

const COVERAGE_NOTE = 'Coverage: Sweden only (Trafikverket data).';

const ERROR_NOTE =
  'Returns an error result (isError: true) if TRAFIKVERKET_API_KEY is missing/invalid or the Trafikverket API is unreachable.';

const READONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const server = new McpServer({
  name: 'trafikverket-mcp-server',
  version: readVersion(),
});

/** Wraps a tool handler so any thrown error (e.g. TrafikverketClientError) surfaces as `Error: <message>` in an isError result. */
function withErrorHandling<Input, Output>(handler: (input: Input) => Promise<Output>) {
  return async (input: Input) => {
    try {
      const result = await handler(input);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  };
}

server.registerTool(
  'search_stations',
  {
    description:
      `Find Swedish train stations by name or location signature. Returns each station's display name, ` +
      `location signature (the short code used by the other train tools, e.g. "Cst" for Stockholm Central), ` +
      `county codes and coordinates; pass latitude/longitude to also get the distance to each match. ` +
      `Use this to look up the exact station before calling get_train_announcements when a name is ambiguous. ` +
      `${ERROR_NOTE} ${COVERAGE_NOTE}`,
    inputSchema: searchStationsSchema,
    annotations: {
      title: 'Search Train Stations',
      ...READONLY_ANNOTATIONS,
    },
  },
  withErrorHandling(searchStationsTool)
);

server.registerTool(
  'get_train_announcements',
  {
    description:
      `Get live train departures or arrivals at a Swedish station: train number, operator, product (e.g. ` +
      `"Pendeltåg"), origin/destination, platform (track), advertised vs. estimated/actual time, delay in ` +
      `minutes, cancellation and deviation notes. Accepts a station name (e.g. "Göteborg C", "Stockholm") or ` +
      `a location signature; an ambiguous name returns an error listing the candidates. Covers a window from ` +
      `minutesBack before now to hoursAhead after now. Use get_train_messages for broader disruption ` +
      `notices (track work, faults) instead of per-train data. Times are ISO 8601, delays in minutes ` +
      `(positive = late). ${ERROR_NOTE} ${COVERAGE_NOTE}`,
    inputSchema: getTrainAnnouncementsSchema,
    annotations: {
      title: 'Get Train Departures/Arrivals',
      ...READONLY_ANNOTATIONS,
    },
  },
  withErrorHandling(getTrainAnnouncementsTool)
);

server.registerTool(
  'get_train_messages',
  {
    description:
      `Get current railway traffic messages from Trafikverket: track work, technical faults and other ` +
      `disruptions, with event type, header, description, start/expected end time, and the affected ` +
      `stations/sections. Optionally filter by county. Use this for "is there a disruption on the railway" ` +
      `questions; use get_train_announcements for per-train timetable and delay data. ` +
      `${ERROR_NOTE} ${COVERAGE_NOTE}`,
    inputSchema: getTrainMessagesSchema,
    annotations: {
      title: 'Get Railway Traffic Messages',
      ...READONLY_ANNOTATIONS,
    },
  },
  withErrorHandling(getTrainMessagesTool)
);

server.registerTool(
  'get_road_situations',
  {
    description:
      `Get current road incidents and disruptions on the Swedish state road network: accidents, road works, ` +
      `obstacles, restrictions and traffic messages, each with severity (code 1-5, higher is more severe), road ` +
      `number, location, start/end time and coordinates. Filter by county and/or by a point plus radius ` +
      `(latitude, longitude, radiusKm); results are ordered by severity, then distance. Message types are ` +
      `Swedish, e.g. "Olycka" (accident) and "Vägarbete" (road work). Use get_road_weather for measured road ` +
      `conditions instead. ${ERROR_NOTE} ${COVERAGE_NOTE}`,
    inputSchema: getRoadSituationsSchema,
    annotations: {
      title: 'Get Road Incidents',
      ...READONLY_ANNOTATIONS,
    },
  },
  withErrorHandling(getRoadSituationsTool)
);

server.registerTool(
  'get_road_weather',
  {
    description:
      `Get measured road weather from Trafikverket's roadside stations nearest to a point: air temperature ` +
      `(°C), humidity (%), dew point (°C), visibility (m), wind speed (m/s) and direction (degrees), road ` +
      `surface temperature (°C), grip, ice/snow/water on the road, and precipitation and wind over the last 10 ` +
      `minutes. These are actual observations, not a forecast; use a forecast source such as SMHI for future ` +
      `weather. ${ERROR_NOTE} ${COVERAGE_NOTE}`,
    inputSchema: getRoadWeatherSchema,
    annotations: {
      title: 'Get Road Weather Observations',
      ...READONLY_ANNOTATIONS,
    },
  },
  withErrorHandling(getRoadWeatherTool)
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Trafikverket MCP server running on stdio');
}

main().catch(console.error);

# Trafikverket MCP Server

MCP server for [Trafikverket](https://www.trafikverket.se) (the Swedish Transport Administration) open traffic data: live train departures and arrivals, live train positions, railway disruptions, replacement traffic for cancelled trains, road incidents and measured road weather. Built on Trafikverket's open **Trafikinfo** API.

## Features

- **search_stations** - Find train stations by name or location signature
- **get_train_announcements** - Live departures or arrivals at a station, with delays, platforms and cancellations
- **get_train_positions** - Live GPS position, speed and bearing of a train by number, or of all trains around a point
- **get_train_messages** - Current railway traffic messages (track work, faults, disruptions), optionally per county
- **get_replacement_traffic** - Replacement buses and taxis for cancelled trains, with stops, boarding locations and times
- **get_railway_events** - Railway events (faults, failures, disruptions) with reason code, status and affected sections, by station, status or related operative event
- **get_road_situations** - Current road incidents: accidents, road works, obstacles and restrictions, by county and/or around a point
- **get_road_weather** - Measured road weather (air and road surface temperature, wind, grip, precipitation) from the nearest roadside stations

## Coverage

Sweden only (Trafikverket's state road and railway network).

## Requirements

A free Trafikverket API key. Create one in the [Trafikverket data portal](https://data.trafikverket.se) and provide it to the server in the `TRAFIKVERKET_API_KEY` environment variable. The server starts without a key, but every tool returns an error until one is set.

## Installation

### Claude Code

Add to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "trafikverket": {
      "command": "node",
      "args": ["/path/to/trafikverket-mcp-server/dist/index.js"],
      "env": {
        "TRAFIKVERKET_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Desktop

Add the same `trafikverket` entry under `mcpServers` in `claude_desktop_config.json`.

### Build from source

```bash
npm install
npm run build
```

## Usage Examples

### Next departures from Stockholm Central

```
Tool: get_train_announcements
Input: { "station": "Stockholm", "hoursAhead": 2 }
```

### Arrivals in Göteborg, including trains that arrived 30 minutes ago

```
Tool: get_train_announcements
Input: { "station": "Göteborg C", "direction": "arrivals", "minutesBack": 30 }
```

### Find the exact station before querying

```
Tool: search_stations
Input: { "query": "Hässleholm" }
```

### Where is train 421 right now?

```
Tool: get_train_positions
Input: { "trainNumber": "421" }
```

### Trains within 5 km of Göteborg C

```
Tool: get_train_positions
Input: { "latitude": 57.7089, "longitude": 11.9732, "radiusKm": 5 }
```

### Railway disruptions in Skåne

```
Tool: get_train_messages
Input: { "county": "Skåne" }
```

### Replacement buses from Lund C

```
Tool: get_replacement_traffic
Input: { "station": "Lund C" }
```

### What replaces train 1043 today?

```
Tool: get_replacement_traffic
Input: { "trainNumber": "1043" }
```

### Ongoing railway events around Hässleholm

```
Tool: get_railway_events
Input: { "station": "Hässleholm C" }
```

### Accidents within 30 km of Gothenburg

```
Tool: get_road_situations
Input: { "latitude": 57.7089, "longitude": 11.9746, "radiusKm": 30, "messageType": "Olycka" }
```

### Road weather near Skövde

```
Tool: get_road_weather
Input: { "latitude": 58.3912, "longitude": 13.8453 }
```

## API Reference

### search_stations

Find train stations by name (diacritics and case are ignored) or location signature.

| Parameter | Type   | Required | Default | Description                                        |
|-----------|--------|----------|---------|----------------------------------------------------|
| query     | string | Yes      | -       | Station name, part of a name, or signature         |
| limit     | number | No       | 10      | 1-25                                               |
| latitude  | number | No       | -       | With longitude: include distance to each match     |
| longitude | number | No       | -       | With latitude: include distance to each match      |

Returns `name`, `signature`, `shortName`, `counties`, coordinates and optionally `distanceKm` per station.

### get_train_announcements

Live departures or arrivals at one station. Accepts a station name or a location signature; an ambiguous name returns an error listing the candidates (a bare city name such as "Stockholm" resolves to the central station "Stockholm C").

| Parameter   | Type   | Required | Default      | Description                                                 |
|-------------|--------|----------|--------------|-------------------------------------------------------------|
| station     | string | Yes      | -            | Station name or location signature                          |
| direction   | string | No       | `departures` | `departures` or `arrivals`                                  |
| minutesBack | number | No       | 15           | 0-120, minutes before now to include                        |
| hoursAhead  | number | No       | 2            | 0.25-12, hours after now to include                         |
| limit       | number | No       | 25           | 1-100                                                       |

Returns per train: train number, operator, product, origin and destination names, track, advertised/estimated/actual time, `delayMinutes` (positive = late), `canceled`, deviation notes and other information.

### get_train_positions

Live GPS positions of trains. Give a train number, a point to search around, or both.

| Parameter     | Type   | Required | Default | Description                                                         |
|---------------|--------|----------|---------|---------------------------------------------------------------------|
| trainNumber   | string | No*      | -       | Advertised or operational train number, e.g. `"421"`                |
| latitude      | number | No*      | -       | Center of a radius search (requires longitude)                      |
| longitude     | number | No*      | -       | Center of a radius search (requires latitude)                       |
| radiusKm      | number | No       | 10      | 0.5-100                                                             |
| maxAgeMinutes | number | No       | 10      | 1-60, ignore positions reported longer ago                          |
| limit         | number | No       | 25      | 1-100                                                               |

\* At least `trainNumber` or `latitude`/`longitude` is required.

Returns per train (newest report only): train number, departure date, coordinates, `distanceKm` (radius searches, nearest first), `speedKmh`, `bearingDegrees` (direction of travel), `active`, report `timestamp` and `ageMinutes`.

### get_train_messages

Current railway traffic messages (Trafikverket operative events): track work, faults and other disruptions.

| Parameter  | Type            | Required | Default | Description                                              |
|------------|-----------------|----------|---------|----------------------------------------------------------|
| county     | string / number | No       | -       | County name (e.g. `"Skåne"`) or code (e.g. `12`)         |
| activeOnly | boolean         | No       | true    | Only ongoing events                                      |
| limit      | number          | No       | 20      | 1-100                                                    |

Returns event type, header, description (when a public message has been published), start/end/expected end, and the affected stations and sections.

### get_replacement_traffic

Replacement traffic (ersättningstrafik) reported by the train operators: the bus, coach or taxi trips that run instead of cancelled trains. Not every replacement is reported, so check `get_train_announcements` for which trains are cancelled.

| Parameter   | Type   | Required | Default | Description                                                                          |
|-------------|--------|----------|---------|--------------------------------------------------------------------------------------|
| station     | string | No       | -       | Only trips stopping here (station name or location signature)                        |
| trainNumber | string | No       | -       | Only trips replacing this advertised train number                                    |
| date        | string | No       | -       | Departure date of the replaced train (`YYYY-MM-DD`); searches the whole day instead of the time window |
| minutesBack | number | No       | 30      | 0-240, include trips running or departing this many minutes before now               |
| hoursAhead  | number | No       | 12      | 0.5-48, include trips departing up to this many hours after now                      |
| limit       | number | No       | 20      | 1-50                                                                                 |

Returns per trip: replaced trains (number, date, product), `vehicleMode` (`bus`, `coach`, `taxi`, ...), `status` (`planned`, `ordered`, `confirmed`, `running`, `finished`, `canceled`), vehicle identifier, `wheelchairAccessible`, `toilet`, origin/destination, departure/arrival time and every stop in order with stop description (where to board), coordinates, planned/expected/actual arrival and departure, `delayMinutes`, `disembarkingOnly`, traveller note and connecting stations. With `station`, the stop there is also returned as `atStation` and trips are ordered by the time at that stop.

### get_railway_events

Railway events (Trafikverket `RailwayEvent`): faults, failures and disruptions registered in Trafikverket's event system, including cause-coded events that never became a public traffic message. Deleted events are never returned.

| Parameter        | Type    | Required | Default | Description                                                                                       |
|------------------|---------|----------|---------|---------------------------------------------------------------------------------------------------|
| station          | string  | No       | -       | Station name or signature; matches sections that start, end, pass via or include it              |
| status           | string  | No       | -       | `Ingen`, `MöjligOperativHändelse`, `BedömdEjOperativHändelse` or `OperativHändelse`              |
| operativeEventId | string  | No       | -       | Related operative event id (the `eventId` from `get_train_messages`)                             |
| activeOnly       | boolean | No       | true    | Only events without an end time or with an end time in the future                                |
| limit            | number  | No       | 20      | 1-100                                                                                             |

Returns per event (most recently modified first): `eventId`, `status`, `reasonCode`, `operativeEventId`, `active`, start/end/created/last updated time, `version`, the affected `sections` (`from`, `via`, `to` and ordered `intermediate` stations) and a flat list of all `locations`.

### get_road_situations

Current incidents on the state road network.

| Parameter   | Type            | Required | Default | Description                                                                        |
|-------------|-----------------|----------|---------|------------------------------------------------------------------------------------|
| county      | string / number | No       | -       | County name or code                                                                |
| latitude    | number          | No       | -       | Center of a radius search (requires longitude)                                     |
| longitude   | number          | No       | -       | Center of a radius search (requires latitude)                                      |
| radiusKm    | number          | No       | 25      | 0.5-200                                                                            |
| messageType | string          | No       | -       | Swedish message type as used by Trafikverket, e.g. `"Olycka"`, `"Vägarbete"`       |
| limit       | number          | No       | 25      | 1-100                                                                              |

Results are ordered by severity (code 1-5, higher is more severe), then distance. Each entry has message, type, severity, road number and name, location, start/end time, restrictions and coordinates.

### get_road_weather

Observations from the nearest roadside weather stations (not a forecast).

| Parameter | Type   | Required | Default | Description                            |
|-----------|--------|----------|---------|----------------------------------------|
| latitude  | number | Yes      | -       | -90 to 90                              |
| longitude | number | Yes      | -       | -180 to 180                            |
| radiusKm  | number | No       | 25      | 1-100                                  |
| limit     | number | No       | 3       | 1-20 nearest stations                  |

Returns per station: name, distance, sample time, air temperature (°C), humidity (%), dew point (°C), visibility (m), wind (m/s, degrees), road surface temperature (°C), grip, ice/snow/water flags, and precipitation and wind over the last 10 minutes.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Tests mock `fetch` and run against JSON fixtures, so no API key is needed.

## Data Source

Data from Trafikverket's open [Trafikinfo API](https://data.trafikverket.se), published as open data (CC0 according to the API documentation). Please check Trafikverket's current terms before redistributing data at scale.

## License

MIT

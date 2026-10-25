# Trafikverket MCP Server

MCP server for [Trafikverket](https://www.trafikverket.se) (the Swedish Transport Administration) open traffic data: live train departures and arrivals, railway disruptions, road incidents and measured road weather. Built on Trafikverket's open **Trafikinfo** API.

## Features

- **search_stations** - Find train stations by name or location signature
- **get_train_announcements** - Live departures or arrivals at a station, with delays, platforms and cancellations
- **get_train_messages** - Current railway traffic messages (track work, faults, disruptions), optionally per county
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

### Railway disruptions in Skåne

```
Tool: get_train_messages
Input: { "county": "Skåne" }
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

### get_train_messages

Current railway traffic messages (Trafikverket operative events): track work, faults and other disruptions.

| Parameter  | Type            | Required | Default | Description                                              |
|------------|-----------------|----------|---------|----------------------------------------------------------|
| county     | string / number | No       | -       | County name (e.g. `"Skåne"`) or code (e.g. `12`)         |
| activeOnly | boolean         | No       | true    | Only ongoing events                                      |
| limit      | number          | No       | 20      | 1-100                                                    |

Returns event type, header, description (when a public message has been published), start/end/expected end, and the affected stations and sections.

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

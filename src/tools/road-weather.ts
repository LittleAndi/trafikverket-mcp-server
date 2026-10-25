import { z } from 'zod';
import { distanceKm, parseWgs84Point, round1, validateCoordinates } from '../geo.js';
import { and, gte, queryTrafikinfo, within } from '../trafikverket-client.js';
import type { RawWeatherObservation, RoadWeatherStation } from '../types.js';

export const getRoadWeatherSchema = z.object({
  latitude: z.number().min(-90).max(90).describe('Latitude of the point to find road weather stations near'),
  longitude: z.number().min(-180).max(180).describe('Longitude of the point to find road weather stations near'),
  radiusKm: z
    .number()
    .min(1)
    .max(100)
    .default(25)
    .describe('Search radius in kilometres (1-100, default 25)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(3)
    .describe('Number of nearest stations to return (1-20, default 3)'),
});

/**
 * WeatherObservation keeps 7 days of history; without a time window a large radius exceeds the API's
 * maximum response size. Stations report every few minutes, so this window still covers all of them.
 */
const OBSERVATION_WINDOW_MS = 2 * 60 * 60 * 1000;

export type GetRoadWeatherInput = z.infer<typeof getRoadWeatherSchema>;

export function toRoadWeatherStation(
  raw: RawWeatherObservation,
  origin: { latitude: number; longitude: number }
): RoadWeatherStation {
  const point = parseWgs84Point(raw.Measurepoint?.Geometry?.WGS84);
  const surface = raw.Surface;
  const aggregated = raw.Aggregated10minutes;

  return {
    id: raw.Measurepoint?.Id,
    name: raw.Measurepoint?.Name,
    latitude: point?.latitude,
    longitude: point?.longitude,
    distanceKm: point ? round1(distanceKm(origin, point)) : undefined,
    sampleTime: raw.Sample,
    airTemperatureC: raw.Air?.Temperature?.Value,
    humidityPercent: raw.Air?.RelativeHumidity?.Value,
    dewpointC: raw.Air?.Dewpoint?.Value,
    visibilityMeters: raw.Air?.VisibleDistance?.Value,
    wind: (raw.Wind ?? []).map((w) => ({ directionDegrees: w.Direction?.Value, speedMs: w.Speed?.Value })),
    surface: surface
      ? {
          temperatureC: surface.Temperature?.Value,
          grip: surface.Grip?.Value,
          ice: surface.Ice,
          snow: surface.Snow,
          water: surface.Water,
          iceDepthMm: surface.IceDepth?.Value,
          waterDepthMm: surface.WaterDepth?.Value,
        }
      : undefined,
    last10min: aggregated
      ? {
          rain: aggregated.Precipitation?.Rain,
          snow: aggregated.Precipitation?.Snow,
          precipitationMm: aggregated.Precipitation?.TotalWaterEquivalent?.Value,
          windAverageMs: aggregated.Wind?.SpeedAverage?.Value,
          windMaxMs: aggregated.Wind?.SpeedMax?.Value,
        }
      : undefined,
    precipitationType: raw.Weather?.Precipitation,
  };
}

export async function getRoadWeatherTool(input: GetRoadWeatherInput) {
  validateCoordinates(input.latitude, input.longitude);
  const origin = { latitude: input.latitude, longitude: input.longitude };

  const raw = await queryTrafikinfo<RawWeatherObservation>({
    namespace: 'Road.WeatherInfo',
    objectType: 'WeatherObservation',
    schemaVersion: '2.1',
    filter: and(
      within('Measurepoint.Geometry.WGS84', origin.longitude, origin.latitude, input.radiusKm * 1000),
      gte('Sample', new Date(Date.now() - OBSERVATION_WINDOW_MS).toISOString())
    ),
    orderBy: 'Sample desc',
  });

  // Keep only the newest observation per measurepoint, then take the nearest stations.
  const latest = new Map<string, RawWeatherObservation>();
  for (const observation of raw) {
    const key = String(observation.Measurepoint?.Id ?? observation.Measurepoint?.Name ?? observation.Id);
    const existing = latest.get(key);
    if (!existing || Date.parse(observation.Sample ?? '') > Date.parse(existing.Sample ?? '')) {
      latest.set(key, observation);
    }
  }

  const stations = [...latest.values()]
    .map((o) => toRoadWeatherStation(o, origin))
    .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
    .slice(0, input.limit);

  return {
    center: origin,
    radiusKm: input.radiusKm,
    count: stations.length,
    stations,
  };
}

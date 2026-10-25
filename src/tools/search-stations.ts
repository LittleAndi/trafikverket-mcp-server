import { z } from 'zod';
import { findStations, getStations } from '../stations.js';
import { distanceKm, round1 } from '../geo.js';

export const searchStationsSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe('Station name or part of it (e.g. "Göteborg", "Lund"), or a location signature (e.g. "Cst")'),
  limit: z.number().int().min(1).max(25).default(10).describe('Maximum number of stations to return (1-25)'),
  latitude: z.number().min(-90).max(90).optional().describe('Optional: latitude, to include distance to each match'),
  longitude: z.number().min(-180).max(180).optional().describe('Optional: longitude, to include distance to each match'),
});

export type SearchStationsInput = z.infer<typeof searchStationsSchema>;

export async function searchStationsTool(input: SearchStationsInput) {
  const stations = await getStations();
  const origin =
    input.latitude !== undefined && input.longitude !== undefined
      ? { latitude: input.latitude, longitude: input.longitude }
      : undefined;

  const matches = findStations(stations, input.query).slice(0, input.limit);

  return {
    query: input.query,
    count: matches.length,
    stations: matches.map((s) => ({
      name: s.name,
      signature: s.signature,
      shortName: s.shortName,
      counties: s.counties,
      latitude: s.latitude,
      longitude: s.longitude,
      distanceKm:
        origin && s.latitude !== undefined && s.longitude !== undefined
          ? round1(distanceKm(origin, { latitude: s.latitude, longitude: s.longitude }))
          : undefined,
    })),
  };
}

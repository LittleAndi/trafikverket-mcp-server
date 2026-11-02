import { z } from 'zod';
import { TrafikverketClientError } from '../errors.js';
import { distanceKm, parseWgs84Point, round1, validateCoordinates, type LatLon } from '../geo.js';
import { and, eq, gte, or, queryTrafikinfo, within } from '../trafikverket-client.js';
import type { RawTrainPosition, TrainPosition } from '../types.js';

export const getTrainPositionsSchema = z.object({
  trainNumber: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Train number to locate, e.g. "421" (matched against both the advertised and the operational train number)'
    ),
  latitude: z
    .number()
    .min(-90)
    .max(90)
    .optional()
    .describe('Latitude of the centre of a radius search (requires longitude)'),
  longitude: z
    .number()
    .min(-180)
    .max(180)
    .optional()
    .describe('Longitude of the centre of a radius search (requires latitude)'),
  radiusKm: z.number().min(0.5).max(100).default(10).describe('Search radius in kilometres (0.5-100, default 10)'),
  maxAgeMinutes: z
    .number()
    .int()
    .min(1)
    .max(60)
    .default(10)
    .describe('Ignore positions reported longer ago than this many minutes (1-60, default 10)'),
  limit: z.number().int().min(1).max(100).default(25).describe('Maximum number of trains to return (1-100)'),
});

export type GetTrainPositionsInput = z.infer<typeof getTrainPositionsSchema>;

/** Rough bounding box of Sweden, used to detect a swapped coordinate order. */
const inSweden = (p: LatLon) => p.latitude >= 54 && p.latitude <= 70 && p.longitude >= 9 && p.longitude <= 26;

/**
 * Parses `Position.WGS84`, a 3D WKT point. The TrainPosition 1.1 schema documents X Y Z order (longitude
 * first), but OperativeEvent publishes "POINT (lat lon)" despite its schema, so the order is still checked
 * against Sweden's bounds (the latitude and longitude ranges there do not overlap) and swapped if needed.
 */
export function parseTrainPoint(wkt: string | undefined): LatLon | undefined {
  const point = parseWgs84Point(wkt);
  if (!point || inSweden(point)) return point;
  const swapped = { latitude: point.longitude, longitude: point.latitude };
  return inSweden(swapped) ? swapped : point;
}

export function toTrainPosition(raw: RawTrainPosition, now: number, origin?: LatLon): TrainPosition {
  const point = parseTrainPoint(raw.Position?.WGS84);
  const measured = raw.TimeStamp ? Date.parse(raw.TimeStamp) : NaN;
  return {
    train: raw.Train?.AdvertisedTrainNumber ?? raw.Train?.OperationalTrainNumber,
    operationalTrainNumber: raw.Train?.OperationalTrainNumber,
    departureDate: raw.Train?.OperationalTrainDepartureDate,
    latitude: point?.latitude,
    longitude: point?.longitude,
    distanceKm: origin && point ? round1(distanceKm(origin, point)) : undefined,
    speedKmh: raw.Speed,
    bearingDegrees: raw.Bearing,
    active: raw.Status?.Active,
    timestamp: raw.TimeStamp,
    ageMinutes: Number.isNaN(measured) ? undefined : round1(Math.max(0, now - measured) / 60_000),
  };
}

export async function getTrainPositionsTool(input: GetTrainPositionsInput) {
  const hasLat = input.latitude !== undefined;
  const hasLon = input.longitude !== undefined;
  if (hasLat !== hasLon) {
    throw new TrafikverketClientError('latitude and longitude must be given together');
  }
  if (!input.trainNumber && !hasLat) {
    throw new TrafikverketClientError('Give a trainNumber, a latitude/longitude to search around, or both');
  }

  let origin: LatLon | undefined;
  if (input.latitude !== undefined && input.longitude !== undefined) {
    validateCoordinates(input.latitude, input.longitude);
    origin = { latitude: input.latitude, longitude: input.longitude };
  }

  const now = Date.now();
  const raw = await queryTrafikinfo<RawTrainPosition>({
    namespace: 'järnväg.trafikinfo',
    objectType: 'TrainPosition',
    schemaVersion: '1.1',
    filter: and(
      input.trainNumber
        ? or(
            eq('Train.AdvertisedTrainNumber', input.trainNumber),
            eq('Train.OperationalTrainNumber', input.trainNumber)
          )
        : undefined,
      origin ? within('Position.WGS84', origin.longitude, origin.latitude, input.radiusKm * 1000) : undefined,
      gte('TimeStamp', new Date(now - input.maxAgeMinutes * 60_000).toISOString())
    ),
    orderBy: 'TimeStamp desc',
  });

  // Keep only the newest report per train run (the schema's key is operational number + departure date).
  const latest = new Map<string, RawTrainPosition>();
  for (const position of raw) {
    if (position.Deleted) continue;
    const train = position.Train;
    const key = `${train?.OperationalTrainNumber ?? train?.AdvertisedTrainNumber}|${train?.OperationalTrainDepartureDate}`;
    const existing = latest.get(key);
    if (!existing || Date.parse(position.TimeStamp ?? '') > Date.parse(existing.TimeStamp ?? '')) {
      latest.set(key, position);
    }
  }

  const trains = [...latest.values()]
    .map((p) => toTrainPosition(p, now, origin))
    .sort((a, b) =>
      origin
        ? (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
        : Date.parse(b.timestamp ?? '') - Date.parse(a.timestamp ?? '')
    )
    .slice(0, input.limit);

  return {
    trainNumber: input.trainNumber,
    center: origin,
    radiusKm: origin ? input.radiusKm : undefined,
    count: trains.length,
    trains,
  };
}

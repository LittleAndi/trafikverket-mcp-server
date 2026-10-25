import { z } from 'zod';
import { resolveCounty } from '../counties.js';
import { distanceKm, parseWgs84Point, round1, validateCoordinates } from '../geo.js';
import { TrafikverketClientError } from '../errors.js';
import { and, eq, or, queryTrafikinfo, within } from '../trafikverket-client.js';
import type { RawDeviation, RawSituation, RoadSituation } from '../types.js';

export const getRoadSituationsSchema = z.object({
  county: z
    .union([z.string(), z.number()])
    .optional()
    .describe('Optional county filter: Swedish county name (e.g. "Stockholm", "Västra Götaland") or code (e.g. 14)'),
  latitude: z
    .number()
    .min(-90)
    .max(90)
    .optional()
    .describe('Optional latitude of a point to search around (use together with longitude)'),
  longitude: z
    .number()
    .min(-180)
    .max(180)
    .optional()
    .describe('Optional longitude of a point to search around (use together with latitude)'),
  radiusKm: z
    .number()
    .min(0.5)
    .max(200)
    .default(25)
    .describe('Search radius in kilometres around latitude/longitude (0.5-200, default 25)'),
  messageType: z
    .string()
    .optional()
    .describe('Optional message type filter, in Swedish as used by Trafikverket, e.g. "Olycka" (accident) or "Vägarbete" (road work)'),
  limit: z.number().int().min(1).max(100).default(25).describe('Maximum number of situations to return (1-100)'),
});

export type GetRoadSituationsInput = z.infer<typeof getRoadSituationsSchema>;

export function toRoadSituation(
  deviation: RawDeviation,
  situationId: string | undefined,
  origin?: { latitude: number; longitude: number }
): RoadSituation {
  const point = parseWgs84Point(deviation.Geometry?.Point?.WGS84);
  return {
    id: deviation.Id,
    situationId,
    header: deviation.Header,
    message: deviation.Message,
    messageType: deviation.MessageType,
    messageCode: deviation.MessageCode,
    severity: deviation.SeverityText,
    severityCode: deviation.SeverityCode,
    roadNumber: deviation.RoadNumber,
    roadName: deviation.RoadName,
    locationDescriptor: deviation.LocationDescriptor,
    positionalDescription: deviation.PositionalDescription,
    trafficRestriction: deviation.TrafficRestrictionType,
    temporaryLimit: deviation.TemporaryLimit,
    lanesRestricted: deviation.NumberOfLanesRestricted,
    affectedDirection: deviation.AffectedDirection,
    startTime: deviation.StartTime,
    endTime: deviation.EndTime,
    validUntilFurtherNotice: deviation.ValidUntilFurtherNotice,
    counties: deviation.CountyNo ?? [],
    point,
    lineWgs84: deviation.Geometry?.Line?.WGS84,
    distanceKm: origin && point ? round1(distanceKm(origin, point)) : undefined,
    webLink: deviation.WebLink,
  };
}

export async function getRoadSituationsTool(input: GetRoadSituationsInput) {
  const hasLat = input.latitude !== undefined;
  const hasLon = input.longitude !== undefined;
  if (hasLat !== hasLon) {
    throw new TrafikverketClientError('Provide both latitude and longitude, or neither');
  }

  const county = input.county !== undefined ? resolveCounty(input.county) : undefined;
  const origin = hasLat && hasLon ? { latitude: input.latitude as number, longitude: input.longitude as number } : undefined;
  if (origin) validateCoordinates(origin.latitude, origin.longitude);

  const radiusMeters = input.radiusKm * 1000;

  const raw = await queryTrafikinfo<RawSituation>({
    objectType: 'Situation',
    schemaVersion: '1.5',
    filter: and(
      county !== undefined ? eq('Deviation.CountyNo', county) : undefined,
      input.messageType ? eq('Deviation.MessageType', input.messageType) : undefined,
      origin
        ? or(
            within('Deviation.Geometry.Point.WGS84', origin.longitude, origin.latitude, radiusMeters),
            within('Deviation.Geometry.Line.WGS84', origin.longitude, origin.latitude, radiusMeters)
          )
        : undefined
    ),
    limit: input.limit,
  });

  const now = Date.now();
  const situations = raw
    .flatMap((situation) => (situation.Deviation ?? []).map((d) => toRoadSituation(d, situation.Id, origin)))
    // A situation can carry several deviations; keep only those matching the requested filters and still in force.
    .filter((s) => county === undefined || s.counties.includes(county))
    .filter((s) => !input.messageType || s.messageType === input.messageType)
    .filter((s) => s.validUntilFurtherNotice === true || !s.endTime || Date.parse(s.endTime) > now)
    .sort(
      (a, b) =>
        (b.severityCode ?? 0) - (a.severityCode ?? 0) ||
        (a.distanceKm ?? 0) - (b.distanceKm ?? 0) ||
        Date.parse(b.startTime ?? '') - Date.parse(a.startTime ?? '') ||
        0
    )
    .slice(0, input.limit);

  return {
    county,
    center: origin,
    radiusKm: origin ? input.radiusKm : undefined,
    count: situations.length,
    situations,
  };
}

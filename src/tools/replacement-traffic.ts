import { z } from 'zod';
import { resolveStation, stationNameMap } from '../stations.js';
import { and, eq, gte, lte, or, queryTrafikinfo } from '../trafikverket-client.js';
import type {
  RawList,
  RawReplacementStop,
  RawReplacementTraffic,
  ReplacementStop,
  ReplacementTrip,
} from '../types.js';

export const getReplacementTrafficSchema = z.object({
  station: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Only trips stopping at this station: name (e.g. "Lund C", "Malmö") or location signature (e.g. "Lu")'),
  trainNumber: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Only trips replacing this advertised train number, e.g. "1043"'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
    .optional()
    .describe(
      'Departure date (YYYY-MM-DD) of the replaced train. When set, the whole day is searched and minutesBack/hoursAhead are ignored'
    ),
  minutesBack: z
    .number()
    .int()
    .min(0)
    .max(240)
    .default(30)
    .describe('Include trips still running or departing up to this many minutes before now (0-240, default 30)'),
  hoursAhead: z
    .number()
    .min(0.5)
    .max(48)
    .default(12)
    .describe('Include trips departing up to this many hours after now (0.5-48, default 12)'),
  limit: z.number().int().min(1).max(50).default(20).describe('Maximum number of trips to return (1-50)'),
});

export type GetReplacementTrafficInput = z.infer<typeof getReplacementTrafficSchema>;

/**
 * Namespace and schema version for ReplacementTraffic, from the live schema catalogue. The query is written from
 * the v1 XSD and not yet verified against the live API (check https://data.trafikverket.se/apb/prod/schema?endpoint= if it starts failing).
 */
export const REPLACEMENT_TRAFFIC_NAMESPACE = 'JBS';
export const REPLACEMENT_TRAFFIC_SCHEMA_VERSION = '1.0';

const STOP = 'Stops.Stop';
const REPLACES = 'ReplacesTrains.ReplacesTrain';

/** Unwraps an XSD list element, which the JSON response may give as `{ Item: [...] }`, `{ Item: {...} }` or `[...]`. */
export function listOf<T>(value: RawList<string, T> | undefined, key: string): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  const inner = (value as Record<string, T[] | T | undefined>)[key];
  if (inner === undefined) return [];
  return Array.isArray(inner) ? inner : [inner];
}

const time = (value: string | undefined) => (value ? Date.parse(value) : NaN);

function minutesBetween(planned: string | undefined, actual: string | undefined): number | undefined {
  const p = time(planned);
  const a = time(actual);
  return Number.isNaN(p) || Number.isNaN(a) ? undefined : Math.round((a - p) / 60_000);
}

/** Best known departure time at a stop (actual, expected, planned), falling back to arrival for the last stop. */
function stopTime(stop: ReplacementStop): string | undefined {
  return (
    stop.actualDeparture ??
    stop.expectedDeparture ??
    stop.plannedDeparture ??
    stop.actualArrival ??
    stop.expectedArrival ??
    stop.plannedArrival
  );
}

export function toReplacementStop(raw: RawReplacementStop, names: Map<string, string>): ReplacementStop {
  const location = raw.StopPosition?.Location;
  const resolve = (signature: string) => names.get(signature) ?? signature;
  const departureDelay = minutesBetween(raw.PlannedDepartureTime, raw.VehicleStopDeparture ?? raw.ExpectedDepartureTime);
  return {
    name: raw.PlaceSignature ? resolve(raw.PlaceSignature) : raw.StopDescription,
    signature: raw.PlaceSignature,
    stopDescription: raw.StopDescription,
    destination: raw.AdvertisedDestination,
    latitude: location?.Latitude,
    longitude: location?.Longitude,
    plannedArrival: raw.PlannedArrivalTime,
    expectedArrival: raw.ExpectedArrivalTime,
    actualArrival: raw.VehicleStopArrival,
    plannedDeparture: raw.PlannedDepartureTime,
    expectedDeparture: raw.ExpectedDepartureTime,
    actualDeparture: raw.VehicleStopDeparture,
    delayMinutes:
      departureDelay ?? minutesBetween(raw.PlannedArrivalTime, raw.VehicleStopArrival ?? raw.ExpectedArrivalTime),
    disembarkingOnly: raw.DisembarkingOnly,
    note: raw.TravellerNote?.trim() || undefined,
    connectsTo: listOf(raw.ConnectingStops, 'ConnectingStop')
      .map((c) => c.PlaceSignature)
      .filter((s): s is string => Boolean(s))
      .map(resolve),
  };
}

export function toReplacementTrip(
  raw: RawReplacementTraffic,
  names: Map<string, string>,
  stationSignature?: string
): ReplacementTrip {
  const stops = listOf(raw.Stops, 'Stop')
    .map((stop, index) => ({ stop, order: stop.Sequence ?? index }))
    .sort((a, b) => a.order - b.order)
    .map(({ stop }) => toReplacementStop(stop, names));
  const first = stops[0];
  const last = stops.at(-1);

  return {
    id: raw.Id,
    source: raw.Source,
    description: raw.Description?.trim() || undefined,
    vehicleMode: raw.VehicleMode,
    vehicleIdentifier: raw.VehicleIdentifier,
    status: raw.Status,
    wheelchairAccessible: raw.WheelChair,
    toilet: raw.Toilet,
    replacesTrains: listOf(raw.ReplacesTrains, 'ReplacesTrain').map((t) => ({
      train: t.AdvertisedTrainIdent,
      departureDate: t.ScheduledDepartureDate,
      product: t.ProductInformation,
    })),
    from: first?.name,
    to: stops.length > 1 ? last?.name : undefined,
    departureTime: first ? stopTime(first) : undefined,
    arrivalTime:
      stops.length > 1 && last ? (last.actualArrival ?? last.expectedArrival ?? last.plannedArrival ?? stopTime(last)) : undefined,
    atStation: stationSignature ? stops.find((s) => s.signature?.toLowerCase() === stationSignature.toLowerCase()) : undefined,
    stops,
    lastUpdated: raw.ModifiedTime,
  };
}

/** Matches trips with at least one stop whose planned departure or arrival satisfies `compare`. */
function anyStopTime(compare: typeof gte, value: string): string {
  return or(compare(`${STOP}.PlannedDepartureTime`, value), compare(`${STOP}.PlannedArrivalTime`, value));
}

export async function getReplacementTrafficTool(input: GetReplacementTrafficInput) {
  const station = input.station ? await resolveStation(input.station) : undefined;

  const now = Date.now();
  // Planned times can be well before the expected ones when a trip is delayed, so the server-side window gets
  // an extra hour of slack; the exact window is applied below on the best known times.
  const slackMs = 3_600_000;
  const from = new Date(now - input.minutesBack * 60_000);
  const to = new Date(now + input.hoursAhead * 3_600_000);

  const raw = await queryTrafikinfo<RawReplacementTraffic>({
    namespace: REPLACEMENT_TRAFFIC_NAMESPACE,
    objectType: 'ReplacementTraffic',
    schemaVersion: REPLACEMENT_TRAFFIC_SCHEMA_VERSION,
    filter: and(
      station ? eq(`${STOP}.PlaceSignature`, station.signature) : undefined,
      input.trainNumber ? eq(`${REPLACES}.AdvertisedTrainIdent`, input.trainNumber) : undefined,
      input.date ? eq(`${REPLACES}.ScheduledDepartureDate`, input.date) : undefined,
      input.date ? undefined : anyStopTime(gte, new Date(from.getTime() - slackMs).toISOString()),
      input.date ? undefined : anyStopTime(lte, new Date(to.getTime() + slackMs).toISOString())
    ),
  });

  const names = await stationNameMap();

  const trips = raw
    .filter((trip) => !trip.Deleted)
    .map((trip) => toReplacementTrip(trip, names, station?.signature))
    .filter((trip) => {
      if (station && !trip.atStation) return false;
      if (input.trainNumber && !trip.replacesTrains.some((t) => t.train === input.trainNumber)) return false;
      if (input.date) {
        const date = input.date;
        return trip.replacesTrains.some((t) => t.departureDate?.startsWith(date));
      }
      // At a station: when the vehicle is there. Otherwise: the trip overlaps the window.
      const start = time(trip.atStation ? stopTime(trip.atStation) : trip.departureTime);
      const end = time(trip.atStation ? stopTime(trip.atStation) : (trip.arrivalTime ?? trip.departureTime));
      if (Number.isNaN(start) || Number.isNaN(end)) return true;
      return end >= from.getTime() && start <= to.getTime();
    })
    .sort((a, b) => {
      const at = (t: ReplacementTrip) => time(t.atStation ? stopTime(t.atStation) : t.departureTime);
      return (at(a) || Infinity) - (at(b) || Infinity);
    });

  return {
    station: station ? { name: station.name, signature: station.signature } : undefined,
    trainNumber: input.trainNumber,
    date: input.date,
    window: input.date ? undefined : { from: from.toISOString(), to: to.toISOString() },
    count: Math.min(trips.length, input.limit),
    totalMatches: trips.length,
    trips: trips.slice(0, input.limit),
  };
}


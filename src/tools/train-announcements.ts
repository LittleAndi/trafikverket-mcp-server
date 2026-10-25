import { z } from 'zod';
import { resolveStation, stationNameMap } from '../stations.js';
import { and, eq, gte, lte, queryTrafikinfo } from '../trafikverket-client.js';
import type { RawLocationRef, RawTrainAnnouncement, TrainAnnouncement } from '../types.js';

export const getTrainAnnouncementsSchema = z.object({
  station: z
    .string()
    .min(1)
    .describe('Station name (e.g. "Göteborg C", "Stockholm") or location signature (e.g. "G", "Cst")'),
  direction: z
    .enum(['departures', 'arrivals'])
    .default('departures')
    .describe('"departures" (default) or "arrivals" at the station'),
  minutesBack: z
    .number()
    .int()
    .min(0)
    .max(120)
    .default(15)
    .describe('How many minutes back from now to include, so just-left or delayed trains show up (0-120)'),
  hoursAhead: z
    .number()
    .min(0.25)
    .max(12)
    .default(2)
    .describe('How many hours ahead of now to include (0.25-12)'),
  limit: z.number().int().min(1).max(100).default(25).describe('Maximum number of trains to return (1-100)'),
});

export type GetTrainAnnouncementsInput = z.infer<typeof getTrainAnnouncementsSchema>;

const ACTIVITY = { departures: 'Avgang', arrivals: 'Ankomst' } as const;

function descriptions(items: Array<{ Description?: string; Code?: string }> | undefined): string[] {
  return (items ?? []).map((i) => i.Description ?? i.Code).filter((d): d is string => Boolean(d));
}

function locationNames(items: RawLocationRef[] | undefined, names: Map<string, string>): string[] {
  return [...(items ?? [])]
    .sort((a, b) => (a.Priority ?? 0) - (b.Priority ?? 0) || (a.Order ?? 0) - (b.Order ?? 0))
    .map((l) => l.LocationName)
    .filter((n): n is string => Boolean(n))
    .map((signature) => names.get(signature) ?? signature);
}

/** Minutes between the advertised time and the best known actual/estimated time (positive = late). */
function delayMinutes(raw: RawTrainAnnouncement): number | undefined {
  const advertised = raw.AdvertisedTimeAtLocation ? Date.parse(raw.AdvertisedTimeAtLocation) : NaN;
  const actualOrEstimated = raw.TimeAtLocation ?? raw.EstimatedTimeAtLocation;
  const actual = actualOrEstimated ? Date.parse(actualOrEstimated) : NaN;
  if (Number.isNaN(advertised) || Number.isNaN(actual)) return undefined;
  return Math.round((actual - advertised) / 60_000);
}

export function toTrainAnnouncement(raw: RawTrainAnnouncement, names: Map<string, string>): TrainAnnouncement {
  return {
    train: raw.AdvertisedTrainIdent,
    direction: raw.ActivityType === 'Avgang' ? 'departure' : raw.ActivityType === 'Ankomst' ? 'arrival' : undefined,
    operator: raw.Operator,
    product: descriptions(raw.ProductInformation)[0],
    trafficType: descriptions(raw.TypeOfTraffic)[0],
    from: locationNames(raw.FromLocation, names),
    to: locationNames(raw.ToLocation, names),
    track: raw.TrackAtLocation,
    advertisedTime: raw.AdvertisedTimeAtLocation,
    estimatedTime: raw.EstimatedTimeAtLocation,
    estimatedTimeIsPreliminary: raw.EstimatedTimeIsPreliminary,
    actualTime: raw.TimeAtLocation,
    delayMinutes: delayMinutes(raw),
    canceled: raw.Canceled === true,
    deviations: descriptions(raw.Deviation),
    otherInformation: descriptions(raw.OtherInformation),
  };
}

export async function getTrainAnnouncementsTool(input: GetTrainAnnouncementsInput) {
  const station = await resolveStation(input.station);

  const now = Date.now();
  const from = new Date(now - input.minutesBack * 60_000);
  const to = new Date(now + input.hoursAhead * 3_600_000);

  const raw = await queryTrafikinfo<RawTrainAnnouncement>({
    objectType: 'TrainAnnouncement',
    schemaVersion: '1.9',
    filter: and(
      eq('LocationSignature', station.signature),
      eq('ActivityType', ACTIVITY[input.direction]),
      eq('Advertised', true),
      gte('AdvertisedTimeAtLocation', from.toISOString()),
      lte('AdvertisedTimeAtLocation', to.toISOString())
    ),
    orderBy: 'AdvertisedTimeAtLocation',
    limit: input.limit,
  });

  const names = await stationNameMap();

  return {
    station: { name: station.name, signature: station.signature },
    direction: input.direction,
    window: { from: from.toISOString(), to: to.toISOString() },
    count: raw.length,
    announcements: raw.map((r) => toTrainAnnouncement(r, names)),
  };
}

import { z } from 'zod';
import { resolveStation, stationNameMap } from '../stations.js';
import { and, eq, exists, gt, or, queryTrafikinfo } from '../trafikverket-client.js';
import type { RailwayEvent, RawRailwayEvent } from '../types.js';

export const RAILWAY_EVENT_STATUSES = [
  'Ingen',
  'MöjligOperativHändelse',
  'BedömdEjOperativHändelse',
  'OperativHändelse',
] as const;

export const getRailwayEventsSchema = z.object({
  station: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional station name (e.g. "Hässleholm C") or location signature (e.g. "Hm"); only events whose ' +
        'sections start, end, pass via or include this location are returned'
    ),
  status: z
    .enum(RAILWAY_EVENT_STATUSES)
    .optional()
    .describe(
      'Optional event status filter: "Ingen" (only cause-coded), "MöjligOperativHändelse" (possible operative ' +
        'event), "BedömdEjOperativHändelse" (assessed as not operative) or "OperativHändelse" (operative event)'
    ),
  operativeEventId: z
    .string()
    .min(1)
    .optional()
    .describe('Optional id of an operative event (the eventId from get_train_messages) to list its railway events'),
  activeOnly: z
    .boolean()
    .default(true)
    .describe('Only include events that have not ended yet (no end time, or an end time in the future; default true)'),
  limit: z.number().int().min(1).max(100).default(20).describe('Maximum number of events to return (1-100)'),
});

export type GetRailwayEventsInput = z.infer<typeof getRailwayEventsSchema>;

/** Every location path in a RailwayEvent section that a station filter should match. */
const LOCATION_FIELDS = [
  'SelectedSection.FromLocation.Signature',
  'SelectedSection.ToLocation.Signature',
  'SelectedSection.ViaLocation.Signature',
  'SelectedSection.IntermediateLocation.Signature',
];

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function toRailwayEvent(raw: RawRailwayEvent, names: Map<string, string>, now = Date.now()): RailwayEvent {
  const resolve = (signature: string | undefined) => (signature ? (names.get(signature) ?? signature) : undefined);

  const sections = (raw.SelectedSection ?? []).map((section) => ({
    from: resolve(section.FromLocation?.Signature),
    to: resolve(section.ToLocation?.Signature),
    via: resolve(section.ViaLocation?.Signature),
    intermediate: [...(section.IntermediateLocation ?? [])]
      .sort((a, b) => (a.LocationOrder ?? 0) - (b.LocationOrder ?? 0))
      .map((l) => resolve(l.Signature))
      .filter((n): n is string => Boolean(n)),
  }));

  const end = raw.EndDateTime ? Date.parse(raw.EndDateTime) : NaN;
  const start = raw.StartDateTime ? Date.parse(raw.StartDateTime) : NaN;

  return {
    eventId: raw.EventId,
    status: raw.EventStatus,
    reasonCode: raw.ReasonCode,
    operativeEventId: raw.OperativeEventId,
    active: !(start > now) && !(end <= now),
    startTime: raw.StartDateTime,
    endTime: raw.EndDateTime,
    createdTime: raw.CreatedDateTime,
    lastUpdated: raw.ModifiedDateTime,
    version: raw.Version,
    sections,
    locations: unique(
      sections
        .flatMap((s) => [s.from, s.via, ...s.intermediate, s.to])
        .filter((n): n is string => Boolean(n))
    ),
  };
}

export async function getRailwayEventsTool(input: GetRailwayEventsInput) {
  const station = input.station !== undefined ? await resolveStation(input.station) : undefined;
  const now = new Date();

  const raw = await queryTrafikinfo<RawRailwayEvent>({
    namespace: 'ols.open',
    objectType: 'RailwayEvent',
    schemaVersion: '1.0',
    filter: and(
      eq('Deleted', false),
      station ? or(...LOCATION_FIELDS.map((field) => eq(field, station.signature))) : undefined,
      input.status ? eq('EventStatus', input.status) : undefined,
      input.operativeEventId ? eq('OperativeEventId', input.operativeEventId) : undefined,
      input.activeOnly ? or(exists('EndDateTime', false), gt('EndDateTime', now.toISOString())) : undefined
    ),
    orderBy: 'ModifiedDateTime desc',
    limit: input.limit,
  });

  const names = await stationNameMap();
  // Re-check the end time client-side in case the server-side time filter lets an ended event through.
  const events = raw
    .filter((e) => !input.activeOnly || !e.EndDateTime || Date.parse(e.EndDateTime) > now.getTime())
    .map((e) => toRailwayEvent(e, names, now.getTime()));

  return {
    station: station ? { name: station.name, signature: station.signature } : undefined,
    count: events.length,
    events,
  };
}

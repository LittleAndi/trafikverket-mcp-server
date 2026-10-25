import { z } from 'zod';
import { resolveCounty } from '../counties.js';
import { stationNameMap } from '../stations.js';
import { and, eq, queryTrafikinfo } from '../trafikverket-client.js';
import type { RawOperativeEvent, TrainMessage } from '../types.js';

export const getTrainMessagesSchema = z.object({
  county: z
    .union([z.string(), z.number()])
    .optional()
    .describe('Optional county filter: Swedish county name (e.g. "Skåne", "Västra Götaland") or county code (e.g. 14)'),
  activeOnly: z
    .boolean()
    .default(true)
    .describe('Only include messages that have not ended yet (default true)'),
  limit: z.number().int().min(1).max(100).default(20).describe('Maximum number of messages to return (1-100)'),
});

export type GetTrainMessagesInput = z.infer<typeof getTrainMessagesSchema>;

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/** Latest of a list of ISO timestamps, or undefined if there are none. */
function latest(times: Array<string | undefined>): string | undefined {
  return times
    .filter((t): t is string => Boolean(t))
    .reduce<string | undefined>((max, t) => (!max || Date.parse(t) > Date.parse(max) ? t : max), undefined);
}

export function toTrainMessage(raw: RawOperativeEvent, names: Map<string, string>): TrainMessage {
  const impact = raw.TrafficImpact ?? [];
  const sections = raw.EventSection ?? [];
  const resolve = (signature: string) => names.get(signature) ?? signature;
  const signatures = (values: Array<string | undefined>) =>
    unique(values.filter((s): s is string => Boolean(s)).map(resolve));

  // An event can carry several public messages over its lifetime; the most recently modified one is current.
  const messages = impact.map((i) => i.PublicMessage).filter((m) => m !== undefined);
  const current = messages.find((m) => m.ModifiedDateTime === latest(messages.map((x) => x.ModifiedDateTime))) ?? messages[0];

  return {
    eventId: raw.OperativeEventId,
    eventType: raw.EventType?.Description,
    header: current?.Header,
    description: current?.Description?.trim(),
    active: raw.EventState === 1,
    startTime: raw.StartDateTime,
    endTime: raw.EndDateTime,
    expectedEndTime: latest(impact.map((i) => i.EndDateTime)),
    lastUpdated: raw.ModifiedDateTime,
    counties: raw.CountyNo ?? [],
    affectedLocations: signatures(
      impact.flatMap((i) =>
        (i.SelectedSection ?? []).flatMap((section) =>
          (section.SectionLocation ?? []).filter((l) => l.Affected).map((l) => l.Signature)
        )
      )
    ),
    fromLocations: signatures(sections.map((section) => section.FromLocation?.Signature)),
    toLocations: signatures(sections.map((section) => section.ToLocation?.Signature)),
  };
}

export async function getTrainMessagesTool(input: GetTrainMessagesInput) {
  const county = input.county !== undefined ? resolveCounty(input.county) : undefined;

  // TrainMessage was retired; railway disruptions and track work are published as OperativeEvent.
  const raw = await queryTrafikinfo<RawOperativeEvent>({
    namespace: 'ols.open',
    objectType: 'OperativeEvent',
    schemaVersion: '1.0',
    filter: and(
      county !== undefined ? eq('CountyNo', county) : undefined,
      input.activeOnly ? eq('EventState', 1) : undefined
    ),
    orderBy: 'ModifiedDateTime desc',
    limit: input.limit,
  });

  const names = await stationNameMap();

  return {
    county,
    count: raw.length,
    messages: raw.map((m) => toTrainMessage(m, names)),
  };
}

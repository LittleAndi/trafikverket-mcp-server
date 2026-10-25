import { z } from 'zod';
import { resolveCounty } from '../counties.js';
import { stationNameMap } from '../stations.js';
import { eq, queryTrafikinfo } from '../trafikverket-client.js';
import type { RawTrainMessage, TrainMessage } from '../types.js';

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

export function toTrainMessage(raw: RawTrainMessage, names: Map<string, string>): TrainMessage {
  const impact = raw.TrafficImpact ?? [];
  const resolve = (signature: string) => names.get(signature) ?? signature;

  return {
    eventId: raw.EventId,
    header: raw.Header,
    description: raw.ExternalDescription,
    startTime: raw.StartDateTime,
    endTime: raw.EndDateTime,
    expectedEndTime: raw.PrognosticatedEndDateTimeTrafficImpact,
    lastUpdated: raw.LastUpdateDateTime,
    counties: raw.CountyNo ?? [],
    reasons: (raw.ReasonCode ?? []).map((r) => r.Description ?? r.Code).filter((d): d is string => Boolean(d)),
    affectedLocations: unique(
      impact.flatMap((i) => (i.AffectedLocation ?? []).map((l) => l.LocationSignature)).filter((s): s is string => Boolean(s)).map(resolve)
    ),
    fromLocations: unique(impact.flatMap((i) => i.FromLocation ?? []).map(resolve)),
    toLocations: unique(impact.flatMap((i) => i.ToLocation ?? []).map(resolve)),
  };
}

export async function getTrainMessagesTool(input: GetTrainMessagesInput) {
  const county = input.county !== undefined ? resolveCounty(input.county) : undefined;

  const raw = await queryTrafikinfo<RawTrainMessage>({
    objectType: 'TrainMessage',
    schemaVersion: '1.7',
    filter: county !== undefined ? eq('CountyNo', county) : undefined,
    orderBy: 'LastUpdateDateTime desc',
    limit: input.limit,
  });

  const now = Date.now();
  const current = input.activeOnly
    ? raw.filter((m) => !m.EndDateTime || Date.parse(m.EndDateTime) > now)
    : raw;

  const names = await stationNameMap();

  return {
    county,
    count: current.length,
    messages: current.map((m) => toTrainMessage(m, names)),
  };
}

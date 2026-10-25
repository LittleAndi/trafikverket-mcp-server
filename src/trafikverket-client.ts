import { TrafikverketClientError } from './errors.js';

/** Trafikinfo v2 endpoint; the `.json` suffix selects JSON responses instead of XML. */
export const API_URL = 'https://api.trafikinfo.trafikverket.se/v2/data.json';
export const API_KEY_ENV = 'TRAFIKVERKET_API_KEY';
const REQUEST_TIMEOUT_MS = 20_000;

export interface QuerySpec {
  /** Object type, e.g. "TrainAnnouncement". */
  objectType: string;
  /** Schema version for that object type, e.g. "1.9". */
  schemaVersion: string;
  /** Pre-built filter body (see the filter helpers below); wrapped in <FILTER> automatically. */
  filter?: string;
  /** Restrict the response to these fields (<INCLUDE>); omit to get every field. */
  include?: string[];
  /** Sort order, e.g. "AdvertisedTimeAtLocation" or "LastUpdateDateTime desc". */
  orderBy?: string;
  limit?: number;
}

/* ---------- XML helpers ---------- */

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

type FilterValue = string | number | boolean;

function comparison(tag: string, name: string, value: FilterValue): string {
  return `<${tag} name="${escapeXml(name)}" value="${escapeXml(String(value))}" />`;
}

export const eq = (name: string, value: FilterValue) => comparison('EQ', name, value);
export const gt = (name: string, value: FilterValue) => comparison('GT', name, value);
export const gte = (name: string, value: FilterValue) => comparison('GTE', name, value);
export const lt = (name: string, value: FilterValue) => comparison('LT', name, value);
export const lte = (name: string, value: FilterValue) => comparison('LTE', name, value);

/** Matches objects whose WGS 84 point/geometry field lies within `radiusMeters` of the given point. */
export function within(name: string, longitude: number, latitude: number, radiusMeters: number): string {
  return (
    `<WITHIN name="${escapeXml(name)}" shape="center" ` +
    `value="${longitude} ${latitude}" radius="${Math.round(radiusMeters)}m" />`
  );
}

function combine(tag: 'AND' | 'OR', parts: Array<string | undefined>): string {
  const present = parts.filter((part): part is string => Boolean(part));
  if (present.length === 0) return '';
  // A single child needs no wrapper (and wrapping one child is easy to get wrong).
  if (present.length === 1) return present[0];
  return `<${tag}>${present.join('')}</${tag}>`;
}

export const and = (...parts: Array<string | undefined>) => combine('AND', parts);
export const or = (...parts: Array<string | undefined>) => combine('OR', parts);

/** Builds the full <REQUEST> document for a single query. */
export function buildRequestXml(apiKey: string, spec: QuerySpec): string {
  const attributes = [
    `objecttype="${escapeXml(spec.objectType)}"`,
    `schemaversion="${escapeXml(spec.schemaVersion)}"`,
  ];
  if (spec.orderBy) attributes.push(`orderby="${escapeXml(spec.orderBy)}"`);
  if (spec.limit !== undefined) attributes.push(`limit="${Math.trunc(spec.limit)}"`);

  const filter = spec.filter ? `<FILTER>${spec.filter}</FILTER>` : '';
  const include = (spec.include ?? []).map((field) => `<INCLUDE>${escapeXml(field)}</INCLUDE>`).join('');

  return (
    `<REQUEST>` +
    `<LOGIN authenticationkey="${escapeXml(apiKey)}" />` +
    `<QUERY ${attributes.join(' ')}>${filter}${include}</QUERY>` +
    `</REQUEST>`
  );
}

/* ---------- Transport ---------- */

function getApiKey(): string {
  const key = process.env[API_KEY_ENV]?.trim();
  if (!key) {
    throw new TrafikverketClientError(
      `${API_KEY_ENV} is not set. Create a free API key in the Trafikverket data portal ` +
        `(https://data.trafikverket.se) and pass it to the server as the ${API_KEY_ENV} environment variable.`
    );
  }
  return key;
}

function extractApiError(body: unknown): string | undefined {
  const result = (body as { RESPONSE?: { RESULT?: Array<Record<string, unknown>> } } | undefined)?.RESPONSE
    ?.RESULT?.[0];
  const error = result?.ERROR as { MESSAGE?: string; SOURCE?: string } | undefined;
  if (!error) return undefined;
  return error.MESSAGE ?? error.SOURCE ?? 'Unknown API error';
}

/**
 * Runs one query against the Trafikinfo API and returns the matching objects.
 * The API key is read from the environment on every call and is never included in error messages.
 */
export async function queryTrafikinfo<T>(spec: QuerySpec): Promise<T[]> {
  const apiKey = getApiKey();

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml', Accept: 'application/json' },
      body: buildRequestXml(apiKey, spec),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new TrafikverketClientError(`Failed to reach the Trafikverket API: ${reason}`);
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }

  const apiError = extractApiError(body);
  if (!response.ok || apiError) {
    const hint =
      response.status === 401 || response.status === 403
        ? ` (check that ${API_KEY_ENV} holds a valid Trafikverket API key)`
        : '';
    throw new TrafikverketClientError(
      `Trafikverket API error${apiError ? `: ${apiError}` : ` (HTTP ${response.status})`}${hint}`,
      response.status
    );
  }

  const result = (body as { RESPONSE?: { RESULT?: Array<Record<string, unknown>> } } | undefined)?.RESPONSE
    ?.RESULT?.[0];
  if (!result) {
    throw new TrafikverketClientError('Trafikverket API returned an unexpected response (no RESULT)');
  }
  const objects = result[spec.objectType];
  return Array.isArray(objects) ? (objects as T[]) : [];
}

import { TrafikverketClientError } from './errors.js';
import { parseWgs84Point } from './geo.js';
import { eq, queryTrafikinfo } from './trafikverket-client.js';
import type { RawStation, Station } from './types.js';

let stationCache: Promise<Station[]> | undefined;

async function loadStations(): Promise<Station[]> {
  const raw = await queryTrafikinfo<RawStation>({
    objectType: 'TrainStation',
    schemaVersion: '1.4',
    filter: eq('Advertised', true),
    include: [
      'LocationSignature',
      'AdvertisedLocationName',
      'AdvertisedShortLocationName',
      'OfficialLocationName',
      'CountyNo',
      'Geometry.WGS84',
    ],
  });

  return raw
    .filter((s) => s.LocationSignature && s.AdvertisedLocationName)
    .map((s) => {
      const point = parseWgs84Point(s.Geometry?.WGS84);
      return {
        signature: s.LocationSignature as string,
        name: s.AdvertisedLocationName as string,
        shortName: s.AdvertisedShortLocationName,
        officialName: s.OfficialLocationName,
        counties: s.CountyNo ?? [],
        latitude: point?.latitude,
        longitude: point?.longitude,
      };
    });
}

/** Returns all public train stations. Loaded once per process and cached; failures are not cached. */
export function getStations(): Promise<Station[]> {
  stationCache ??= loadStations().catch((error: unknown) => {
    stationCache = undefined;
    throw error;
  });
  return stationCache;
}

export function resetStationCache(): void {
  stationCache = undefined;
}

/** Signature -> display name map. Falls back to an empty map so name lookups never fail a tool call. */
export async function stationNameMap(): Promise<Map<string, string>> {
  try {
    const stations = await getStations();
    return new Map(stations.map((s) => [s.signature, s.name]));
  } catch {
    return new Map();
  }
}

/** Lower-cases and strips diacritics so "Goteborg" matches "Göteborg C". */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function names(station: Station): string[] {
  return [station.name, station.shortName, station.officialName]
    .filter((n): n is string => Boolean(n))
    .map(normalize);
}

/**
 * Finds stations matching a free-text query, best matches first:
 * exact signature, exact name, name prefix, then substring.
 */
export function findStations(stations: Station[], query: string): Station[] {
  const q = normalize(query);
  if (!q) return [];

  const tiers: Station[][] = [[], [], [], []];
  for (const station of stations) {
    if (normalize(station.signature) === q) {
      tiers[0].push(station);
      continue;
    }
    const n = names(station);
    if (n.some((name) => name === q)) tiers[1].push(station);
    else if (n.some((name) => name.startsWith(q))) tiers[2].push(station);
    else if (n.some((name) => name.includes(q))) tiers[3].push(station);
  }
  return tiers.flat();
}

/**
 * Resolves a station name or location signature to exactly one station.
 * Ambiguous input produces an error listing the candidates so the caller can pick one.
 */
export async function resolveStation(input: string): Promise<Station> {
  const stations = await getStations();
  const q = normalize(input);

  const bySignature = stations.find((s) => normalize(s.signature) === q);
  if (bySignature) return bySignature;

  const exact = stations.filter((s) => names(s).includes(q));
  if (exact.length === 1) return exact[0];

  const candidates = exact.length > 1 ? exact : findStations(stations, input);
  if (candidates.length === 0) {
    throw new TrafikverketClientError(
      `No train station found matching "${input}". Use search_stations to look up the exact name or signature.`
    );
  }
  if (candidates.length === 1) return candidates[0];

  // "Stockholm" should mean the central station ("Stockholm C") rather than a list of every Stockholm stop.
  const central = candidates.find((s) => names(s).includes(`${q} c`));
  if (central) return central;

  const listed = candidates
    .slice(0, 8)
    .map((s) => `${s.name} (${s.signature})`)
    .join(', ');
  throw new TrafikverketClientError(
    `Station "${input}" is ambiguous. Candidates: ${listed}${candidates.length > 8 ? ', ...' : ''}. ` +
      `Retry with the exact name or the location signature.`
  );
}

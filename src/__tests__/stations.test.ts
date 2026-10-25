import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findStations, getStations, resetStationCache, resolveStation } from '../stations.js';
import { mockTrafikinfo } from './helpers.js';
import stationsFixture from './fixtures/stations.json';

beforeEach(() => {
  vi.stubEnv('TRAFIKVERKET_API_KEY', 'test-key');
  resetStationCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetStationCache();
});

describe('station loading', () => {
  it('maps raw stations and fetches only once', async () => {
    const requests = mockTrafikinfo({ TrainStation: stationsFixture });

    const first = await getStations();
    const second = await getStations();

    expect(requests).toHaveLength(1);
    expect(second).toBe(first);
    expect(first[0]).toMatchObject({
      signature: 'Cst',
      name: 'Stockholm C',
      officialName: 'Stockholms central',
      counties: [1],
      latitude: 59.3303,
      longitude: 18.0585,
    });
    expect(requests[0]).toContain('<EQ name="Advertised" value="true" />');
  });

  it('does not cache failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    await expect(getStations()).rejects.toThrow(/offline/);

    mockTrafikinfo({ TrainStation: stationsFixture });
    await expect(getStations()).resolves.toHaveLength(stationsFixture.length);
  });
});

describe('findStations', () => {
  it('ranks signature, exact, prefix and substring matches in that order', async () => {
    mockTrafikinfo({ TrainStation: stationsFixture });
    const stations = await getStations();

    expect(findStations(stations, 'g').map((s) => s.signature)[0]).toBe('G');
    expect(findStations(stations, 'stockholm s').map((s) => s.signature)[0]).toBe('Sod');
    expect(findStations(stations, 'stockholm').map((s) => s.signature)).toEqual(['Cst', 'Sod', 'Odn']);
    expect(findStations(stations, 'odenplan').map((s) => s.signature)).toEqual(['Odn']);
  });

  it('ignores diacritics and case', async () => {
    mockTrafikinfo({ TrainStation: stationsFixture });
    const stations = await getStations();
    expect(findStations(stations, 'GOTEBORG').map((s) => s.signature)).toEqual(['G', 'Gs']);
    expect(findStations(stations, 'hassleholm')).toHaveLength(2);
  });

  it('returns nothing for empty queries', async () => {
    mockTrafikinfo({ TrainStation: stationsFixture });
    const stations = await getStations();
    expect(findStations(stations, '   ')).toEqual([]);
  });
});

describe('resolveStation', () => {
  beforeEach(() => {
    mockTrafikinfo({ TrainStation: stationsFixture });
  });

  it('resolves location signatures case-insensitively', async () => {
    await expect(resolveStation('cst')).resolves.toMatchObject({ name: 'Stockholm C' });
    await expect(resolveStation('G')).resolves.toMatchObject({ name: 'Göteborg C' });
  });

  it('resolves exact names', async () => {
    await expect(resolveStation('Göteborg Södra')).resolves.toMatchObject({ signature: 'Gs' });
  });

  it('prefers the central station for a bare city name', async () => {
    await expect(resolveStation('Stockholm')).resolves.toMatchObject({ signature: 'Cst' });
    await expect(resolveStation('Hässleholm')).resolves.toMatchObject({ signature: 'Hb' });
  });

  it('accepts a unique partial match', async () => {
    await expect(resolveStation('Odenplan')).resolves.toMatchObject({ signature: 'Odn' });
    await expect(resolveStation('Lund')).resolves.toMatchObject({ signature: 'Lu' });
  });

  it('lists candidates when the name is ambiguous', async () => {
    await expect(resolveStation('sto')).rejects.toThrow(/ambiguous.*Stockholm C \(Cst\).*Stockholm Södra \(Sod\)/);
  });

  it('reports unknown stations', async () => {
    await expect(resolveStation('Atlantis')).rejects.toThrow(/No train station found matching "Atlantis"/);
  });
});

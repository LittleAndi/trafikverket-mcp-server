import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStationCache } from '../stations.js';
import {
  getRoadSituationsSchema,
  getRoadSituationsTool,
  getRoadWeatherSchema,
  getRoadWeatherTool,
  getTrainAnnouncementsSchema,
  getTrainAnnouncementsTool,
  getTrainMessagesSchema,
  getTrainMessagesTool,
  searchStationsSchema,
  searchStationsTool,
} from '../tools/index.js';
import { mockTrafikinfo } from './helpers.js';
import stationsFixture from './fixtures/stations.json';
import announcementsFixture from './fixtures/train-announcements.json';
import messagesFixture from './fixtures/train-messages.json';
import situationsFixture from './fixtures/situations.json';
import weatherFixture from './fixtures/weather-observations.json';

beforeEach(() => {
  vi.stubEnv('TRAFIKVERKET_API_KEY', 'test-key');
  resetStationCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetStationCache();
});

describe('searchStationsTool', () => {
  it('returns matches with optional distance', async () => {
    mockTrafikinfo({ TrainStation: stationsFixture });

    const result = await searchStationsTool(
      searchStationsSchema.parse({ query: 'Göteborg', latitude: 57.7089, longitude: 11.9735 })
    );

    expect(result.count).toBe(2);
    expect(result.stations[0]).toMatchObject({ name: 'Göteborg C', signature: 'G', distanceKm: 0 });
    expect(result.stations[1].distanceKm).toBeGreaterThan(3);
  });

  it('omits distance without coordinates and respects the limit', async () => {
    mockTrafikinfo({ TrainStation: stationsFixture });

    const result = await searchStationsTool(searchStationsSchema.parse({ query: 'Stockholm', limit: 2 }));

    expect(result.stations).toHaveLength(2);
    expect(result.stations[0].distanceKm).toBeUndefined();
  });
});

describe('getTrainAnnouncementsTool', () => {
  it('queries departures for the resolved station and shapes the output', async () => {
    const requests = mockTrafikinfo({ TrainStation: stationsFixture, TrainAnnouncement: announcementsFixture });

    const result = await getTrainAnnouncementsTool(
      getTrainAnnouncementsSchema.parse({ station: 'Stockholm', limit: 10 })
    );

    const request = requests.find((r) => r.includes('objecttype="TrainAnnouncement"')) as string;
    expect(request).toContain('schemaversion="1.9"');
    expect(request).toContain('<EQ name="LocationSignature" value="Cst" />');
    expect(request).toContain('<EQ name="ActivityType" value="Avgang" />');
    expect(request).toContain('<GTE name="AdvertisedTimeAtLocation"');
    expect(request).toContain('<LTE name="AdvertisedTimeAtLocation"');
    expect(request).toContain('orderby="AdvertisedTimeAtLocation"');
    expect(request).toContain('limit="10"');

    expect(result.station).toEqual({ name: 'Stockholm C', signature: 'Cst' });
    expect(result.count).toBe(3);

    const [late, canceled, onTime] = result.announcements;
    expect(late).toMatchObject({
      train: '541',
      direction: 'departure',
      operator: 'SJ',
      product: 'SJ Snabbtåg',
      from: ['Stockholm C'],
      to: ['Göteborg C'],
      track: '14',
      delayMinutes: 7,
      canceled: false,
      deviations: ['Försenad'],
    });
    // Destinations are ordered by priority and resolved to station names.
    expect(canceled).toMatchObject({ canceled: true, to: ['Lund C', 'Göteborg Södra'], delayMinutes: undefined });
    // Unknown signatures fall back to the raw signature; actual time wins for delay.
    expect(onTime).toMatchObject({ to: ['UNKNOWN'], delayMinutes: 0, canceled: false });
  });

  it('uses the arrivals activity type when asked', async () => {
    const requests = mockTrafikinfo({ TrainStation: stationsFixture, TrainAnnouncement: [] });

    const result = await getTrainAnnouncementsTool(
      getTrainAnnouncementsSchema.parse({ station: 'Cst', direction: 'arrivals' })
    );

    expect(requests.at(-1)).toContain('<EQ name="ActivityType" value="Ankomst" />');
    expect(result.count).toBe(0);
  });

  it('fails clearly for ambiguous stations', async () => {
    mockTrafikinfo({ TrainStation: stationsFixture });
    await expect(getTrainAnnouncementsTool(getTrainAnnouncementsSchema.parse({ station: 'sto' }))).rejects.toThrow(
      /ambiguous/
    );
  });
});

describe('getTrainMessagesTool', () => {
  it('filters by county and drops messages that have already ended', async () => {
    const requests = mockTrafikinfo({ TrainStation: stationsFixture, TrainMessage: messagesFixture });

    const result = await getTrainMessagesTool(getTrainMessagesSchema.parse({ county: 'Skåne' }));

    const request = requests.find((r) => r.includes('objecttype="TrainMessage"')) as string;
    expect(request).toContain('schemaversion="1.7"');
    expect(request).toContain('<EQ name="CountyNo" value="12" />');
    expect(request).toContain('orderby="LastUpdateDateTime desc"');

    expect(result.county).toBe(12);
    expect(result.count).toBe(1);
    expect(result.messages[0]).toMatchObject({
      eventId: 'SE_STA_TRI_1',
      header: 'Banarbete mellan Hässleholm och Lund',
      reasons: ['Banarbete'],
      affectedLocations: ['Hässleholm C', 'Lund C'],
      fromLocations: ['Hässleholm C'],
      toLocations: ['Lund C'],
    });
  });

  it('includes ended messages when activeOnly is false', async () => {
    mockTrafikinfo({ TrainStation: stationsFixture, TrainMessage: messagesFixture });

    const result = await getTrainMessagesTool(getTrainMessagesSchema.parse({ activeOnly: false }));

    expect(result.count).toBe(2);
  });

  it('still works when station names cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        const body = String(init?.body);
        if (body.includes('objecttype="TrainStation"')) throw new Error('offline');
        return new Response(JSON.stringify({ RESPONSE: { RESULT: [{ TrainMessage: messagesFixture }] } }), {
          status: 200,
        });
      })
    );

    const result = await getTrainMessagesTool(getTrainMessagesSchema.parse({}));

    expect(result.messages[0].affectedLocations).toEqual(['Hb', 'Lu']);
  });

  it('rejects unknown counties before calling the API', async () => {
    const requests = mockTrafikinfo({});
    await expect(getTrainMessagesTool(getTrainMessagesSchema.parse({ county: 'Atlantis' }))).rejects.toThrow(
      /Unknown county/
    );
    expect(requests).toHaveLength(0);
  });
});

describe('getRoadSituationsTool', () => {
  it('searches around a point, ranking by severity and computing distance', async () => {
    const requests = mockTrafikinfo({ Situation: situationsFixture });

    const result = await getRoadSituationsTool(
      getRoadSituationsSchema.parse({ latitude: 57.6, longitude: 12.0, radiusKm: 30 })
    );

    const request = requests[0];
    expect(request).toContain('schemaversion="1.5"');
    expect(request).toContain(
      '<WITHIN name="Deviation.Geometry.Point.WGS84" shape="center" value="12 57.6" radius="30000m" />'
    );
    expect(request).toContain('<WITHIN name="Deviation.Geometry.Line.WGS84"');

    // The already-ended deviation is dropped; the rest is ordered by severity.
    expect(result.count).toBe(2);
    expect(result.situations.map((s) => s.id)).toEqual(['SE_STA_TRISSID_1_1', 'SE_STA_TRISSID_2_1']);
    expect(result.situations[0]).toMatchObject({
      messageType: 'Olycka',
      severity: 'Stor påverkan',
      severityCode: 4,
      roadNumber: 'E6',
      lanesRestricted: 1,
      situationId: 'SE_STA_TRISSID_1',
    });
    expect(result.situations[0].distanceKm).toBeGreaterThan(10);
    expect(result.situations[0].distanceKm).toBeLessThan(13);
  });

  it('filters by county both in the query and on the deviations', async () => {
    const requests = mockTrafikinfo({ Situation: situationsFixture });

    const result = await getRoadSituationsTool(getRoadSituationsSchema.parse({ county: 'Västra Götaland' }));

    expect(requests[0]).toContain('<EQ name="Deviation.CountyNo" value="14" />');
    expect(result.situations.map((s) => s.id)).toEqual(['SE_STA_TRISSID_2_1']);
  });

  it('filters by message type', async () => {
    const requests = mockTrafikinfo({ Situation: situationsFixture });

    const result = await getRoadSituationsTool(getRoadSituationsSchema.parse({ messageType: 'Olycka' }));

    expect(requests[0]).toContain('<EQ name="Deviation.MessageType" value="Olycka" />');
    expect(result.situations.map((s) => s.messageType)).toEqual(['Olycka']);
  });

  it('requires latitude and longitude together', async () => {
    const requests = mockTrafikinfo({});
    await expect(getRoadSituationsTool(getRoadSituationsSchema.parse({ latitude: 57.7 }))).rejects.toThrow(
      /both latitude and longitude/
    );
    expect(requests).toHaveLength(0);
  });
});

describe('getRoadWeatherTool', () => {
  it('returns the newest observation per station, nearest first', async () => {
    const requests = mockTrafikinfo({ WeatherObservation: weatherFixture });

    const result = await getRoadWeatherTool(
      getRoadWeatherSchema.parse({ latitude: 57.5, longitude: 12.1, radiusKm: 50, limit: 5 })
    );

    expect(requests[0]).toContain('objecttype="WeatherObservation"');
    expect(requests[0]).toContain('schemaversion="2"');
    expect(requests[0]).toContain(
      '<WITHIN name="Measurepoint.Geometry.WGS84" shape="center" value="12.1 57.5" radius="50000m" />'
    );

    expect(result.count).toBe(2);
    expect(result.stations.map((s) => s.name)).toEqual(['Kungsbacka', 'Hede']);

    expect(result.stations[0]).toMatchObject({
      id: 101,
      sampleTime: '2026-10-25T17:00:00.000+01:00',
      airTemperatureC: 7.1,
      humidityPercent: 88,
      dewpointC: 5.2,
      visibilityMeters: 4500,
      wind: [{ directionDegrees: 225, speedMs: 6.4 }],
      surface: { temperatureC: 6, grip: 0.7, water: true, ice: false, snow: false },
      last10min: { rain: true, snow: false, precipitationMm: 0.4, windAverageMs: 6.1, windMaxMs: 9.3 },
    });
    expect(result.stations[0].distanceKm).toBeLessThan(result.stations[1].distanceKm as number);
  });

  it('respects the station limit', async () => {
    mockTrafikinfo({ WeatherObservation: weatherFixture });

    const result = await getRoadWeatherTool(getRoadWeatherSchema.parse({ latitude: 57.5, longitude: 12.1, limit: 1 }));

    expect(result.stations.map((s) => s.name)).toEqual(['Kungsbacka']);
  });

  it('validates coordinates', async () => {
    mockTrafikinfo({});
    await expect(getRoadWeatherTool({ latitude: 95, longitude: 12, radiusKm: 25, limit: 3 })).rejects.toThrow(
      /Invalid latitude/
    );
  });
});

describe('API key handling', () => {
  it('fails every tool clearly when the key is missing', async () => {
    vi.stubEnv('TRAFIKVERKET_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(getTrainMessagesTool(getTrainMessagesSchema.parse({}))).rejects.toThrow(
      /TRAFIKVERKET_API_KEY is not set/
    );
    await expect(
      getRoadWeatherTool(getRoadWeatherSchema.parse({ latitude: 59.3, longitude: 18.1 }))
    ).rejects.toThrow(/TRAFIKVERKET_API_KEY is not set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

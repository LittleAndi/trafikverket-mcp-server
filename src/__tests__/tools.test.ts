import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStationCache } from '../stations.js';
import {
  getReplacementTrafficSchema,
  getReplacementTrafficTool,
  getRailwayEventsSchema,
  getRailwayEventsTool,
  getRoadSituationsSchema,
  getRoadSituationsTool,
  getRoadWeatherSchema,
  getRoadWeatherTool,
  getTrainAnnouncementsSchema,
  getTrainAnnouncementsTool,
  getTrainMessagesSchema,
  getTrainMessagesTool,
  getTrainPositionsSchema,
  getTrainPositionsTool,
  searchStationsSchema,
  searchStationsTool,
} from '../tools/index.js';
import { mockTrafikinfo } from './helpers.js';
import stationsFixture from './fixtures/stations.json';
import announcementsFixture from './fixtures/train-announcements.json';
import operativeEventsFixture from './fixtures/operative-events.json';
import situationsFixture from './fixtures/situations.json';
import weatherFixture from './fixtures/weather-observations.json';
import trainPositionsFixture from './fixtures/train-positions.json';
import replacementTrafficFixture from './fixtures/replacement-traffic.json';
import railwayEventsFixture from './fixtures/railway-events.json';

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
    expect(request).toContain('namespace="Rail.TrafficInfo"');
    expect(request).toContain('schemaversion="2.0"');
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
  // Real capture of two Västra Götaland events; only Borås C and Varberg are known stations here.
  const stations = [
    ...stationsFixture,
    { LocationSignature: 'Bsc', AdvertisedLocationName: 'Borås C', CountyNo: [14], Advertised: true },
    { LocationSignature: 'Vbc', AdvertisedLocationName: 'Varberg', CountyNo: [13], Advertised: true },
  ];

  it('queries ongoing operative events for the county and shapes the output', async () => {
    const requests = mockTrafikinfo({ TrainStation: stations, OperativeEvent: operativeEventsFixture });

    const result = await getTrainMessagesTool(getTrainMessagesSchema.parse({ county: 'Västra Götaland' }));

    const request = requests.find((r) => r.includes('objecttype="OperativeEvent"')) as string;
    expect(request).toContain('namespace="ols.open"');
    expect(request).toContain('schemaversion="1.0"');
    expect(request).toContain('<AND><EQ name="CountyNo" value="14" /><EQ name="EventState" value="1" /></AND>');
    expect(request).toContain('orderby="ModifiedDateTime desc"');

    expect(result.county).toBe(14);
    expect(result.count).toBe(2);
    const message = result.messages.find((m) => m.eventId === 'O261025-004');
    expect(message).toMatchObject({
      eventType: 'Kontaktledning',
      header: 'Elfel: Borås-Varberg',
      active: true,
      expectedEndTime: '2026-10-25T20:00:00.000+01:00',
      lastUpdated: expect.any(String),
      counties: [13, 14],
      fromLocations: ['Borås C'],
      toLocations: ['Varberg'],
    });
    // The most recently modified public message wins, with trailing whitespace trimmed.
    expect(message?.description).toMatch(/Se respektive tågavgång för mer information om din resa.$/);
    expect(message?.affectedLocations).toContain('Borås C');
    expect(new Set(message?.affectedLocations).size).toBe(message?.affectedLocations.length);
  });

  it('keeps events that have no public message yet', async () => {
    mockTrafikinfo({ TrainStation: stations, OperativeEvent: operativeEventsFixture });

    const result = await getTrainMessagesTool(getTrainMessagesSchema.parse({}));

    expect(result.messages.find((m) => m.eventId === 'O261025-040')).toMatchObject({
      eventType: 'Dragfordon/motorvagn',
      header: undefined,
      fromLocations: ['Hrc'],
      toLocations: ['Lju'],
    });
  });

  it('does not filter on event state when activeOnly is false', async () => {
    const requests = mockTrafikinfo({ TrainStation: stations, OperativeEvent: operativeEventsFixture });

    await getTrainMessagesTool(getTrainMessagesSchema.parse({ activeOnly: false }));

    const request = requests.find((r) => r.includes('objecttype="OperativeEvent"')) as string;
    expect(request).not.toContain('<FILTER>');
  });

  it('still works when station names cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        const body = String(init?.body);
        if (body.includes('objecttype="TrainStation"')) throw new Error('offline');
        return new Response(JSON.stringify({ RESPONSE: { RESULT: [{ OperativeEvent: operativeEventsFixture }] } }), {
          status: 200,
        });
      })
    );

    const result = await getTrainMessagesTool(getTrainMessagesSchema.parse({}));

    expect(result.messages.find((m) => m.eventId === 'O261025-004')?.fromLocations).toEqual(['Bsc']);
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
    expect(request).toContain('namespace="Road.TrafficInfo"');
    expect(request).toContain('schemaversion="1.6"');
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
    expect(requests[0]).toContain('namespace="Road.WeatherInfo"');
    expect(requests[0]).toContain('schemaversion="2.1"');
    expect(requests[0]).toContain('<GTE name="Sample" value="');
    expect(requests[0]).toContain('orderby="Sample desc"');
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

describe('getTrainPositionsTool', () => {
  it('locates a train by number and keeps only its newest report', async () => {
    const requests = mockTrafikinfo({ TrainPosition: trainPositionsFixture });

    const result = await getTrainPositionsTool(getTrainPositionsSchema.parse({ trainNumber: '421' }));

    expect(requests[0]).toContain('objecttype="TrainPosition"');
    expect(requests[0]).toContain('namespace="järnväg.trafikinfo"');
    expect(requests[0]).toContain('schemaversion="1.1"');
    expect(requests[0]).toContain('orderby="TimeStamp desc"');
    expect(requests[0]).toContain(
      '<OR><EQ name="Train.AdvertisedTrainNumber" value="421" /><EQ name="Train.OperationalTrainNumber" value="421" /></OR>'
    );
    expect(requests[0]).toContain('<GTE name="TimeStamp" value="');
    expect(requests[0]).not.toContain('<WITHIN');

    const train421 = result.trains.filter((t) => t.train === '421');
    expect(train421).toHaveLength(1);
    expect(train421[0]).toMatchObject({
      latitude: 57.72,
      longitude: 11.99,
      speedKmh: 112,
      bearingDegrees: 45,
      active: true,
      timestamp: '2026-11-02T22:10:00.000+01:00',
    });
    expect(train421[0].distanceKm).toBeUndefined();
  });

  it('searches around a point, nearest first, skipping deleted reports', async () => {
    const requests = mockTrafikinfo({ TrainPosition: trainPositionsFixture });

    const result = await getTrainPositionsTool(
      getTrainPositionsSchema.parse({ latitude: 57.709, longitude: 11.975, radiusKm: 5, maxAgeMinutes: 15 })
    );

    expect(requests[0]).toContain(
      '<WITHIN name="Position.WGS84" shape="center" value="11.975 57.709" radius="5000m" />'
    );
    expect(requests[0]).not.toContain('<EQ');
    expect(result.radiusKm).toBe(5);
    // 4711 has no advertised number and reports "POINT (lat lon)"; 3999 is deleted.
    expect(result.trains.map((t) => t.train)).toEqual(['4711', '421']);
    expect(result.trains[0]).toMatchObject({ latitude: 57.71, longitude: 11.976, distanceKm: 0.1 });
  });

  it('requires a train number or a location', async () => {
    mockTrafikinfo({});
    await expect(getTrainPositionsTool(getTrainPositionsSchema.parse({}))).rejects.toThrow(/trainNumber/);
    await expect(getTrainPositionsTool(getTrainPositionsSchema.parse({ latitude: 57.7 }))).rejects.toThrow(
      /together/
    );
  });
});

describe('getReplacementTrafficTool', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T21:10:00.000+01:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const fixtures = { TrainStation: stationsFixture, ReplacementTraffic: replacementTrafficFixture };

  it('lists trips in the time window, dropping deleted and finished ones', async () => {
    const requests = mockTrafikinfo(fixtures);

    const result = await getReplacementTrafficTool(getReplacementTrafficSchema.parse({}));

    const request = requests.find((r) => r.includes('objecttype="ReplacementTraffic"')) as string;
    expect(request).toContain('namespace="JBS"');
    expect(request).toContain('schemaversion="1.0"');
    // Server-side window on any stop's planned time, with an hour of slack on each side.
    expect(request).toContain(
      '<OR><GTE name="Stops.Stop.PlannedDepartureTime" value="2026-11-02T18:40:00.000Z" />' +
        '<GTE name="Stops.Stop.PlannedArrivalTime" value="2026-11-02T18:40:00.000Z" /></OR>'
    );
    expect(request).toContain('<LTE name="Stops.Stop.PlannedDepartureTime" value="2026-11-03T09:10:00.000Z" />');

    expect(result.trips.map((t) => t.id)).toEqual(['VT-2026-11-02-1043', 'ST-1045']);
    const [bus, taxi] = result.trips;
    expect(bus).toMatchObject({
      source: 'Vasttrafik',
      description: 'Ersättningsbuss för tåg 1043',
      vehicleMode: 'bus',
      vehicleIdentifier: 'ABC123',
      status: 'running',
      wheelchairAccessible: true,
      toilet: false,
      replacesTrains: [{ train: '1043', departureDate: '2026-11-02', product: 'Västtågen' }],
      from: 'Göteborg C',
      to: 'Lund C',
      departureTime: '2026-11-02T21:06:00.000+01:00',
      arrivalTime: '2026-11-02T23:30:00.000+01:00',
      lastUpdated: '2026-11-02T21:06:30.000+01:00',
    });
    // Stops are ordered by Sequence, names resolved, notes trimmed, delays from actual/expected times.
    expect(bus.stops.map((s) => s.signature)).toEqual(['G', 'Gs', 'Lu']);
    expect(bus.stops[0]).toMatchObject({
      name: 'Göteborg C',
      stopDescription: 'Busshållplats Nils Ericson-terminalen, läge K',
      destination: 'Lund C',
      latitude: 57.7089,
      longitude: 11.9746,
      delayMinutes: 6,
      note: 'Bussen avgår från läge K.',
      connectsTo: ['Stockholm C'],
    });
    expect(bus.stops[1].delayMinutes).toBe(5);
    expect(bus.stops[2]).toMatchObject({ disembarkingOnly: true, delayMinutes: undefined });
    expect(bus.atStation).toBeUndefined();

    // Single-object lists are unwrapped and unknown signatures fall back to the raw signature.
    expect(taxi).toMatchObject({ from: 'Hässleholm C', to: 'XYZ', replacesTrains: [{ train: '1045' }] });
  });

  it('filters by station and returns the stop there', async () => {
    const requests = mockTrafikinfo(fixtures);

    const result = await getReplacementTrafficTool(getReplacementTrafficSchema.parse({ station: 'Göteborg Södra' }));

    const request = requests.find((r) => r.includes('objecttype="ReplacementTraffic"')) as string;
    expect(request).toContain('<EQ name="Stops.Stop.PlaceSignature" value="Gs" />');
    expect(result.station).toEqual({ name: 'Göteborg Södra', signature: 'Gs' });
    expect(result.trips.map((t) => t.id)).toEqual(['VT-2026-11-02-1043']);
    expect(result.trips[0].atStation).toMatchObject({
      signature: 'Gs',
      stopDescription: 'Hållplats Ullevi Södra',
      expectedDeparture: '2026-11-02T21:21:00.000+01:00',
    });
  });

  it('filters by train number and date without a time window', async () => {
    const requests = mockTrafikinfo(fixtures);

    const result = await getReplacementTrafficTool(
      getReplacementTrafficSchema.parse({ trainNumber: '1043', date: '2026-11-01' })
    );

    const request = requests.find((r) => r.includes('objecttype="ReplacementTraffic"')) as string;
    expect(request).toContain('<EQ name="ReplacesTrains.ReplacesTrain.AdvertisedTrainIdent" value="1043" />');
    expect(request).toContain('<EQ name="ReplacesTrains.ReplacesTrain.ScheduledDepartureDate" value="2026-11-01" />');
    expect(request).not.toContain('PlannedDepartureTime');
    expect(result.window).toBeUndefined();
    expect(result.trips.map((t) => t.id)).toEqual(['VT-OLD']);
    expect(result.trips[0].status).toBe('finished');
  });

  it('respects the limit and reports the total', async () => {
    mockTrafikinfo(fixtures);

    const result = await getReplacementTrafficTool(getReplacementTrafficSchema.parse({ limit: 1 }));

    expect(result).toMatchObject({ count: 1, totalMatches: 2 });
  });

  it('rejects malformed dates', () => {
    expect(() => getReplacementTrafficSchema.parse({ date: '2/11' })).toThrow(/YYYY-MM-DD/);
  });
});

describe('getRailwayEventsTool', () => {
  it('queries non-deleted, not-ended railway events and shapes the output', async () => {
    const requests = mockTrafikinfo({ TrainStation: stationsFixture, RailwayEvent: railwayEventsFixture });

    const result = await getRailwayEventsTool(getRailwayEventsSchema.parse({}));

    const request = requests.find((r) => r.includes('objecttype="RailwayEvent"')) as string;
    expect(request).toContain('namespace="ols.open"');
    expect(request).toContain('schemaversion="1.0"');
    expect(request).toContain('<EQ name="Deleted" value="false" />');
    expect(request).toMatch(/<OR><EXISTS name="EndDateTime" value="false" \/><GT name="EndDateTime" value="[^"]+Z" \/><\/OR>/);
    expect(request).toContain('orderby="ModifiedDateTime desc"');
    expect(request).toContain('limit="20"');

    expect(result.station).toBeUndefined();
    // The ended event is dropped client-side even if the server returns it.
    expect(result.count).toBe(2);
    expect(result.events.map((e) => e.eventId)).toEqual(['B261102-0153', 'B261102-0161']);

    expect(result.events[0]).toMatchObject({
      status: 'OperativHändelse',
      reasonCode: 'IBT01',
      operativeEventId: 'O261102-012',
      active: true,
      startTime: '2026-11-02T06:41:00.000+01:00',
      endTime: undefined,
      version: 4,
      // Intermediate locations follow LocationOrder; unknown signatures stay as signatures.
      sections: [{ from: 'Hässleholm C', to: 'Lund C', via: undefined, intermediate: ['Hässleholm Norra', 'Hör'] }],
      locations: ['Hässleholm C', 'Hässleholm Norra', 'Hör', 'Lund C'],
    });
    expect(result.events[1]).toMatchObject({
      status: 'MöjligOperativHändelse',
      operativeEventId: undefined,
      sections: [{ from: 'Stockholm C', via: 'Stockholm Odenplan', to: 'Stockholm C', intermediate: [] }],
      locations: ['Stockholm C', 'Stockholm Odenplan'],
    });
  });

  it('filters on station, status and operative event id', async () => {
    const requests = mockTrafikinfo({ TrainStation: stationsFixture, RailwayEvent: [] });

    const result = await getRailwayEventsTool(
      getRailwayEventsSchema.parse({
        station: 'Hässleholm C',
        status: 'OperativHändelse',
        operativeEventId: 'O261102-012',
        activeOnly: false,
        limit: 5,
      })
    );

    const request = requests.find((r) => r.includes('objecttype="RailwayEvent"')) as string;
    expect(request).toContain(
      '<OR>' +
        '<EQ name="SelectedSection.FromLocation.Signature" value="Hb" />' +
        '<EQ name="SelectedSection.ToLocation.Signature" value="Hb" />' +
        '<EQ name="SelectedSection.ViaLocation.Signature" value="Hb" />' +
        '<EQ name="SelectedSection.IntermediateLocation.Signature" value="Hb" />' +
        '</OR>'
    );
    expect(request).toContain('<EQ name="EventStatus" value="OperativHändelse" />');
    expect(request).toContain('<EQ name="OperativeEventId" value="O261102-012" />');
    expect(request).not.toContain('EndDateTime');
    expect(request).toContain('limit="5"');
    expect(result.station).toEqual({ name: 'Hässleholm C', signature: 'Hb' });
    expect(result.count).toBe(0);
  });

  it('keeps ended events when activeOnly is false', async () => {
    mockTrafikinfo({ TrainStation: stationsFixture, RailwayEvent: railwayEventsFixture });

    const result = await getRailwayEventsTool(getRailwayEventsSchema.parse({ activeOnly: false }));

    expect(result.count).toBe(3);
    expect(result.events.at(-1)).toMatchObject({ eventId: 'B261101-0870', active: false, locations: ['Göteborg C'] });
  });

  it('rejects unknown status values', () => {
    expect(() => getRailwayEventsSchema.parse({ status: 'Okänd' })).toThrow();
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

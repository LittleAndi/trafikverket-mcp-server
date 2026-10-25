import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrafikverketClientError } from '../errors.js';
import {
  and,
  buildRequestXml,
  eq,
  escapeXml,
  or,
  queryTrafikinfo,
  within,
} from '../trafikverket-client.js';

beforeEach(() => {
  vi.stubEnv('TRAFIKVERKET_API_KEY', 'secret-test-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('request building', () => {
  it('builds a complete request document', () => {
    const xml = buildRequestXml('KEY', {
      objectType: 'TrainAnnouncement',
      schemaVersion: '1.9',
      filter: and(eq('LocationSignature', 'Cst'), eq('Advertised', true)),
      include: ['LocationSignature', 'Geometry.WGS84'],
      orderBy: 'AdvertisedTimeAtLocation',
      limit: 25,
    });

    expect(xml).toContain('<LOGIN authenticationkey="KEY" />');
    expect(xml).toContain('objecttype="TrainAnnouncement"');
    expect(xml).toContain('schemaversion="1.9"');
    expect(xml).toContain('orderby="AdvertisedTimeAtLocation"');
    expect(xml).toContain('limit="25"');
    expect(xml).toContain('<FILTER><AND><EQ name="LocationSignature" value="Cst" /><EQ name="Advertised" value="true" /></AND></FILTER>');
    expect(xml).toContain('<INCLUDE>Geometry.WGS84</INCLUDE>');
  });

  it('puts the namespace on the query when given', () => {
    const xml = buildRequestXml('KEY', { namespace: 'ols.open', objectType: 'OperativeEvent', schemaVersion: '1.0' });
    expect(xml).toContain('<QUERY namespace="ols.open" objecttype="OperativeEvent" schemaversion="1.0">');
  });

  it('omits optional parts when not given', () => {
    const xml = buildRequestXml('KEY', { objectType: 'TrainStation', schemaVersion: '1.4' });
    expect(xml).not.toContain('<FILTER>');
    expect(xml).not.toContain('<INCLUDE>');
    expect(xml).not.toContain('namespace=');
    expect(xml).not.toContain('limit=');
    expect(xml).not.toContain('orderby=');
  });

  it('escapes special characters in attribute values', () => {
    expect(escapeXml(`a&b<c>"d"'e'`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;');
    expect(eq('Name', 'Kalix & "Co"')).toBe('<EQ name="Name" value="Kalix &amp; &quot;Co&quot;" />');
  });

  it('combines filters, skipping empty parts and unwrapping a single child', () => {
    expect(and()).toBe('');
    expect(and(undefined, eq('A', 1))).toBe('<EQ name="A" value="1" />');
    expect(or(eq('A', 1), eq('B', 2))).toBe('<OR><EQ name="A" value="1" /><EQ name="B" value="2" /></OR>');
  });

  it('builds a WITHIN filter with longitude first', () => {
    expect(within('Geometry.WGS84', 11.97, 57.71, 25000)).toBe(
      '<WITHIN name="Geometry.WGS84" shape="center" value="11.97 57.71" radius="25000m" />'
    );
  });
});

describe('queryTrafikinfo', () => {
  const spec = { objectType: 'TrainStation', schemaVersion: '1.4' };

  it('throws a helpful error when the API key is missing', async () => {
    vi.stubEnv('TRAFIKVERKET_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(queryTrafikinfo(spec)).rejects.toThrow(/TRAFIKVERKET_API_KEY is not set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the request and returns the objects of the requested type', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ RESPONSE: { RESULT: [{ TrainStation: [{ LocationSignature: 'Cst' }] }] } }), {
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await queryTrafikinfo<{ LocationSignature: string }>(spec);

    expect(result).toEqual([{ LocationSignature: 'Cst' }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.trafikinfo.trafikverket.se/v2/data.json');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('authenticationkey="secret-test-key"');
  });

  it('returns an empty list when the result has no objects of that type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ RESPONSE: { RESULT: [{}] } }), { status: 200 }))
    );
    await expect(queryTrafikinfo(spec)).resolves.toEqual([]);
  });

  it('surfaces API errors without leaking the API key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ RESPONSE: { RESULT: [{ ERROR: { SOURCE: 'Query', MESSAGE: 'Invalid field Foo' } }] } }),
            { status: 200 }
          )
      )
    );

    const error = await queryTrafikinfo(spec).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TrafikverketClientError);
    expect((error as Error).message).toContain('Invalid field Foo');
    expect((error as Error).message).not.toContain('secret-test-key');
  });

  it('adds a hint for authentication failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unauthorized', { status: 401 })));

    const error = (await queryTrafikinfo(spec).catch((e: unknown) => e)) as TrafikverketClientError;
    expect(error.statusCode).toBe(401);
    expect(error.message).toMatch(/HTTP 401/);
    expect(error.message).toMatch(/valid Trafikverket API key/);
  });

  it('wraps network failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      })
    );
    await expect(queryTrafikinfo(spec)).rejects.toThrow(/Failed to reach the Trafikverket API: getaddrinfo ENOTFOUND/);
  });
});

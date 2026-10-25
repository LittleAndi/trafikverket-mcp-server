import { vi } from 'vitest';

/**
 * Stubs global fetch so each Trafikinfo query is answered from `fixtures[objectType]`.
 * Returns the list of request bodies sent, in order.
 */
export function mockTrafikinfo(fixtures: Record<string, unknown[]>): string[] {
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const body = String(init?.body ?? '');
      requests.push(body);
      const objectType = /objecttype="([^"]+)"/.exec(body)?.[1] ?? '';
      const items = fixtures[objectType] ?? [];
      return new Response(JSON.stringify({ RESPONSE: { RESULT: [{ [objectType]: items }] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
  return requests;
}

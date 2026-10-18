import { describe, expect, test } from 'bun:test';

import { fetchRegionIndex } from './catalogClient';

const validIndex = {
  version: 1,
  attribution: 'Contains information from OpenStreetMap (ODbL).',
  licenseUrl: 'https://www.openstreetmap.org/copyright',
  regions: [
    {
      id: 'bali',
      name: { id: 'Bali', en: 'Bali' },
      bbox: [114.4, -8.92, 115.74, -8.04],
      bytes: 123,
      version: '20261018',
      sha256: 'a'.repeat(64),
      url: 'https://maps.example.test/bali-20261018.pmtiles',
    },
  ],
};

const ok = (body: unknown) => async () => ({ ok: true, json: async () => body });

describe('fetchRegionIndex', () => {
  test('parses a good index', async () => {
    const index = await fetchRegionIndex(ok(validIndex), 'https://x.test/index.json', 1000);
    expect(index?.regions.map((r) => r.id)).toEqual(['bali']);
  });

  test('asks for JSON from the given URL', async () => {
    let seen: { url: string; accept: string | undefined } | null = null;
    await fetchRegionIndex(
      async (url, init) => {
        seen = { url, accept: init.headers.accept };
        return { ok: true, json: async () => validIndex };
      },
      'https://x.test/index.json',
      1000,
    );
    expect(seen).toEqual({ url: 'https://x.test/index.json', accept: 'application/json' });
  });

  test('null on a non-200, a thrown fetch, bad JSON and an invalid index', async () => {
    expect(await fetchRegionIndex(async () => ({ ok: false, json: async () => validIndex }), 'https://x.test/i', 1000)).toBeNull();
    expect(
      await fetchRegionIndex(
        async () => {
          throw new Error('Network request failed');
        },
        'https://x.test/i',
        1000,
      ),
    ).toBeNull();
    expect(
      await fetchRegionIndex(
        async () => ({
          ok: true,
          json: async () => {
            throw new SyntaxError('bad json');
          },
        }),
        'https://x.test/i',
        1000,
      ),
    ).toBeNull();
    expect(await fetchRegionIndex(ok({ version: 9 }), 'https://x.test/i', 1000)).toBeNull();
  });

  test('gives up after the timeout by aborting the request', async () => {
    let aborted = false;
    const started = Date.now();
    const result = await fetchRegionIndex(
      (_url, init) => {
        const { promise, reject } = Promise.withResolvers<{ ok: boolean; json(): Promise<unknown> }>();
        init.signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
        return promise;
      },
      'https://x.test/i',
      30,
    );
    expect(result).toBeNull();
    expect(aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

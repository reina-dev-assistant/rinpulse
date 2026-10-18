import { describe, expect, test } from 'bun:test';

import {
  INDEX_URL,
  isNewerVersion,
  nearestRegions,
  parseRegionIndex,
  regionContaining,
  type MapRegion,
} from './regions';

const SHA = 'a'.repeat(64);

function region(id: string, bbox: [number, number, number, number], extra: Partial<MapRegion> = {}): MapRegion {
  return {
    id,
    name: { id: id.toUpperCase(), en: id.toUpperCase() },
    bbox,
    bytes: 50_000_000,
    version: '20261018',
    sha256: SHA,
    url: `https://maps.example.test/${id}-20261018.pmtiles`,
    ...extra,
  };
}

const envelope = (regions: unknown[]) => ({
  version: 1,
  attribution: 'Contains information from OpenStreetMap (ODbL).',
  licenseUrl: 'https://www.openstreetmap.org/copyright',
  regions,
});

const BALI = region('bali', [114.4, -8.92, 115.74, -8.04]);
const DIY = region('diy', [110.0, -8.22, 110.85, -7.52]);
const JATENG = region('jawa-tengah', [108.5, -8.25, 111.75, -5.7]);
const JATIM = region('jawa-timur', [110.9, -8.85, 114.7, -6.7]);

describe('INDEX_URL', () => {
  test('is an https index.json', () => {
    expect(INDEX_URL.startsWith('https://')).toBe(true);
    expect(INDEX_URL.endsWith('/index.json')).toBe(true);
  });
});

describe('parseRegionIndex', () => {
  test('accepts a well-formed index', () => {
    const parsed = parseRegionIndex(envelope([BALI, DIY]));
    expect(parsed?.regions.map((r) => r.id)).toEqual(['bali', 'diy']);
    expect(parsed?.attribution).toContain('OpenStreetMap');
  });

  test('rejects a wrong envelope', () => {
    expect(parseRegionIndex(null)).toBeNull();
    expect(parseRegionIndex('x')).toBeNull();
    expect(parseRegionIndex({ ...envelope([]), version: 2 })).toBeNull();
    expect(parseRegionIndex({ ...envelope([]), attribution: '' })).toBeNull();
    expect(parseRegionIndex({ ...envelope([]), licenseUrl: 'http://example.test' })).toBeNull();
    expect(parseRegionIndex({ version: 1, regions: [] })).toBeNull();
    expect(parseRegionIndex({ ...envelope([]), regions: 'no' })).toBeNull();
  });

  test('drops regions with a bad bbox, bytes, url, sha or id', () => {
    const bad = [
      { ...BALI, id: 'inverted', bbox: [115, -8, 114, -9] },
      { ...BALI, id: 'out-of-range', bbox: [114, -95, 115, -8] },
      { ...BALI, id: 'short-bbox', bbox: [114, -9, 115] },
      { ...BALI, id: 'zero-bytes', bytes: 0 },
      { ...BALI, id: 'frac-bytes', bytes: 1.5 },
      { ...BALI, id: 'string-bytes', bytes: '1000' },
      { ...BALI, id: 'plain-http', url: 'http://maps.example.test/a.pmtiles' },
      { ...BALI, id: 'file-url', url: 'file:///data/a.pmtiles' },
      { ...BALI, id: 'not-a-url', url: 'maps' },
      { ...BALI, id: 'bad-sha', sha256: 'zz' },
      { ...BALI, id: 'Bad Id' },
    ];
    const parsed = parseRegionIndex(envelope([...bad, DIY]));
    expect(parsed?.regions.map((r) => r.id)).toEqual(['diy']);
  });

  test('keeps the first of duplicate ids', () => {
    const parsed = parseRegionIndex(envelope([BALI, { ...BALI, bytes: 7 }]));
    expect(parsed?.regions).toHaveLength(1);
    expect(parsed?.regions[0]?.bytes).toBe(BALI.bytes);
  });
});

describe('regionContaining', () => {
  const index = { regions: [JATENG, DIY, JATIM, BALI] };

  test('finds the region for a point', () => {
    expect(regionContaining(index, -8.65, 115.2)?.id).toBe('bali');
    expect(regionContaining(index, -7.25, 112.75)?.id).toBe('jawa-timur');
  });

  test('prefers the smallest box where they overlap', () => {
    expect(regionContaining(index, -7.8, 110.37)?.id).toBe('diy');
    expect(regionContaining(index, -7.0, 110.4)?.id).toBe('jawa-tengah');
  });

  test('null outside every box and on the exact edge inside', () => {
    expect(regionContaining(index, 1.3, 103.8)).toBeNull();
    expect(regionContaining(index, -8.04, 114.4)?.id).toBe('bali');
  });
});

describe('nearestRegions', () => {
  const index = { regions: [JATENG, DIY, JATIM, BALI] };

  test('a containing region is first at 0 m, the smaller box first among those', () => {
    const near = nearestRegions(index, -7.8, 110.37, 2);
    expect(near.map((n) => n.region.id)).toEqual(['diy', 'jawa-tengah']);
    expect(near[0]?.distanceM).toBe(0);
  });

  test('orders by distance and honours the limit', () => {
    // Lombok: east of Bali, a long way from Java.
    const near = nearestRegions(index, -8.6, 116.1, 2);
    expect(near[0]?.region.id).toBe('bali');
    expect(near[0]?.distanceM).toBeGreaterThan(30_000);
    expect(near[0]?.distanceM).toBeLessThan(50_000);
    expect(near).toHaveLength(2);
    expect(nearestRegions(index, -8.6, 116.1, 0)).toEqual([]);
  });
});

describe('isNewerVersion', () => {
  test('compares build dates', () => {
    expect(isNewerVersion('20261101', '20261018')).toBe(true);
    expect(isNewerVersion('20261018', '20261018')).toBe(false);
    expect(isNewerVersion('20250101', '20261018')).toBe(false);
  });
});

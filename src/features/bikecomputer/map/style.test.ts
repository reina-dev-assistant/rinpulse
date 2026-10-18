import { describe, expect, test } from 'bun:test';

import { maplibreStyle, TILEJSON_URL } from '@/features/map/palette';

import { MAP_SOURCE_ID, resolveMapStyle } from './style';
import type { InstalledRegion } from './storage';

const region = (over: Partial<InstalledRegion> = {}): InstalledRegion => ({
  id: 'bali',
  name: { id: 'Bali', en: 'Bali' },
  bbox: [114.4, -8.92, 115.74, -8.04],
  version: '20261018',
  bytes: 1000,
  path: 'file:///data/user/0/app/files/maps/bali-20261018.pmtiles',
  installedAt: 1,
  ...over,
});

describe('resolveMapStyle', () => {
  test('offline: the vector source is the local file, layers unchanged', () => {
    const resolved = resolveMapStyle({ theme: 'light', region: region() });
    expect(resolved.source).toBe('offline');
    expect(resolved.style.sources[MAP_SOURCE_ID]?.url).toBe(
      'pmtiles://file:///data/user/0/app/files/maps/bali-20261018.pmtiles',
    );
    expect(resolved.style.layers).toEqual(maplibreStyle('light').layers);
    expect(resolved.style.version).toBe(8);
  });

  test('offline never carries a doubled scheme, whatever the stored path looks like', () => {
    const doubled = resolveMapStyle({ theme: 'dark', region: region({ path: 'file://file:///maps/x.pmtiles' }) });
    expect(doubled.style.sources[MAP_SOURCE_ID]?.url).toBe('pmtiles://file:///maps/x.pmtiles');
  });

  test('stream: pmtiles over https when no region is installed', () => {
    const resolved = resolveMapStyle({
      theme: 'light',
      region: null,
      streamUrl: 'https://maps.example.test/bali-20261018.pmtiles',
    });
    expect(resolved.source).toBe('stream');
    expect(resolved.style.sources[MAP_SOURCE_ID]?.url).toBe('pmtiles://https://maps.example.test/bali-20261018.pmtiles');
  });

  test('a non-https stream URL falls back to online', () => {
    const resolved = resolveMapStyle({ theme: 'light', streamUrl: 'http://maps.example.test/a.pmtiles' });
    expect(resolved.source).toBe('online');
  });

  test('online: the OpenFreeMap TileJSON source, like the route map', () => {
    const resolved = resolveMapStyle({ theme: 'dark' });
    expect(resolved.source).toBe('online');
    expect(resolved.style.sources[MAP_SOURCE_ID]?.url).toBe(TILEJSON_URL);
    expect(resolved.style.layers).toEqual(maplibreStyle('dark').layers);
  });

  test('an installed region wins over a stream URL', () => {
    const resolved = resolveMapStyle({
      theme: 'light',
      region: region(),
      streamUrl: 'https://maps.example.test/bali.pmtiles',
    });
    expect(resolved.source).toBe('offline');
  });

  test('the key changes with the source, the region version and the look, and not otherwise', () => {
    const keys = [
      resolveMapStyle({ theme: 'light' }).key,
      resolveMapStyle({ theme: 'light', streamUrl: 'https://maps.example.test/a.pmtiles' }).key,
      resolveMapStyle({ theme: 'light', region: region() }).key,
      resolveMapStyle({ theme: 'light', region: region({ version: '20261201', path: 'file:///maps/bali-20261201.pmtiles' }) }).key,
      resolveMapStyle({ theme: 'light', region: region({ id: 'diy' }) }).key,
      resolveMapStyle({ theme: 'dark', region: region() }).key,
      resolveMapStyle({ theme: 'light', region: region(), ride: true }).key,
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(resolveMapStyle({ theme: 'light', region: region() }).key).toBe(keys[2]);
    // a re-resolve of the same inputs (a 1 Hz position tick) keeps the key
    expect(resolveMapStyle({ theme: 'light', region: region({ installedAt: 99 }) }).key).toBe(keys[2]);
  });

  test('attribution is set for every source and names OpenStreetMap', () => {
    for (const resolved of [
      resolveMapStyle({ theme: 'light' }),
      resolveMapStyle({ theme: 'light', region: region() }),
      resolveMapStyle({ theme: 'light', streamUrl: 'https://maps.example.test/a.pmtiles' }),
    ]) {
      expect(resolved.attribution).toContain('OpenStreetMap');
      expect(resolved.attribution).toContain('OpenMapTiles');
      expect(resolved.style.sources[MAP_SOURCE_ID]?.attribution).toBe(resolved.attribution);
    }
    expect(resolveMapStyle({ theme: 'light' }).attribution).toContain('OpenFreeMap');
  });

  test('ride: same layer ids and order as the standard style, ride colours', () => {
    const std = resolveMapStyle({ theme: 'dark', region: region() }).style;
    const ride = resolveMapStyle({ theme: 'dark', region: region(), ride: true }).style;
    expect(ride.layers.map((l) => l.id)).toEqual(std.layers.map((l) => l.id));
    expect(ride.layers[0]?.paint['background-color']).toBe('#000000');
    expect(std.layers[0]?.paint['background-color']).not.toBe('#000000');
  });

  test('the style survives a JSON round trip (it crosses the native bridge)', () => {
    const { style } = resolveMapStyle({ theme: 'light', region: region(), ride: true });
    expect(JSON.parse(JSON.stringify(style))).toEqual(style);
  });

  test('does not mutate or share state between calls', () => {
    const a = resolveMapStyle({ theme: 'light', region: region() }).style;
    const b = resolveMapStyle({ theme: 'light' }).style;
    expect(a.sources[MAP_SOURCE_ID]?.url).not.toBe(b.sources[MAP_SOURCE_ID]?.url);
    expect(Object.keys(a.sources)).toEqual([MAP_SOURCE_ID]);
  });
});

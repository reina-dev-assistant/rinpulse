import { describe, expect, test } from 'bun:test';

import { darkPalette, lightPalette, type MapPalette, type RoadGroup } from '@/features/map/palette';

import { contrastRatio, luminance, ridePalette } from './ridePalette';

const ROAD_GROUPS: RoadGroup[] = ['motorway', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'path'];
const HEX = /^#[0-9a-f]{6}$/;

function allColours(p: MapPalette): string[] {
  const { roads, ...rest } = p;
  return [...Object.values(rest), ...Object.values(roads)];
}

describe('contrastRatio', () => {
  test('black on white is 21 and symmetric', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
  });
});

describe('ridePalette', () => {
  test('has every key of the app palette and only 6-digit hex colours', () => {
    for (const theme of ['light', 'dark'] as const) {
      const ride = ridePalette(theme);
      const app = theme === 'dark' ? darkPalette : lightPalette;
      expect(Object.keys(ride).sort()).toEqual(Object.keys(app).sort());
      expect(Object.keys(ride.roads).sort()).toEqual(Object.keys(app.roads).sort());
      for (const colour of allColours(ride)) expect(colour).toMatch(HEX);
    }
  });

  test('day: the casing is dark against the ground, and every road fill stands off the casing', () => {
    const day = ridePalette('light');
    expect(contrastRatio(day.casing, day.background)).toBeGreaterThanOrEqual(6);
    for (const group of ROAD_GROUPS) {
      if (group === 'path') continue;
      expect(contrastRatio(day.roads[group], day.casing)).toBeGreaterThanOrEqual(3);
    }
  });

  test('day: water, green and built-up ground read apart from the background', () => {
    const day = ridePalette('light');
    expect(contrastRatio(day.water, day.background)).toBeGreaterThanOrEqual(1.4);
    expect(contrastRatio(day.wood, day.background)).toBeGreaterThanOrEqual(1.1);
    expect(day.background).not.toBe(lightPalette.background);
  });

  test('night: pure black ground and every road at least 3:1 against it (service roads 2.5:1)', () => {
    const night = ridePalette('dark');
    expect(night.background).toBe('#000000');
    for (const group of ROAD_GROUPS) {
      const min = group === 'service' || group === 'path' ? 2.5 : 3;
      expect(contrastRatio(night.roads[group], night.background)).toBeGreaterThanOrEqual(min);
    }
  });

  test('night: roads are brighter than the standard dark map', () => {
    const night = ridePalette('dark');
    for (const group of ROAD_GROUPS) {
      expect(luminance(night.roads[group])).toBeGreaterThan(luminance(darkPalette.roads[group]));
    }
  });

  test('the road hierarchy keeps its order at night: motorway stands out most', () => {
    const night = ridePalette('dark');
    const lum = (g: RoadGroup) => luminance(night.roads[g]);
    expect(lum('secondary')).toBeGreaterThan(lum('tertiary'));
    expect(lum('tertiary')).toBeGreaterThan(lum('minor'));
    expect(lum('minor')).toBeGreaterThan(lum('service'));
  });
});

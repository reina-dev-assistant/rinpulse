import { describe, expect, test } from 'bun:test';

import { contrast, resolveRideTheme, RIDE_PALETTES, toneColor, type RideTheme } from './ridePalette';
import type { FieldTone } from '../types';

const THEMES: readonly RideTheme[] = ['day', 'night'];

describe.each(THEMES)('ride palette: %s', (theme) => {
  const p = RIDE_PALETTES[theme];

  test('numerals pass 7:1 on the background and on the banner surface', () => {
    expect(contrast(p.foreground, p.background)).toBeGreaterThanOrEqual(7);
    expect(contrast(p.foreground, p.surface)).toBeGreaterThanOrEqual(7);
  });

  test('labels pass 4.5:1 on the background and on the surface', () => {
    expect(contrast(p.muted, p.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.muted, p.surface)).toBeGreaterThanOrEqual(4.5);
  });

  test('the seven zone colours, warn and accent pass 3:1 on the background', () => {
    expect(p.zones).toHaveLength(7);
    for (const zone of p.zones) expect(contrast(zone, p.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.warn, p.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.accent, p.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.offCourse, p.background)).toBeGreaterThanOrEqual(3);
  });

  test('zone colours are all different from each other', () => {
    expect(new Set(p.zones).size).toBe(7);
  });

  test('banner text passes 7:1 on its fill', () => {
    expect(contrast(p.onOffCourse, p.offCourse)).toBeGreaterThanOrEqual(7);
    expect(contrast(p.onUrgent, p.urgent)).toBeGreaterThanOrEqual(7);
  });

  test('the separator is visible but quieter than the labels', () => {
    expect(contrast(p.hairline, p.background)).toBeGreaterThanOrEqual(1.5);
    expect(contrast(p.hairline, p.background)).toBeLessThan(contrast(p.muted, p.background));
  });

  test('every colour is a plain #RRGGBB (no translucency)', () => {
    const all = [p.background, p.foreground, p.muted, p.hairline, p.surface, p.accent, p.warn, p.offCourse, p.onOffCourse, p.urgent, p.onUrgent, ...p.zones];
    for (const colour of all) expect(colour).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('contrast', () => {
  test('black on white is 21:1 and a colour on itself 1:1', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#336699', '#336699')).toBeCloseTo(1, 5);
  });
  test('is symmetric', () => {
    expect(contrast('#0B57D0', '#FFFFFF')).toBeCloseTo(contrast('#FFFFFF', '#0B57D0'), 10);
  });
});

describe('resolveRideTheme', () => {
  test('auto follows the app scheme, the others pin', () => {
    expect(resolveRideTheme('auto', 'light')).toBe('day');
    expect(resolveRideTheme('auto', 'dark')).toBe('night');
    expect(resolveRideTheme('day', 'dark')).toBe('day');
    expect(resolveRideTheme('night', 'light')).toBe('night');
  });
});

describe('toneColor', () => {
  const p = RIDE_PALETTES.day;
  test('maps neutral, warn and zone tones', () => {
    expect(toneColor(p, 'neutral')).toBe(p.foreground);
    expect(toneColor(p, 'warn')).toBe(p.warn);
    expect(toneColor(p, 'zone1')).toBe(p.zones[0]);
    expect(toneColor(p, 'zone7')).toBe(p.zones[6]);
  });
  test('an unknown tone falls back to the foreground', () => {
    expect(toneColor(p, 'zone9' as FieldTone)).toBe(p.foreground);
  });
});

import { describe, expect, test } from 'bun:test';

import { DEFAULT_BIKE_SETTINGS, mergeSettings, sanitizeSettings } from './settingsModel';

describe('sanitizeSettings', () => {
  test('nothing, garbage and the defaults themselves give the defaults', () => {
    for (const raw of [undefined, null, 5, 'x', [], {}]) expect(sanitizeSettings(raw)).toEqual(DEFAULT_BIKE_SETTINGS);
    expect(sanitizeSettings(JSON.parse(JSON.stringify(DEFAULT_BIKE_SETTINGS)))).toEqual(DEFAULT_BIKE_SETTINGS);
  });

  test('numbers are clamped into range and rounded', () => {
    const s = sanitizeSettings({ offCourseM: 5, dimAfterSec: 9999, dimLevel: 7, autoLap: { mode: 'distance', everyM: 12 } });
    expect(s.offCourseM).toBe(30);
    expect(s.dimAfterSec).toBe(120);
    expect(s.dimLevel).toBe(1);
    expect(s.autoLap).toEqual({ mode: 'distance', everyM: 1000 });
    expect(sanitizeSettings({ offCourseM: 77.6 }).offCourseM).toBe(78);
  });

  test('unknown theme and auto-lap mode fall back', () => {
    const s = sanitizeSettings({ theme: 'neon', autoLap: { mode: 'sometimes' } });
    expect(s.theme).toBe('auto');
    expect(s.autoLap).toEqual({ mode: 'off' });
  });

  test('zone bands are ordered and inside the zone count', () => {
    const s = sanitizeSettings({ alerts: { hr: { enabled: true, minZone: 5, maxZone: 2 }, power: { minZone: 0, maxZone: 99 } } });
    expect(s.alerts.hr).toEqual({ enabled: true, minZone: 2, maxZone: 5 });
    expect(s.alerts.power.minZone).toBe(1);
    expect(s.alerts.power.maxZone).toBe(7);
  });

  test('a reminder never ends up with no trigger, and keeps a distance trigger when asked for', () => {
    const none = sanitizeSettings({ alerts: { eat: { enabled: true, everySec: null, everyM: null } } });
    expect(none.alerts.eat.everySec).toBe(1800);
    const dist = sanitizeSettings({ alerts: { drink: { enabled: true, everySec: null, everyM: 10_000 } } });
    expect(dist.alerts.drink).toEqual({ enabled: true, everySec: null, everyM: 10_000 });
  });

  test('wrongly typed flags keep the default', () => {
    const s = sanitizeSettings({ enabled: 'yes', autoPause: 0, alerts: { vibrate: 'no' } });
    expect(s.enabled).toBe(false);
    expect(s.autoPause).toBe(true);
    expect(s.alerts.vibrate).toBe(true);
  });
});

describe('mergeSettings', () => {
  test('applies a patch and repairs the result', () => {
    const next = mergeSettings(DEFAULT_BIKE_SETTINGS, { enabled: true, offCourseM: 1000 });
    expect(next.enabled).toBe(true);
    expect(next.offCourseM).toBe(200);
    expect(DEFAULT_BIKE_SETTINGS.enabled).toBe(false);
  });
});

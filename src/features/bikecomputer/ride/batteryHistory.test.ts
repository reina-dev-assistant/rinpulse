import { describe, expect, test } from 'bun:test';

import { estimateBattery, measuredPctPerHour, profileKey, type BatteryProfile } from './batteryEstimate';
import { appendHistory, MAX_HISTORY, parseHistory } from './batteryHistory';

const profile: BatteryProfile = { screen: 'dim', map: true, sensors: 2, liveShare: false, gps: true };

describe('parseHistory', () => {
  test('garbage gives an empty history', () => {
    for (const raw of [null, undefined, 4, 'x', {}, [null, 3, 'a', { profileKey: 1 }]]) expect(parseHistory(raw)).toEqual([]);
  });

  test('implausible rates are dropped and a missing weight becomes 1', () => {
    const out = parseHistory([
      { profileKey: 'a', pctPerHour: 0.2 },
      { profileKey: 'a', pctPerHour: 400 },
      { profileKey: 'a', pctPerHour: 9.5 },
      { profileKey: 'b', pctPerHour: 12, weight: -3 },
    ]);
    expect(out).toEqual([
      { profileKey: 'a', pctPerHour: 9.5, weight: 1 },
      { profileKey: 'b', pctPerHour: 12, weight: 1 },
    ]);
  });

  test('keeps only the newest entries', () => {
    const many = Array.from({ length: MAX_HISTORY + 5 }, (_, i) => ({ profileKey: 'a', pctPerHour: 5 + i, weight: 1 }));
    const out = parseHistory(many);
    expect(out.length).toBe(MAX_HISTORY);
    expect(out[0]?.pctPerHour).toBe(10);
  });
});

describe('a ride feeds the next estimate', () => {
  test('three rides of the same profile make the estimate measured', () => {
    const key = profileKey(profile);
    const before = estimateBattery({ batteryPct: 100, charging: false, profile, plannedSec: null, history: [] });
    expect(before.source).toBe('model');
    const drain = measuredPctPerHour(90, 70, 2 * 3600, false);
    expect(drain).toBe(10);
    let history = parseHistory([]);
    for (let i = 0; i < 3; i++) history = appendHistory(history, { profileKey: key, pctPerHour: drain ?? 0, weight: 1 });
    const after = estimateBattery({ batteryPct: 100, charging: false, profile, plannedSec: null, history });
    expect(after.source).toBe('measured');
    expect(after.pctPerHour).toBeCloseTo(10, 1);
    expect(after.hoursLeft).toBeCloseTo(9, 1);
  });

  test('an implausible measured rate is not stored', () => {
    expect(appendHistory([], { profileKey: 'a', pctPerHour: 0.1, weight: 1 })).toEqual([]);
  });
});

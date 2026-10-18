import { describe, expect, it } from 'bun:test';

import {
  BATTERY_MODEL,
  estimateBattery,
  measuredPctPerHour,
  modelPctPerHour,
  profileKey,
  saverProfile,
  type BatteryInput,
  type BatteryProfile,
} from './batteryEstimate';

/** Dim screen, GPS only: 3 + 4 + 2.5 = 9.5 %/h. */
const DIM: BatteryProfile = { screen: 'dim', map: false, sensors: 0, liveShare: false, gps: true };

function input(over: Partial<BatteryInput> = {}): BatteryInput {
  return { batteryPct: 100, charging: false, profile: DIM, plannedSec: null, history: [], ...over };
}

describe('model', () => {
  it('adds the parts by hand', () => {
    expect(modelPctPerHour(DIM)).toBeCloseTo(9.5, 9);
    // dim 2.5 + map 3 + 2 sensors 1.4 + live 2.5 + base 3 + gps 4 = 16.4
    expect(modelPctPerHour({ screen: 'dim', map: true, sensors: 2, liveShare: true, gps: true })).toBeCloseTo(16.4, 9);
    // bright 9 + map 3 + 3 sensors 2.1 + live 2.5 + 7 = 23.6
    expect(modelPctPerHour({ screen: 'bright', map: true, sensors: 3, liveShare: true, gps: true })).toBeCloseTo(23.6, 9);
    // screen off, nothing else: 7.
    expect(modelPctPerHour({ screen: 'off', map: false, sensors: 0, liveShare: false, gps: true })).toBe(7);
  });

  it('caps the sensors at 3 and ignores a negative count', () => {
    const three = modelPctPerHour({ ...DIM, sensors: 3 });
    expect(modelPctPerHour({ ...DIM, sensors: 7 })).toBe(three);
    expect(modelPctPerHour({ ...DIM, sensors: -2 })).toBe(modelPctPerHour(DIM));
  });

  it('exposes its constants in one place', () => {
    expect(BATTERY_MODEL.screen.bright).toBeGreaterThan(BATTERY_MODEL.screen.dim);
    expect(BATTERY_MODEL.screen.dim).toBeGreaterThan(BATTERY_MODEL.screen.off);
  });
});

describe('estimate from the model', () => {
  it('hours left = (battery - reserve) / drain', () => {
    const e = estimateBattery(input());
    // (100 - 10) / 9.5
    expect(e.pctPerHour).toBeCloseTo(9.5, 9);
    expect(e.hoursLeft).toBeCloseTo(90 / 9.5, 9);
    expect(e.source).toBe('model');
    expect(e.enough).toBeNull();
    expect(e.warn).toBe('none');
  });

  it('takes its own reserve', () => {
    expect(estimateBattery(input({ batteryPct: 50, reservePct: 20 })).hoursLeft).toBeCloseTo(30 / 9.5, 9);
  });

  it('a battery under the reserve has no hours left', () => {
    const e = estimateBattery(input({ batteryPct: 8 }));
    expect(e.hoursLeft).toBe(0);
    expect(estimateBattery(input({ batteryPct: 8, plannedSec: 600 })).warn).toBe('short');
  });

  it('a brighter screen and the map shorten it', () => {
    const dim = estimateBattery(input()).hoursLeft;
    const bright = estimateBattery(input({ profile: { ...DIM, screen: 'bright', map: true } })).hoursLeft;
    // (100 - 10) / (3 + 4 + 9 + 3)
    expect(bright).toBeCloseTo(90 / 19, 9);
    expect(bright).toBeLessThan(dim);
  });
});

describe('warning against the plan', () => {
  // 90 / 9.5 h = 34 105.26 s available.
  it('short when the plan needs more than the battery gives', () => {
    const e = estimateBattery(input({ plannedSec: 34_106 }));
    expect(e.enough).toBe(false);
    expect(e.warn).toBe('short');
  });

  it('tight when it fits with less than 25 % to spare', () => {
    const e = estimateBattery(input({ plannedSec: 34_105 }));
    expect(e.enough).toBe(true);
    expect(e.warn).toBe('tight');
    // The battery is 25 % above a plan of 34 105.26 / 1.25 = 27 284.2 s: a plan of 27 285 s is tight, 27 284 s has the margin.
    expect(estimateBattery(input({ plannedSec: 27_285 })).warn).toBe('tight');
    expect(estimateBattery(input({ plannedSec: 27_284 })).warn).toBe('none');
  });

  it('none with room to spare', () => {
    const e = estimateBattery(input({ plannedSec: 3600 }));
    expect(e.enough).toBe(true);
    expect(e.warn).toBe('none');
  });

  it('no warning while charging, but the numbers are the battery alone', () => {
    const e = estimateBattery(input({ plannedSec: 100_000, charging: true }));
    expect(e.enough).toBe(false);
    expect(e.warn).toBe('none');
    expect(e.hoursLeft).toBeCloseTo(90 / 9.5, 9);
  });

  it('a plan of zero seconds is always enough', () => {
    expect(estimateBattery(input({ plannedSec: 0 })).enough).toBe(true);
  });
});

describe('history', () => {
  const key = profileKey(DIM);

  it('one ride blends a third measured, two thirds model', () => {
    const e = estimateBattery(input({ history: [{ profileKey: key, pctPerHour: 14, weight: 1 }] }));
    // 14 / 3 + 9.5 x 2 / 3
    expect(e.pctPerHour).toBeCloseTo(14 / 3 + 19 / 3, 9);
    expect(e.source).toBe('blend');
  });

  it('two rides blend two thirds measured', () => {
    const e = estimateBattery(
      input({
        history: [
          { profileKey: key, pctPerHour: 14, weight: 1 },
          { profileKey: key, pctPerHour: 12, weight: 1 },
        ],
      }),
    );
    // measured 13; 13 x 2/3 + 9.5 x 1/3
    expect(e.pctPerHour).toBeCloseTo(26 / 3 + 9.5 / 3, 9);
    expect(e.source).toBe('blend');
  });

  it('three rides use the measured mean alone (weighted)', () => {
    const e = estimateBattery(
      input({
        history: [
          { profileKey: key, pctPerHour: 12, weight: 1 },
          { profileKey: key, pctPerHour: 15, weight: 2 },
        ],
      }),
    );
    // (12 + 30) / 3 = 14
    expect(e.pctPerHour).toBeCloseTo(14, 9);
    expect(e.source).toBe('measured');
    expect(e.hoursLeft).toBeCloseTo(90 / 14, 9);
  });

  it('more than three rides do not change the weight of the model, which is already zero', () => {
    const history = Array.from({ length: 6 }, () => ({ profileKey: key, pctPerHour: 11, weight: 1 }));
    expect(estimateBattery(input({ history })).pctPerHour).toBeCloseTo(11, 9);
  });

  it('only rides with the same profile count', () => {
    const e = estimateBattery(
      input({
        history: [
          { profileKey: profileKey({ ...DIM, map: true }), pctPerHour: 30, weight: 5 },
          { profileKey: key, pctPerHour: 14, weight: 1 },
        ],
      }),
    );
    expect(e.pctPerHour).toBeCloseTo(14 / 3 + 19 / 3, 9);
    expect(e.source).toBe('blend');
  });

  it('with no matching ride it is the model', () => {
    const e = estimateBattery(input({ history: [{ profileKey: 'other', pctPerHour: 30, weight: 5 }] }));
    expect(e.source).toBe('model');
    expect(e.pctPerHour).toBeCloseTo(9.5, 9);
  });

  it('skips entries that cannot be right', () => {
    const e = estimateBattery(
      input({
        history: [
          { profileKey: key, pctPerHour: 0, weight: 3 },
          { profileKey: key, pctPerHour: -4, weight: 3 },
          { profileKey: key, pctPerHour: Number.NaN, weight: 3 },
          { profileKey: key, pctPerHour: 12, weight: 0 },
        ],
      }),
    );
    expect(e.source).toBe('model');
  });
});

describe('profileKey', () => {
  it('is the same for the same profile and differs for each part', () => {
    expect(profileKey(DIM)).toBe(profileKey({ ...DIM }));
    const keys = new Set([
      profileKey(DIM),
      profileKey({ ...DIM, screen: 'bright' }),
      profileKey({ ...DIM, screen: 'off' }),
      profileKey({ ...DIM, map: true }),
      profileKey({ ...DIM, sensors: 2 }),
      profileKey({ ...DIM, liveShare: true }),
    ]);
    expect(keys.size).toBe(6);
  });

  it('sensors beyond three are the same profile as three, as in the model', () => {
    expect(profileKey({ ...DIM, sensors: 3 })).toBe(profileKey({ ...DIM, sensors: 5 }));
  });
});

describe('measuredPctPerHour', () => {
  it('is the drop per hour, rounded to 0.1', () => {
    expect(measuredPctPerHour(80, 60, 3600, false)).toBe(20);
    // 20 points in 1.5 h = 13.33
    expect(measuredPctPerHour(90, 70, 5400, false)).toBe(13.3);
    // 2 points in 20 min = 6
    expect(measuredPctPerHour(50, 48, 1200, false)).toBe(6);
  });

  it('is null when the phone charged during the ride', () => {
    expect(measuredPctPerHour(80, 60, 3600, true)).toBeNull();
  });

  it('is null for a ride under 20 minutes', () => {
    expect(measuredPctPerHour(80, 60, 1199, false)).toBeNull();
    expect(measuredPctPerHour(80, 60, 1200, false)).toBe(60);
  });

  it('is null for a drop under 2 points, or none, or a gain', () => {
    expect(measuredPctPerHour(80, 79, 7200, false)).toBeNull();
    expect(measuredPctPerHour(80, 80, 7200, false)).toBeNull();
    expect(measuredPctPerHour(60, 70, 7200, false)).toBeNull();
    expect(measuredPctPerHour(80, 78, 7200, false)).toBe(1);
  });
});

describe('saver profile', () => {
  const heavy: BatteryProfile = { screen: 'bright', map: true, sensors: 2, liveShare: true, gps: true };

  it('dims the screen, drops the map, keeps the sensors and the live link', () => {
    expect(saverProfile(heavy)).toEqual({ screen: 'dim', map: false, sensors: 2, liveShare: true, gps: true });
  });

  it('its estimate is lower drain and more hours', () => {
    const full = estimateBattery(input({ profile: heavy }));
    const saver = estimateBattery(input({ profile: saverProfile(heavy) }));
    // 3 + 4 + 2.5 + 2 sensors 1.4 + live 2.5 = 13.4 (the heavy profile is 22.9)
    expect(full.pctPerHour).toBeCloseTo(22.9, 9);
    expect(saver.pctPerHour).toBeCloseTo(13.4, 9);
    expect(saver.pctPerHour).toBeLessThan(full.pctPerHour);
    expect(saver.hoursLeft).toBeGreaterThan(full.hoursLeft);
  });

  it('an off screen stays off', () => {
    const off: BatteryProfile = { ...heavy, screen: 'off' };
    expect(saverProfile(off).screen).toBe('off');
    expect(modelPctPerHour(saverProfile(off))).toBeLessThanOrEqual(modelPctPerHour(off));
  });

  it('is a different profile key, so its history is kept apart', () => {
    expect(profileKey(saverProfile(heavy))).not.toBe(profileKey(heavy));
  });
});

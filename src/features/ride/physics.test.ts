import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_GEAR_INDEX,
  DEFAULT_RIDER_KG,
  GEARS,
  GEAR_COUNT,
  MAX_SPEED_MS,
  clampGear,
  climbGear,
  driveSpeed,
  effortFromHr,
  estimatePower,
  gearRatio,
  powerAtSpeed,
  speedFromPower,
  stepSpeed,
} from './physics';

const KG = DEFAULT_RIDER_KG;

/** Runs the model for `seconds` at 4 steps a second and returns the last result. */
function run(v0: number, seconds: number, input: Parameters<typeof stepSpeed>[1]) {
  let v = v0;
  let last = { vMs: v0, pwrW: 0 };
  for (let i = 0; i < seconds * 4; i++) {
    last = stepSpeed(v, input, 0.25);
    v = last.vMs;
  }
  return last;
}

describe('gears', () => {
  it('are sorted easiest first, distinct, and a usable number', () => {
    expect(GEAR_COUNT).toBeGreaterThanOrEqual(12);
    expect(GEAR_COUNT).toBeLessThanOrEqual(20);
    for (let i = 1; i < GEARS.length; i++) expect(GEARS[i]!.ratio).toBeGreaterThan(GEARS[i - 1]!.ratio * 1.04);
    expect(GEARS[0]!.label).toBe('34x28');
    expect(GEARS[GEARS.length - 1]!.label).toBe('50x11');
  });

  it('start in a middling gear, and out-of-range indexes land on the ends', () => {
    expect(gearRatio(DEFAULT_GEAR_INDEX)).toBeGreaterThan(2.1);
    expect(gearRatio(DEFAULT_GEAR_INDEX)).toBeLessThan(2.5);
    expect(clampGear(-3)).toBe(0);
    expect(clampGear(99)).toBe(GEAR_COUNT - 1);
    expect(clampGear(NaN)).toBe(DEFAULT_GEAR_INDEX);
    expect(gearRatio(-1)).toBe(GEARS[0]!.ratio);
  });
});

describe('driveSpeed', () => {
  it('is cadence x ratio x wheel: 90 rpm in 50x15 on 700x25c is 37.9 km/h', () => {
    const index = GEARS.findIndex((g) => g.label === '50x15');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(driveSpeed(90, index) * 3.6).toBeCloseTo(((90 * 50) / 15) * 2.105 * 0.06, 6);
    expect(driveSpeed(90, index) * 3.6).toBeCloseTo(37.9, 1);
  });

  it('is 0 without cadence and grows with both cadence and gear', () => {
    expect(driveSpeed(0, 5)).toBe(0);
    expect(driveSpeed(-4, 5)).toBe(0);
    expect(driveSpeed(NaN, 5)).toBe(0);
    expect(driveSpeed(90, 6)).toBeGreaterThan(driveSpeed(90, 5));
    expect(driveSpeed(100, 5)).toBeGreaterThan(driveSpeed(80, 5));
  });
});

describe('power and speed', () => {
  it('match the textbook figure for a 70 kg rider on the flat: 200 W is about 32 km/h', () => {
    const v = speedFromPower(200, 0, KG);
    expect(v * 3.6).toBeGreaterThan(30);
    expect(v * 3.6).toBeLessThan(34);
  });

  it('are inverse of each other', () => {
    for (const grade of [-6, 0, 3, 8, 12]) {
      for (const watts of [60, 150, 300]) {
        const v = speedFromPower(watts, grade, KG);
        expect(powerAtSpeed(v, grade, KG)).toBeCloseTo(watts, 1);
      }
    }
  });

  it('climbing needs more power and slows the same power down', () => {
    expect(powerAtSpeed(6, 8, KG)).toBeGreaterThan(powerAtSpeed(6, 0, KG) * 3);
    expect(speedFromPower(250, 8, KG) * 3.6).toBeLessThan(speedFromPower(250, 0, KG) * 3.6 / 2);
  });

  it('a heavier rider needs more power for the same climb', () => {
    expect(powerAtSpeed(5, 6, 90)).toBeGreaterThan(powerAtSpeed(5, 6, 60));
  });

  it('a descent: gravity holds speed with no power, capped', () => {
    expect(powerAtSpeed(10, -6, KG)).toBe(0);
    const coast = speedFromPower(0, -6, KG);
    expect(coast).toBeGreaterThan(12);
    expect(coast).toBeLessThanOrEqual(MAX_SPEED_MS);
    expect(speedFromPower(0, -20, KG)).toBe(MAX_SPEED_MS);
    expect(speedFromPower(0, 0, KG)).toBe(0);
  });

  it('drafting (cdaScale below 1) lowers the power for a speed and raises the speed for a power, everywhere', () => {
    expect(powerAtSpeed(11, 0, KG, 0.7)).toBeLessThan(powerAtSpeed(11, 0, KG));
    expect(speedFromPower(200, 0, KG, 0.7)).toBeGreaterThan(speedFromPower(200, 0, KG));
    expect(powerAtSpeed(11, 0, KG, 1)).toBe(powerAtSpeed(11, 0, KG));
    const v = driveSpeed(90, DEFAULT_GEAR_INDEX);
    const solo = { cadRpm: 90, gearIdx: DEFAULT_GEAR_INDEX, gradePct: 0, massKg: KG, vMs: v };
    expect(estimatePower({ ...solo, cdaScale: 0.7 })).toBeLessThan(estimatePower(solo));
    expect(run(0, 60, { ...solo, cdaScale: 0.7 }).pwrW).toBeLessThan(run(0, 60, solo).pwrW);
  });
});

describe('estimatePower', () => {
  const base = { gearIdx: DEFAULT_GEAR_INDEX, gradePct: 0, massKg: KG };

  it('is 0 while coasting: no cadence, or pedals slower than the wheel', () => {
    expect(estimatePower({ ...base, cadRpm: 0, vMs: 8 })).toBe(0);
    expect(estimatePower({ ...base, cadRpm: 40, vMs: 15 })).toBe(0);
  });

  it('is the power needed to hold the speed while pedalling', () => {
    const v = driveSpeed(85, DEFAULT_GEAR_INDEX);
    const watts = estimatePower({ ...base, cadRpm: 85, vMs: v });
    expect(watts).toBeCloseTo(powerAtSpeed(v, 0, KG), 6);
    expect(watts).toBeGreaterThan(50);
  });
});

describe('stepSpeed', () => {
  const gear = DEFAULT_GEAR_INDEX;

  it('reaches the cadence speed on the flat and then holds it with a steady estimated power', () => {
    const input = { cadRpm: 80, gearIdx: gear, gradePct: 0, massKg: KG };
    const target = driveSpeed(80, gear);
    const settled = run(0, 60, input);
    expect(settled.vMs).toBeCloseTo(target, 3);
    expect(settled.pwrW).toBeCloseTo(powerAtSpeed(target, 0, KG), 0);
  });

  it('accelerates gradually, not in one step', () => {
    const first = stepSpeed(0, { cadRpm: 90, gearIdx: gear, gradePct: 0, massKg: KG }, 0.25);
    expect(first.vMs).toBeGreaterThan(0);
    expect(first.vMs).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(first.pwrW).toBeGreaterThan(0);
  });

  it('on a steep climb a hard gear is power-limited, and an easy gear is faster', () => {
    const hard = run(5, 90, { cadRpm: 90, gearIdx: GEAR_COUNT - 3, gradePct: 10, massKg: KG });
    const easy = run(5, 90, { cadRpm: 80, gearIdx: 2, gradePct: 10, massKg: KG });
    expect(hard.vMs).toBeLessThan(driveSpeed(90, GEAR_COUNT - 3));
    expect(hard.pwrW).toBeCloseTo(KG * 6, 0);
    expect(easy.vMs).toBeCloseTo(driveSpeed(80, 2), 3);
    expect(easy.pwrW).toBeLessThan(KG * 6);
  });

  it('a stronger rider (maxPowerW) climbs faster in the same gear', () => {
    const input = { cadRpm: 90, gearIdx: GEAR_COUNT - 3, gradePct: 10, massKg: KG };
    expect(run(5, 90, { ...input, maxPowerW: 500 }).vMs).toBeGreaterThan(run(5, 90, { ...input, maxPowerW: 250 }).vMs);
  });

  it('coasting slows the bike down on the flat with no power, and stops it eventually', () => {
    const input = { cadRpm: 0, gearIdx: gear, gradePct: 0, massKg: KG };
    const slower = run(10, 10, input);
    expect(slower.vMs).toBeLessThan(10);
    expect(slower.vMs).toBeGreaterThan(0);
    expect(slower.pwrW).toBe(0);
    expect(run(10, 600, input).vMs).toBe(0);
  });

  it('coasting uphill slows faster than on the flat', () => {
    const flat = run(10, 5, { cadRpm: 0, gearIdx: gear, gradePct: 0, massKg: KG }).vMs;
    const hill = run(10, 5, { cadRpm: 0, gearIdx: gear, gradePct: 6, massKg: KG }).vMs;
    expect(hill).toBeLessThan(flat);
  });

  it('coasting downhill speeds the bike up, towards the terminal speed', () => {
    const down = run(3, 300, { cadRpm: 0, gearIdx: gear, gradePct: -6, massKg: KG });
    expect(down.vMs).toBeGreaterThan(10);
    expect(down.vMs).toBeCloseTo(speedFromPower(0, -6, KG), 1);
    expect(down.pwrW).toBe(0);
  });

  it('pedals slower than the wheel freewheel until the bike has slowed to them', () => {
    const input = { cadRpm: 60, gearIdx: gear, gradePct: 0, massKg: KG };
    const first = stepSpeed(15, input, 0.25);
    expect(first.vMs).toBeLessThan(15);
    expect(first.pwrW).toBe(0);
    const settled = run(15, 120, input);
    expect(settled.vMs).toBeCloseTo(driveSpeed(60, gear), 3);
    expect(settled.pwrW).toBeGreaterThan(0);
  });

  it('never goes negative or past the cap, and a zero step changes nothing', () => {
    expect(stepSpeed(0, { cadRpm: 0, gearIdx: gear, gradePct: 15, massKg: KG }, 1).vMs).toBe(0);
    expect(run(0, 120, { cadRpm: 300, gearIdx: GEAR_COUNT - 1, gradePct: -15, massKg: KG, maxPowerW: 2000 }).vMs).toBeLessThanOrEqual(MAX_SPEED_MS);
    const still = stepSpeed(7, { cadRpm: 90, gearIdx: gear, gradePct: 0, massKg: KG }, 0);
    expect(still.vMs).toBe(7);
  });
});

describe('effortFromHr', () => {
  it('is the share of the heart rate reserve, 0 to 1', () => {
    expect(effortFromHr(60)).toBe(0);
    expect(effortFromHr(125)).toBeCloseTo(0.5, 6);
    expect(effortFromHr(190)).toBe(1);
    expect(effortFromHr(220)).toBe(1);
    expect(effortFromHr(0)).toBe(0);
    expect(effortFromHr(150, 100, 100)).toBe(0);
  });

  it('the auto gear keeps a climb near 200-250 W at 80 rpm and the flat in the default gear', () => {
    expect(climbGear(0, 79)).toBe(DEFAULT_GEAR_INDEX);
    const w6 = powerAtSpeed(driveSpeed(80, climbGear(6, 79)), 6, 79);
    expect(w6).toBeGreaterThanOrEqual(200);
    expect(w6).toBeLessThanOrEqual(250);
    expect(climbGear(10.8, 79)).toBe(0);
    expect(climbGear(8, 79)).toBeLessThanOrEqual(climbGear(4, 79));
    // Descents need 0 W in every gear: stay in the default, do not spin out in the easiest.
    expect(climbGear(-1.7, 79)).toBe(DEFAULT_GEAR_INDEX);
    expect(climbGear(-8, 79)).toBe(DEFAULT_GEAR_INDEX);
  });
});

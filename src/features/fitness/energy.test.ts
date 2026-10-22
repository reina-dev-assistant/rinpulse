import { describe, expect, it } from 'bun:test';

import { applyLocale } from '@/i18n';
import { energyNow, energyWord, wakeLevel, type EnergyInput } from './energy';
import { hrZonesForMax } from '@/features/hrzones/zones';

const H = 3600;
const WAKE = 1_000_000 * 1 - (1_000_000 % 3600);
const base: EnergyInput = {
  nowSec: WAKE,
  wakeSec: WAKE,
  asleepSec: 7.5 * H,
  needSec: 7.5 * H,
  recoveryZ: null,
  zones: hrZonesForMax(190),
  samples: [],
  stress: [],
  naps: [],
  restingHr: 55,
};
const minute = (ts: number, heartRate: number, steps = 0) => ({ timestamp: ts, steps, heartRate });

describe('wakeLevel', () => {
  it('is 90 after a full night, 30 with none, and moves 10 with recovery', () => {
    expect(wakeLevel(7.5 * H, 7.5 * H, null)).toBe(90);
    expect(wakeLevel(0, 7.5 * H, null)).toBe(30);
    expect(wakeLevel(3.75 * H, 7.5 * H, null)).toBe(60);
    expect(wakeLevel(7.5 * H, 7.5 * H, 1)).toBe(100);
    expect(wakeLevel(7.5 * H, 7.5 * H, 5)).toBe(100);
    expect(wakeLevel(7.5 * H, 7.5 * H, -1)).toBe(80);
    expect(wakeLevel(0, 7.5 * H, -3)).toBe(20);
  });
  it('does not credit more than the need, and survives a zero need', () => {
    expect(wakeLevel(12 * H, 7.5 * H, null)).toBe(90);
    expect(wakeLevel(5 * H, 0, null)).toBe(30);
  });
});

describe('energyNow', () => {
  it('is the wake level the moment you wake up', () => {
    const e = energyNow(base);
    expect(e?.level).toBe(90);
    expect(e?.series).toEqual([{ ts: WAKE, level: 90 }, { ts: WAKE, level: 90 }]);
  });

  it('drains 0.8 an hour just by being awake', () => {
    const e = energyNow({ ...base, nowSec: WAKE + 10 * H });
    expect(e?.parts.awake).toBeCloseTo(-8);
    expect(e?.level).toBeCloseTo(82);
  });

  it('drains with strain: an hour in zone 3 (TRIMP 180) costs 55 x strain / 21', () => {
    const samples = Array.from({ length: 60 }, (_, i) => minute(WAKE + i * 60, Math.round(0.75 * 190), 100));
    const e = energyNow({ ...base, nowSec: WAKE + H, samples });
    const strain = 21 * (1 - Math.exp(-180 / 250));
    expect(e?.parts.strain).toBeCloseTo(-(55 * strain) / 21, 1);
    expect((e?.level ?? 100)).toBeLessThan(90 - 20);
  });

  it('drains with stress above 40 and not at or below it', () => {
    const calm = energyNow({ ...base, nowSec: WAKE + 10 * H, stress: [{ ts: WAKE + H, value: 40 }] });
    const tense = energyNow({ ...base, nowSec: WAKE + 10 * H, stress: [{ ts: WAKE + H, value: 100 }] });
    expect(calm?.parts.stress).toBeCloseTo(0);
    expect(tense?.parts.stress).toBeCloseTo(-10);
  });

  it('charges with naps, 5 an hour, and only for the part after waking and before now', () => {
    const e = energyNow({ ...base, nowSec: WAKE + 6 * H, asleepSec: 3.75 * H, naps: [{ start: WAKE + 4 * H, end: WAKE + 5 * H }] });
    expect(e?.parts.naps).toBeCloseTo(5);
    const cut = energyNow({ ...base, nowSec: WAKE + 4.5 * H, naps: [{ start: WAKE + 4 * H, end: WAKE + 5 * H }] });
    expect(cut?.parts.naps).toBeCloseTo(2.5);
    const before = energyNow({ ...base, nowSec: WAKE + 2 * H, naps: [{ start: WAKE - 2 * H, end: WAKE - H }] });
    expect(before?.parts.naps).toBe(0);
  });

  it('charges a little for still minutes near the resting rate', () => {
    const samples = Array.from({ length: 60 }, (_, i) => minute(WAKE + i * 60, 60));
    const e = energyNow({ ...base, nowSec: WAKE + H, samples });
    expect(e?.parts.rest).toBeCloseTo(0.4);
    const walking = energyNow({ ...base, nowSec: WAKE + H, samples: samples.map((s) => ({ ...s, steps: 50 })) });
    expect(walking?.parts.rest).toBe(0);
    const high = energyNow({ ...base, nowSec: WAKE + H, samples: samples.map((s) => ({ ...s, heartRate: 70 })) });
    expect(high?.parts.rest).toBe(0);
  });

  it('stays inside 0..100', () => {
    const samples = Array.from({ length: 600 }, (_, i) => minute(WAKE + i * 60, 185, 100));
    const e = energyNow({ ...base, asleepSec: 0, nowSec: WAKE + 14 * H, samples, stress: [{ ts: WAKE + H, value: 100 }] });
    expect(e?.level).toBe(0);
    expect(energyNow({ ...base, recoveryZ: 3 })?.level).toBe(100);
  });

  it('has hourly points up to now', () => {
    const e = energyNow({ ...base, nowSec: WAKE + 3.5 * H });
    expect(e?.series.map((p) => p.ts)).toEqual([WAKE, WAKE + H, WAKE + 2 * H, WAKE + 3 * H, WAKE + 3.5 * H]);
    expect(e?.series[e.series.length - 1].level).toBe(e?.level);
  });

  it('has no level before waking or when the wake-up is over 36 h back', () => {
    expect(energyNow({ ...base, nowSec: WAKE - 1 })).toBeNull();
    expect(energyNow({ ...base, nowSec: WAKE + 36 * H })).not.toBeNull();
    expect(energyNow({ ...base, nowSec: WAKE + 36 * H + 1 })).toBeNull();
  });
});

describe('energyWord', () => {
  it('speaks English when asked', async () => {
    await applyLocale('en');
    try {
      expect([80, 60, 30, 5].map(energyWord)).toEqual(['Full', 'Enough', 'Running low', 'Almost empty']);
    } finally {
      await applyLocale('id');
    }
  });
  it('has bands at 25, 50 and 75', () => {
    expect([100, 75, 74, 50, 49, 25, 24, 0].map(energyWord)).toEqual(['Penuh', 'Penuh', 'Cukup', 'Cukup', 'Menipis', 'Menipis', 'Hampir habis', 'Hampir habis']);
  });
});

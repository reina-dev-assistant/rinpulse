import { describe, expect, it } from 'bun:test';

import type { Scores } from '@/features/today/scores';
import { activeKcalByDate, cleanActiveKcal, ROGO_MAX_ACTIVE_KCAL } from './rogoActive';
import { rogoScoreDays, ROGO_SCORE_DAYS } from './rogoScores';

const sec = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m, d, h, min).getTime() / 1000;
const TODAY = sec(2026, 9, 18);
const key = (d: number) => `2026-10-${d}`;
/** Small calories: 1000 = 1 kcal. */
const kcal = (n: number) => n * 1000;

const noScores = (over: Partial<Scores> = {}): Scores => ({
  maxHr: 190,
  strain: [],
  today: null,
  readiness: { headline: null, signals: [], missing: [], recovery: null, recoveryWait: null, hrvNote: null },
  ...over,
});

describe('cleanActiveKcal', () => {
  it('rounds to whole kcal', () => {
    expect(cleanActiveKcal(412.4)).toBe(412);
    expect(cleanActiveKcal(412.5)).toBe(413);
  });

  it('pins to the ceiling and leaves out 0, negatives and junk', () => {
    expect(cleanActiveKcal(20_001)).toBe(ROGO_MAX_ACTIVE_KCAL);
    expect(cleanActiveKcal(1e9)).toBe(20_000);
    expect(cleanActiveKcal(0)).toBeNull();
    expect(cleanActiveKcal(0.4)).toBeNull();
    expect(cleanActiveKcal(-5)).toBeNull();
    expect(cleanActiveKcal(Number.NaN)).toBeNull();
    expect(cleanActiveKcal(Number.POSITIVE_INFINITY)).toBeNull();
    expect(cleanActiveKcal(null)).toBeNull();
    expect(cleanActiveKcal(undefined)).toBeNull();
  });
});

describe('activeKcalByDate', () => {
  it('sums small calories per local day and splits at midnight', () => {
    const samples = [
      { timestamp: sec(2026, 9, 17, 23, 59), calories: kcal(2) },
      { timestamp: sec(2026, 9, 18, 0, 0), calories: kcal(3) },
      { timestamp: sec(2026, 9, 18, 0, 1), calories: kcal(4) },
      { timestamp: sec(2026, 9, 18, 23, 59), calories: kcal(10) },
      { timestamp: sec(2026, 9, 17, 12, 0), calories: kcal(100) },
    ];
    expect([...activeKcalByDate(samples, TODAY, 3)]).toEqual([
      [key(17), 102],
      [key(18), 17],
    ]);
  });

  it('rounds the sum, not each minute', () => {
    const samples = Array.from({ length: 10 }, (_, i) => ({ timestamp: TODAY + 60 * i, calories: 140 }));
    // 10 x 0.14 kcal = 1.4 kcal
    expect(activeKcalByDate(samples, TODAY, 1).get(key(18))).toBe(1);
    const more = Array.from({ length: 10 }, (_, i) => ({ timestamp: TODAY + 60 * i, calories: 160 }));
    expect(activeKcalByDate(more, TODAY, 1).get(key(18))).toBe(2);
  });

  it('omits a day whose total is 0 or rounds to 0, and a day without samples', () => {
    const samples = [
      { timestamp: TODAY + 60, calories: 0 },
      { timestamp: TODAY + 120, calories: 400 },
      { timestamp: sec(2026, 9, 16, 9), calories: kcal(50) },
    ];
    const out = activeKcalByDate(samples, TODAY, 3);
    expect([...out]).toEqual([[key(16), 50]]);
    expect(activeKcalByDate([], TODAY, 3).size).toBe(0);
  });

  it('pins a day past the ceiling', () => {
    const out = activeKcalByDate([{ timestamp: TODAY + 60, calories: kcal(30_000) }], TODAY, 1);
    expect(out.get(key(18))).toBe(20_000);
  });

  it('ignores samples before the window, after today, and non-finite values', () => {
    const samples = [
      { timestamp: sec(2026, 9, 15, 12), calories: kcal(500) },
      { timestamp: sec(2026, 9, 19, 0, 0), calories: kcal(500) },
      { timestamp: TODAY + 60, calories: Number.NaN },
      { timestamp: Number.NaN, calories: kcal(5) },
      { timestamp: TODAY + 120, calories: -kcal(5) },
    ];
    expect(activeKcalByDate(samples, TODAY, 3).size).toBe(0);
  });
});

describe('rogoScoreDays with the active energy', () => {
  const active = new Map([
    [key(18), 250],
    [key(17), 400],
    [key(16), 380],
    [key(15), 999],
  ]);

  it('adds it to today and to the earlier days of the window, not to days outside it', () => {
    expect(ROGO_SCORE_DAYS).toBe(3);
    expect(rogoScoreDays(noScores(), TODAY, {}, active)).toEqual([
      { date: key(16), activeKcal: 380 },
      { date: key(17), activeKcal: 400 },
      { date: key(18), activeKcal: 250 },
    ]);
  });

  it('joins strain on the same day, and a past day with energy but no strain gets its own entry', () => {
    const strain = [{ day: sec(2026, 9, 17), trimp: 100, strain: 11.26, zoneMinutes: [0, 0, 0, 0, 0], coveredMinutes: 600 }];
    const days = rogoScoreDays(noScores({ strain }), TODAY, {}, active);
    expect(days.find((d) => d.date === key(17))).toEqual({ date: key(17), strain: 11.3, activeKcal: 400 });
    expect(days.find((d) => d.date === key(16))).toEqual({ date: key(16), activeKcal: 380 });
  });

  it('leaves the field out for a day with no total and never sends 0', () => {
    const days = rogoScoreDays(noScores(), TODAY, {}, new Map([[key(18), 0], [key(17), Number.NaN]]));
    expect(days).toEqual([]);
    expect(rogoScoreDays(noScores(), TODAY)).toEqual([]);
  });

  it('keeps today with its metrics when only the energy is missing', () => {
    expect(rogoScoreDays(noScores(), TODAY, { restingHr: 58 }, new Map())).toEqual([{ date: key(18), restingHr: 58 }]);
  });

  it('changes the serialized days when only the active total changes, which is what triggers a new push', () => {
    const a = JSON.stringify(rogoScoreDays(noScores(), TODAY, {}, new Map([[key(18), 250]])));
    const b = JSON.stringify(rogoScoreDays(noScores(), TODAY, {}, new Map([[key(18), 251]])));
    expect(a).not.toBe(b);
  });
});

import { describe, expect, it } from 'bun:test';

import type { HrvReadingRow, WorkoutRow } from '@/db/queries';
import type { FitnessData } from '@/features/fitness/useFitnessData';
import type { Scores } from '@/features/today/scores';
import type { DayStrain } from '@/features/today/strain';
import type { SleepSegment } from '@/wear';
import { cleanMetrics, rogoDailyMetrics, rogoScoreDays, ROGO_MAX_DAYS_PER_CALL } from './rogoScores';

const H = 3600;
const DAY = 86400;
const DAY_START = new Date(2026, 9, 18).getTime() / 1000;
const NOW = DAY_START + 10 * H;
const dayAgo = (n: number) => DAY_START - n * DAY;
const dateOf = (n: number) => {
  const d = new Date(dayAgo(n) * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const strainDay = (n: number, strain: number): DayStrain => ({
  day: dayAgo(n),
  trimp: 100,
  strain,
  zoneMinutes: [0, 0, 0, 0, 0],
  coveredMinutes: 600,
});

const scores = (over: Partial<Scores> = {}): Scores => ({
  maxHr: 190,
  strain: [strainDay(2, 7.04), strainDay(1, 11.26), strainDay(0, 9.96)],
  today: strainDay(0, 9.96),
  readiness: {
    headline: 'Balanced',
    signals: [{ key: 'sleep', amount: 0.874 } as Scores['readiness']['signals'][number]],
    missing: [],
    recovery: { percent: 61 } as NonNullable<Scores['readiness']['recovery']>,
    hrvNote: null,
  },
  ...over,
});

describe('rogoScoreDays', () => {
  it('sends past days with strain only and today with the scores', () => {
    const days = rogoScoreDays(scores(), DAY_START);
    expect(days).toEqual([
      { date: dateOf(2), strain: 7 },
      { date: dateOf(1), strain: 11.3 },
      { date: dateOf(0), strain: 10, recoveryPct: 61, sleepPct: 87, readiness: 'Balanced' },
    ]);
  });

  it('puts the body metrics on today only', () => {
    const days = rogoScoreDays(scores(), DAY_START, { sleepHours: 7.5, restingHr: 58, hrvMs: 52.4, vo2max: 51.8 });
    expect(days.slice(0, 2).every((d) => Object.keys(d).join() === 'date,strain')).toBe(true);
    expect(days[2]).toMatchObject({ date: dateOf(0), sleepHours: 7.5, restingHr: 58, hrvMs: 52.4, vo2max: 51.8, strain: 10 });
  });

  it('omits metrics that are missing instead of sending zeros', () => {
    const [today] = rogoScoreDays(scores({ strain: [], today: null }), DAY_START, { restingHr: 58 }).slice(-1);
    expect(today).toMatchObject({ restingHr: 58 });
    for (const key of ['sleepHours', 'hrvMs', 'hrvStatus', 'vo2max', 'trainingStatus', 'loadRatio', 'recoveryHours']) {
      expect(key in today).toBe(false);
    }
  });

  it('sends a day made of metrics alone', () => {
    const empty = scores({ strain: [], today: null, readiness: { headline: null, signals: [], missing: [], recovery: null, hrvNote: null } });
    expect(rogoScoreDays(empty, DAY_START)).toEqual([]);
    expect(rogoScoreDays(empty, DAY_START, { recoveryHours: 12 })).toEqual([{ date: dateOf(0), recoveryHours: 12 }]);
  });

  it('never sends more than 14 days', () => {
    expect(ROGO_MAX_DAYS_PER_CALL).toBe(14);
    expect(rogoScoreDays(scores(), DAY_START).length).toBeLessThanOrEqual(ROGO_MAX_DAYS_PER_CALL);
  });
});

describe('cleanMetrics', () => {
  it('rounds to what JoyoRogo stores', () => {
    expect(
      cleanMetrics({ sleepHours: 7.46, restingHr: 57.6, hrvMs: 52.449, vo2max: 51.84, loadRatio: 1.2345, recoveryHours: 15.5 }),
    ).toEqual({ sleepHours: 7.5, restingHr: 58, hrvMs: 52.4, vo2max: 51.8, loadRatio: 1.23, recoveryHours: 16 });
  });

  it('drops non-finite and out-of-range readings', () => {
    expect(
      cleanMetrics({ sleepHours: NaN, restingHr: 12, hrvMs: 0.2, vo2max: 95, loadRatio: Infinity, recoveryHours: -3 }),
    ).toEqual({});
    expect(cleanMetrics({ restingHr: 300, hrvMs: 900, vo2max: 5, sleepHours: -1 })).toEqual({});
    expect(cleanMetrics({ restingHr: 24.4, vo2max: 9.94 })).toEqual({});
  });

  it('pins hours and the load ratio to their ends', () => {
    expect(cleanMetrics({ sleepHours: 30, loadRatio: 14, recoveryHours: 500 })).toEqual({ sleepHours: 24, loadRatio: 10, recoveryHours: 240 });
  });

  it('keeps known statuses and drops unknown ones', () => {
    expect(cleanMetrics({ hrvStatus: 'low', trainingStatus: 'overreaching' })).toEqual({ hrvStatus: 'low', trainingStatus: 'overreaching' });
    expect(cleanMetrics({ hrvStatus: 'great' as never, trainingStatus: 'peaking' as never })).toEqual({});
  });
});

const night = (end: number, hours: number): SleepSegment[] => [{ start: end - hours * H, end, type: 6, stage: 'light' }];
const nightHrvRow = (end: number, rmssd: number): HrvReadingRow => ({ start: end - 6 * H, end, source: 'night', rmssd, beats: 1000 });
const workout = (over: Partial<WorkoutRow> = {}): WorkoutRow => ({
  id: 1,
  workoutNumber: 1,
  start: NOW - 5 * H,
  end: NOW - 4 * H,
  sportType: 1,
  sportName: 'Running',
  duration: 3600,
  distance: 8000,
  calories: 500,
  avgHr: 150,
  maxHr: 175,
  steps: 9000,
  complete: true,
  imported: false,
  ...over,
});

const bare: FitnessData = {
  nowSec: NOW,
  dayStart: DAY_START,
  maxHr: 190,
  strain: [],
  resting: new Map(),
  workouts: [],
  hrv: [],
  sleep: [],
  samples: [],
  stress: [],
};

describe('rogoDailyMetrics', () => {
  it('is empty when nothing is known yet', () => {
    expect(rogoDailyMetrics(bare, DAY_START)).toEqual({});
  });

  it('is empty for data read on another day', () => {
    expect(rogoDailyMetrics({ ...bare, resting: new Map([[DAY_START, 58]]) }, DAY_START + DAY)).toEqual({});
  });

  it('carries last night, resting heart rate and the watch recovery time', () => {
    const m = rogoDailyMetrics(
      {
        ...bare,
        sleep: night(DAY_START + 7 * H, 7.5),
        resting: new Map([[DAY_START, 58]]),
        hrv: [nightHrvRow(DAY_START + 7 * H, 52.449)],
        workouts: [{ workout: workout(), summary: { vo2max: 52.34, recoveryHours: 20 } }],
      },
      DAY_START,
    );
    expect(m).toEqual({ sleepHours: 7.5, restingHr: 58, hrvMs: 52.4, vo2max: 52.3, recoveryHours: 16 });
  });

  it('leaves out the night of yesterday and spot HRV readings', () => {
    const m = rogoDailyMetrics(
      {
        ...bare,
        sleep: night(DAY_START - 17 * H, 8),
        hrv: [nightHrvRow(DAY_START - 17 * H, 60), { start: NOW - H, end: NOW - H + 60, source: 'spot', rmssd: 45, beats: 80 }],
      },
      DAY_START,
    );
    expect(m).toEqual({});
  });

  it('has the HRV status and the training status once there is history for them', () => {
    const hrv = [...Array.from({ length: 30 }, (_, i) => nightHrvRow(DAY_START + 7 * H - (i + 1) * DAY, 50)), nightHrvRow(DAY_START + 7 * H, 51)];
    const strain = Array.from({ length: 28 }, (_, i) => strainDay(i + 1, 8)).reverse();
    const m = rogoDailyMetrics({ ...bare, hrv, strain }, DAY_START);
    expect(m).toMatchObject({ hrvStatus: 'balanced', hrvMs: 51, trainingStatus: 'maintaining', loadRatio: 1 });
  });

  it('has no training status for a short history', () => {
    const m = rogoDailyMetrics({ ...bare, strain: [strainDay(1, 8), strainDay(2, 8)] }, DAY_START);
    expect('trainingStatus' in m || 'loadRatio' in m).toBe(false);
  });
});

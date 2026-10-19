import { afterEach, describe, expect, it } from 'bun:test';

import type { WorkoutRow } from '@/db/queries';
import type { StrengthExercise, StrengthSet, StrengthWorkout } from '@/features/strength/types';
import { applyLocale } from '@/i18n';
import type { StickerSubject } from '@/features/stickers/subject';

import { buildWeekSubject, type WeekSubjectInput } from './week';

afterEach(() => applyLocale('id'));

// Monday 2026-10-12 00:00 local.
const MONDAY = new Date(2026, 9, 12);
const weekStartSec = Math.floor(MONDAY.getTime() / 1000);
const at = (day: number, hour = 7): number => Math.floor(new Date(2026, 9, 12 + day, hour).getTime() / 1000);

const row = (day: number, over: Partial<WorkoutRow> = {}): WorkoutRow => {
  const start = at(day);
  return {
    id: start,
    workoutNumber: 1,
    start,
    end: start + 1800,
    sportType: 1,
    sportName: 'Running',
    duration: 1800,
    distance: 5000,
    calories: 300,
    avgHr: 150,
    maxHr: 170,
    steps: 5000,
    complete: true,
    imported: false,
    ...over,
  };
};

const set = (id: string, weightKg: number, reps: number): StrengthSet => ({ id, type: 'normal', weightKg, reps, seconds: null, rpe: null, done: true, doneAt: 1 });
const exercise = (sets: StrengthSet[]): StrengthExercise => ({ key: 'a', exerciseId: 'squat', note: '', restSec: null, supersetGroup: null, sets });
const lift = (day: number, over: Partial<StrengthWorkout> = {}): StrengthWorkout => ({
  id: `w${day}`,
  name: 'Legs',
  startedAt: at(day, 18) * 1000,
  endedAt: (at(day, 18) + 3000) * 1000,
  durationSec: 3000,
  note: '',
  routineId: null,
  planKey: null,
  exercises: [exercise([set('s1', 100, 5), set('s2', 100, 5)])],
  workoutStart: null,
  kcal: 200,
  kcalSource: 'estimate',
  updatedAt: 0,
  deletedAt: null,
  ...over,
});

const base = (over: Partial<WeekSubjectInput> = {}): WeekSubjectInput => ({
  weekStartSec,
  workouts: [],
  strength: [],
  dayStrain: [null, null, null, null, null, null, null],
  ...over,
});

const week = (s: StickerSubject | null) => s!.data.week as Record<string, unknown>;
const load = (s: StickerSubject | null) => s!.data.load as Record<string, unknown>;

describe('buildWeekSubject', () => {
  it('sums watch and strength sessions', () => {
    const s = buildWeekSubject(
      base({
        workouts: [row(0), row(0, { start: at(0, 18), end: at(0, 18) + 1800, distance: 12400, calories: 700, duration: 3600 }), row(2, { distance: 0, calories: 0 })],
        strength: [lift(3)],
        dayStrain: [10, null, 4, 12.34, null, null, null],
        steps: [1000, 2000, 3000, 0, 0, 0, 0],
        nowMs: new Date(2026, 9, 14, 12).getTime(),
      }),
      'id',
    )!;
    expect(s.id).toBe(`week:${weekStartSec}`);
    expect(s.kinds).toEqual(['week', 'load']);
    expect(s.date).toBe(MONDAY.getTime());
    const w = week(s);
    expect(w.workouts).toBe(4);
    expect(w.distanceM).toBe(17400);
    expect(w.kcal).toBe(300 + 700 + 200);
    // The watch timer (3600 s) counts, not the 1800 s between its start and end stamps.
    expect(w.movingSec).toBe(1800 + 3600 + 1800 + 3000);
    expect(w.activeDays).toBe(3);
    expect(w.dayMin).toEqual([90, 0, 30, 50, 0, 0, 0]);
    expect(w.longestM).toBe(12400);
    expect(w.bestLabel).toBe('Terpanjang: 12,40 km');
    expect(w.strengthSessions).toBe(1);
    expect(w.volumeKg).toBe(1000);
    expect(w.steps).toBe(6000);
    expect(w.rangeStart).toBe(MONDAY.getTime());
    expect(new Date(w.rangeEnd as number).getDate()).toBe(18);
    expect(w.dayLabels).toEqual(['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']);
    expect(w.dayStrain).toEqual([10, 0, 4, 12.3, 0, 0, 0]);
    expect(w.todayIndex).toBe(2);
    expect(load(s).sessions).toBe(4);
    expect(load(s).totalStrain).toBe(26.3);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('counts a strength workout merged with a watch row once', () => {
    const watch = row(1, { sportName: 'Strength', distance: 0, calories: 250 });
    const s = buildWeekSubject(base({ workouts: [watch], strength: [lift(1, { workoutStart: watch.start })] }), 'id')!;
    const w = week(s);
    expect(w.workouts).toBe(1);
    expect(w.kcal).toBe(250);
    expect(w.strengthSessions).toBe(1);
    expect(w.distanceM).toBeUndefined();
    expect(s.kinds).toEqual(['week']);
  });

  it('week with only strength: no distance, no longest label', () => {
    const s = buildWeekSubject(base({ strength: [lift(0), lift(4)] }), 'id')!;
    const w = week(s);
    expect(w.workouts).toBe(2);
    expect(w.activeDays).toBe(2);
    expect(w.distanceM).toBeUndefined();
    expect(w.longestM).toBeUndefined();
    expect(w.bestLabel).toBeUndefined();
    expect(w.movingSec).toBe(6000);
    expect(w.kcal).toBe(400);
    expect(w.volumeKg).toBe(2000);
    expect(w.dayStrain).toBeUndefined();
    expect(w.steps).toBeUndefined();
    expect(w.todayIndex).toBeUndefined();
  });

  it('deleted strength workouts are ignored', () => {
    expect(buildWeekSubject(base({ strength: [lift(0, { deletedAt: 5 })] }), 'id')).toBeNull();
  });

  it('empty week returns null', () => {
    expect(buildWeekSubject(base(), 'id')).toBeNull();
    expect(buildWeekSubject(base({ dayStrain: [], steps: [] }), 'id')).toBeNull();
    expect(buildWeekSubject(base({ weekStartSec: Number.NaN }), 'id')).toBeNull();
  });

  it('sessions outside the week are dropped', () => {
    expect(buildWeekSubject(base({ workouts: [row(-1), row(7)] }), 'id')).toBeNull();
  });

  it('strain all missing: no load kind and no strain paths', () => {
    const s = buildWeekSubject(base({ workouts: [row(0)], dayStrain: [null, Number.NaN, undefined, Infinity, null, null, null], acute: 10, chronicWeekly: 10 }), 'id')!;
    expect(s.kinds).toEqual(['week']);
    expect(s.data.load).toBeUndefined();
    expect(week(s).dayStrain).toBeUndefined();
  });

  it('strain without sessions offers only load', () => {
    const s = buildWeekSubject(base({ dayStrain: [0, 5, null, null, null, null, null] }), 'id')!;
    expect(s.kinds).toEqual(['load']);
    expect(s.data.week).toBeUndefined();
    expect(s.heading).toBe('Bagikan beban latihan');
    expect(load(s).sessions).toBe(0);
  });

  it('clamps strain to 0..21', () => {
    const s = buildWeekSubject(base({ dayStrain: [30, -4, null, null, null, null, null] }), 'id')!;
    expect(load(s).dayStrain).toEqual([21, 0, 0, 0, 0, 0, 0]);
  });

  describe('acute/chronic status', () => {
    const status = (acute: number, chronicWeekly = 100, locale: 'id' | 'en' = 'id') =>
      load(buildWeekSubject(base({ dayStrain: [1, 1, 1, 1, 1, 1, 1], acute, chronicWeekly }), locale));

    it('boundaries', () => {
      expect(status(79).status).toBe('Turun');
      expect(status(80).status).toBe('Seimbang');
      expect(status(130).status).toBe('Seimbang');
      expect(status(131).status).toBe('Naik cepat');
      expect(status(79).ratio).toBe(0.79);
      expect(status(131).ratio).toBe(1.31);
    });

    it('no chronic: no ratio and no status', () => {
      const l = load(buildWeekSubject(base({ dayStrain: [1, 1, 1, 1, 1, 1, 1], acute: 50 }), 'id'));
      expect(l.acute).toBe(50);
      expect(l.ratio).toBeUndefined();
      expect(l.status).toBeUndefined();
      expect(l.chronicWeekly).toBeUndefined();
      expect(status(50, 0).ratio).toBeUndefined();
      expect(status(Number.NaN).acute).toBeUndefined();
    });

    it('english', async () => {
      await applyLocale('en');
      expect(status(131, 100, 'en').status).toBe('Ramping up');
      expect(status(100, 100, 'en').status).toBe('Balanced');
      expect(status(10, 100, 'en').status).toBe('Easing off');
    });
  });

  it('todayIndex: current week only', () => {
    const w = (nowMs: number) => week(buildWeekSubject(base({ workouts: [row(0)], nowMs }), 'id'));
    expect(w(new Date(2026, 9, 12, 0, 0).getTime()).todayIndex).toBe(0);
    expect(w(new Date(2026, 9, 18, 23, 59).getTime()).todayIndex).toBe(6);
    expect(w(new Date(2026, 9, 19, 0, 0).getTime()).todayIndex).toBeUndefined();
    expect(w(new Date(2026, 9, 11, 23, 59).getTime()).todayIndex).toBeUndefined();
    expect(w(Number.NaN).todayIndex).toBeUndefined();
  });

  it('tolerates NaN and Infinity in workouts', () => {
    const s = buildWeekSubject(base({ workouts: [row(0, { distance: Number.NaN, calories: Infinity, duration: Number.NaN })] }), 'id')!;
    const w = week(s);
    expect(w.workouts).toBe(1);
    expect(w.distanceM).toBeUndefined();
    expect(w.kcal).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain('null');
  });

  it('english labels and heading, Monday first', async () => {
    await applyLocale('en');
    const s = buildWeekSubject(base({ workouts: [row(0)] }), 'en')!;
    expect(week(s).dayLabels).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(week(s).bestLabel).toBe('Longest: 5.00 km');
    expect(s.heading).toBe('Share your week');
    expect(s.caption).toContain('Tracked with JoyoFit');
  });
});

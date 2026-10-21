import { describe, expect, it } from 'bun:test';

import {
  bestsByExercise,
  epley1rm,
  estimateKcal,
  exerciseHistory,
  exercisesUsed,
  findPersonalRecords,
  muscleSets,
  setVolume,
  strengthMet,
  weeklyMuscleLoad,
  weekKey,
  workoutTotals,
} from './calc';
import type { StrengthExercise, StrengthSet, StrengthWorkout } from './types';

let n = 0;
const set = (weightKg: number | null, reps: number | null, over: Partial<StrengthSet> = {}): StrengthSet => ({
  id: `s${n++}`,
  type: 'normal',
  weightKg,
  reps,
  seconds: null,
  rpe: null,
  done: true,
  doneAt: 1,
  ...over,
});
const exercise = (exerciseId: string, sets: StrengthSet[]): StrengthExercise => ({ key: `k${n++}`, exerciseId, note: '', restSec: null, supersetGroup: null, sets });
const workout = (startedAt: number, exercises: StrengthExercise[], over: Partial<StrengthWorkout> = {}): StrengthWorkout => ({
  id: `w${n++}`,
  name: 'x',
  startedAt,
  endedAt: startedAt + 3600_000,
  durationSec: 3600,
  note: '',
  routineId: null,
  planKey: null,
  exercises,
  workoutStart: null,
  kcal: null,
  kcalSource: null,
  updatedAt: startedAt,
  deletedAt: null,
  ...over,
});

describe('epley1rm', () => {
  it('is the weight for one rep and w(1 + r/30) otherwise', () => {
    expect(epley1rm(100, 1)).toBe(100);
    expect(epley1rm(100, 5)).toBeCloseTo(116.667, 3);
    expect(epley1rm(60, 10)).toBeCloseTo(80, 5);
  });
  it('is null for sets it does not describe', () => {
    expect(epley1rm(null, 5)).toBeNull();
    expect(epley1rm(100, null)).toBeNull();
    expect(epley1rm(0, 5)).toBeNull();
    expect(epley1rm(100, 0)).toBeNull();
    expect(epley1rm(100, 31)).toBeNull();
  });
});

describe('workoutTotals', () => {
  it('counts done sets, keeps warm-ups out of volume and sets', () => {
    const w = workout(0, [
      exercise('bench', [set(40, 10, { type: 'warmup' }), set(60, 8), set(60, 8), set(60, 6, { done: false })]),
      exercise('plank', [set(null, null, { seconds: 60 })]),
    ]);
    expect(workoutTotals(w)).toEqual({ volume: 960, sets: 3, warmupSets: 1, reps: 16, seconds: 60, exercises: 2 });
  });
  it('does not count an exercise with nothing done', () => {
    expect(workoutTotals(workout(0, [exercise('a', [set(10, 10, { done: false })])])).exercises).toBe(0);
  });
  it('gives a bodyweight set no volume', () => {
    expect(setVolume(set(null, 12))).toBe(0);
  });
});

describe('personal records', () => {
  const before = bestsByExercise([workout(0, [exercise('squat', [set(100, 5), set(80, 8)])])]);

  it('finds a heavier weight and a better 1RM (not a rep record: nobody lifted that load before)', () => {
    const records = findPersonalRecords(workout(1, [exercise('squat', [set(110, 5)])]), before);
    expect(records.map((r) => r.kind).sort()).toEqual(['e1rm', 'weight']);
    expect(records.find((r) => r.kind === 'weight')).toMatchObject({ value: 110, previous: 100 });
  });

  it('finds a rep record: more reps at the same or a heavier load', () => {
    const records = findPersonalRecords(workout(1, [exercise('squat', [set(80, 10)])]), before);
    expect(records.find((r) => r.kind === 'reps')).toMatchObject({ value: 10, previous: 8 });
    expect(records.find((r) => r.kind === 'weight')).toBeUndefined();
  });

  it('is not fooled by fewer reps at a lighter load', () => {
    expect(findPersonalRecords(workout(1, [exercise('squat', [set(60, 5)])]), before)).toEqual([]);
  });

  it('gives a first workout of an exercise no records', () => {
    expect(findPersonalRecords(workout(1, [exercise('deadlift', [set(150, 3)])]), before)).toEqual([]);
  });

  it('ignores warm-up and undone sets', () => {
    const w = workout(1, [exercise('squat', [set(200, 5, { type: 'warmup' }), set(200, 5, { done: false })])]);
    expect(findPersonalRecords(w, before)).toEqual([]);
  });

  it('keeps one record per kind, the best set', () => {
    const records = findPersonalRecords(workout(1, [exercise('squat', [set(105, 5), set(110, 5)])]), before);
    expect(records.filter((r) => r.kind === 'weight')).toHaveLength(1);
    expect(records.find((r) => r.kind === 'weight')?.value).toBe(110);
  });

  it('finds a time record for timed sets', () => {
    const plank = bestsByExercise([workout(0, [exercise('plank', [set(null, null, { seconds: 60 })])])]);
    const records = findPersonalRecords(workout(1, [exercise('plank', [set(null, null, { seconds: 75 })])]), plank);
    expect(records).toEqual([{ exerciseId: 'plank', kind: 'time', setId: expect.any(String), value: 75, previous: 60 }]);
  });

  it('skips deleted workouts when building the bests', () => {
    const bests = bestsByExercise([workout(0, [exercise('squat', [set(300, 1)])], { deletedAt: 5 })]);
    expect(bests.has('squat')).toBe(false);
  });
});

describe('exerciseHistory', () => {
  it('has one point per workout, oldest first, with best set, 1RM and volume', () => {
    const ws = [
      workout(2000, [exercise('bench', [set(60, 10), set(70, 5)])]),
      workout(1000, [exercise('bench', [set(50, 10)]), exercise('row', [set(40, 10)])]),
      workout(3000, [exercise('row', [set(40, 10)])]),
    ];
    const points = exerciseHistory(ws, 'bench');
    expect(points.map((p) => p.at)).toEqual([1000, 2000]);
    expect(points[1]).toMatchObject({ maxWeightKg: 70, volume: 950, reps: 15, sets: 2 });
    expect(points[1]!.e1rm).toBeCloseTo(70 * (1 + 5 / 30), 5);
    expect(points[1]!.best).toEqual({ weightKg: 60, reps: 10, seconds: null });
  });

  it('lists the exercises used by how often', () => {
    const ws = [workout(1, [exercise('a', [set(1, 1)]), exercise('b', [set(1, 1)])]), workout(2, [exercise('b', [set(1, 1)])])];
    expect(exercisesUsed(ws).map((e) => e.exerciseId)).toEqual(['b', 'a']);
  });
});

describe('muscle load', () => {
  const resolve = (id: string) =>
    id === 'bench' ? { primary: ['chest'] as const, secondary: ['triceps', 'shoulders'] as const } : id === 'row' ? { primary: ['lats', 'middle_back'] as const, secondary: ['biceps'] as const } : null;

  it('gives a primary group a full set and a secondary group half, once per set', () => {
    const load = muscleSets(workout(0, [exercise('row', [set(40, 10), set(40, 10)]), exercise('gone', [set(1, 1)])]), resolve);
    expect(load.get('back')).toBe(2);
    expect(load.get('biceps')).toBe(1);
    expect(load.has('chest')).toBe(false);
  });

  it('skips warm-ups', () => {
    const load = muscleSets(workout(0, [exercise('bench', [set(40, 10, { type: 'warmup' }), set(60, 8)])]), resolve);
    expect(load.get('chest')).toBe(1);
  });

  it('sums the last weeks, oldest first', () => {
    const now = new Date(2026, 9, 14, 12).getTime(); // a Wednesday
    const mondayOfNow = weekKey(now);
    const lastWeek = new Date(2026, 9, 8, 12).getTime();
    const weeks = weeklyMuscleLoad([workout(now, [exercise('bench', [set(60, 8)])]), workout(lastWeek, [exercise('bench', [set(60, 8), set(60, 8)])])], resolve, now, 3);
    expect(weeks).toHaveLength(3);
    expect(weeks[2]!.week).toBe(mondayOfNow);
    expect(weeks[2]!.sets.get('chest')).toBe(1);
    expect(weeks[1]!.sets.get('chest')).toBe(2);
    expect(weeks[0]!.sets.size).toBe(0);
  });
});

describe('energy', () => {
  it('is light for a slow session and vigorous for a circuit', () => {
    expect(strengthMet({ countedSets: 6, durationSec: 3600, avgRpe: null })).toBe(3.5);
    expect(strengthMet({ countedSets: 40, durationSec: 3600, avgRpe: null })).toBe(6);
    expect(strengthMet({ countedSets: 21, durationSec: 3600, avgRpe: null })).toBeCloseTo(3.5 + 2.5 * 0.5, 5);
  });
  it('adds half a MET for a hard average RPE, at most 6.5', () => {
    expect(strengthMet({ countedSets: 6, durationSec: 3600, avgRpe: 9 })).toBe(4);
    expect(strengthMet({ countedSets: 40, durationSec: 3600, avgRpe: 9 })).toBe(6.5);
  });
  it('turns MET, weight and minutes into kcal (MET x 3.5 x kg x min / 200)', () => {
    // 20 sets in an hour: 8 above 12 of 18 -> MET 4.611; 4.611 x 3.5 x 70 x 60 / 200 = 338.9
    const sets = Array.from({ length: 20 }, () => set(50, 10));
    expect(estimateKcal({ exercises: [exercise('a', sets)], durationSec: 3600 }, 70)).toBe(339);
  });
});

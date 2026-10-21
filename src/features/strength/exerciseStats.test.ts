import { describe, expect, it } from 'bun:test';

import { availableMetrics, exerciseRecords, exerciseSeries, exerciseSessions, repRecords } from './exerciseStats';
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

const w1 = workout(1000, [exercise('bench', [set(60, 8), set(60, 8), set(50, 10, { type: 'warmup' })])], { id: 'w1' });
const w2 = workout(2000, [exercise('bench', [set(70, 5), set(60, 10)]), exercise('row', [set(40, 12)])], { id: 'w2' });
const w3 = workout(3000, [exercise('bench', [set(70, 5, { done: false })])], { id: 'w3' });
const all = [w3, w1, w2];

describe('repRecords', () => {
  it('keeps the most reps at each weight, heaviest first, warm-ups and undone sets excluded', () => {
    expect(repRecords(all, 'bench')).toEqual([
      { weightKg: 70, reps: 5, at: 2000, workoutId: 'w2' },
      { weightKg: 60, reps: 10, at: 2000, workoutId: 'w2' },
    ]);
  });

  it('keeps the earlier set on a tie and groups bodyweight sets at 0', () => {
    const a = workout(10, [exercise('pushup', [set(null, 20)])], { id: 'a' });
    const b = workout(20, [exercise('pushup', [set(null, 20), set(0, 15)])], { id: 'b' });
    expect(repRecords([b, a], 'pushup')).toEqual([{ weightKg: 0, reps: 20, at: 10, workoutId: 'a' }]);
  });

  it('is empty for an exercise never done', () => {
    expect(repRecords(all, 'squat')).toEqual([]);
  });
});

describe('exerciseRecords', () => {
  it('finds the heaviest weight, best 1RM, best set volume', () => {
    const card = exerciseRecords(all, 'bench');
    expect(card.weight).toMatchObject({ value: 70, workoutId: 'w2', reps: 5 });
    // 70x5: 81.67, 60x10: 80, 60x8: 76: the heavier set wins the 1RM and 60x10 the volume.
    expect(card.e1rm!.value).toBeCloseTo(70 * (1 + 5 / 30), 5);
    expect(card.volume).toMatchObject({ value: 600, workoutId: 'w2' });
    expect(card.time).toBeNull();
  });

  it('finds the longest timed set', () => {
    const w = workout(5, [exercise('plank', [set(null, null, { seconds: 45 }), set(null, null, { seconds: 60 })])], { id: 'p' });
    expect(exerciseRecords([w], 'plank').time).toMatchObject({ value: 60, workoutId: 'p' });
    expect(exerciseRecords([w], 'plank').weight).toBeNull();
  });
});

describe('exerciseSeries', () => {
  it('has one point per workout, oldest first, skipping workouts without a value', () => {
    const series = exerciseSeries(all, 'bench', 'bestSet');
    expect(series.map((p) => [p.workoutId, p.value])).toEqual([['w1', 60], ['w2', 60]]);
    expect(exerciseSeries(all, 'bench', 'volume').map((p) => p.value)).toEqual([960, 950]);
    expect(exerciseSeries(all, 'bench', 'reps').map((p) => p.value)).toEqual([16, 15]);
  });

  it('sums timed sets per workout', () => {
    const w = workout(5, [exercise('plank', [set(null, null, { seconds: 45 }), set(null, null, { seconds: 60 })])], { id: 'p' });
    expect(exerciseSeries([w], 'plank', 'totalTime')[0]!.value).toBe(105);
    expect(exerciseSeries([w], 'plank', 'time')[0]!.value).toBe(60);
  });

  it('offers only the charts with data', () => {
    expect(availableMetrics(all, 'bench')).toEqual(['bestSet', 'e1rm', 'volume', 'reps']);
    const push = workout(5, [exercise('pushup', [set(null, 12)])]);
    expect(availableMetrics([push], 'pushup')).toEqual(['reps']);
    expect(availableMetrics([], 'bench')).toEqual([]);
  });

  it('offers both reps and hold charts and records for an exercise measured both ways', () => {
    const byReps = workout(5, [exercise('plank', [set(null, 12)])], { id: 'r' });
    const byTime = workout(10, [exercise('plank', [set(null, null, { seconds: 60 })])], { id: 't' });
    expect(availableMetrics([byReps, byTime], 'plank')).toEqual(['reps', 'time', 'totalTime']);
    expect(exerciseSeries([byReps, byTime], 'plank', 'reps').map((p) => p.workoutId)).toEqual(['r']);
    expect(exerciseSeries([byReps, byTime], 'plank', 'time').map((p) => p.workoutId)).toEqual(['t']);
    expect(exerciseRecords([byReps, byTime], 'plank').time).toMatchObject({ value: 60, workoutId: 't' });
  });
});

describe('exerciseSessions', () => {
  it('lists counted sets per session, newest first, with the best set', () => {
    const sessions = exerciseSessions(all, 'bench');
    expect(sessions.map((s) => s.workoutId)).toEqual(['w2', 'w1']);
    expect(sessions[1]!.sets.length).toBe(2);
    expect(sessions[0]!.best).toEqual({ weightKg: 60, reps: 10, seconds: null });
  });
});

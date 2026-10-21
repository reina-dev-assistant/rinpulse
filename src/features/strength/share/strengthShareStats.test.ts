import { afterEach, describe, expect, it } from 'bun:test';

import { applyLocale } from '@/i18n';

import type { PersonalRecord } from '../calc';
import { buildCatalog } from '../catalog';
import type { StrengthExercise, StrengthSet, StrengthWorkout } from '../types';
import { setLoad, strengthDescription, strengthShareStats, topSets } from './strengthShareStats';

afterEach(() => applyLocale('id'));

const catalog = buildCatalog([]);

const set = (id: string, over: Partial<StrengthSet>): StrengthSet => ({ id, type: 'normal', weightKg: null, reps: null, seconds: null, rpe: null, done: true, doneAt: 1, ...over });
const exercise = (exerciseId: string, sets: StrengthSet[]): StrengthExercise => ({ key: exerciseId, exerciseId, note: '', restSec: null, supersetGroup: null, sets });
const workout = (exercises: StrengthExercise[], over: Partial<StrengthWorkout> = {}): StrengthWorkout => ({
  id: 'w1',
  name: 'Push day',
  startedAt: new Date(2026, 9, 12, 7, 30).getTime(),
  endedAt: new Date(2026, 9, 12, 8, 30).getTime(),
  durationSec: 3600,
  note: '',
  routineId: null,
  planKey: null,
  exercises,
  workoutStart: 1,
  kcal: 250,
  kcalSource: 'estimate',
  updatedAt: 0,
  deletedAt: null,
  ...over,
});

const bench = exercise('barbell_bench_press', [
  set('w', { type: 'warmup', weightKg: 100, reps: 10 }),
  set('a', { weightKg: 60, reps: 8 }),
  set('b', { weightKg: 70, reps: 5 }),
]);
const squat = exercise('barbell_back_squat', [set('c', { weightKg: 100, reps: 5 })]);
const curl = exercise('barbell_curl', [set('d', { weightKg: 20, reps: 10 }), set('e', { weightKg: 25, reps: 6, done: false })]);
const pushUps = exercise('push_up', [set('f', { reps: 20 })]);
const plank = exercise('plank', [set('g', { seconds: 45 })]);

describe('topSets', () => {
  it('picks the best counted set of each exercise by estimated 1RM, never a warm-up or undone set', () => {
    const rows = topSets(workout([bench, squat, curl]), catalog, 'en');
    expect(rows.map((r) => r.exercise)).toEqual(['Barbell back squat', 'Barbell bench press', 'Barbell curl']);
    expect(rows[0]!.load).toBe('100 kg x 5');
    // 70 x 5 (1RM 81.7) beats 60 x 8 (76.0).
    expect(rows[1]!.load).toBe('70 kg x 5');
    expect(rows[2]!.load).toBe('20 kg x 10');
  });

  it('keeps three at most and is empty for a workout with nothing done', () => {
    expect(topSets(workout([bench, squat, curl, pushUps]), catalog, 'en')).toHaveLength(3);
    expect(topSets(workout([exercise('barbell_curl', [set('x', { weightKg: 20, reps: 10, done: false })])]), catalog, 'en')).toEqual([]);
    expect(topSets(workout([]), catalog, 'en')).toEqual([]);
  });

  it('ranks loaded sets over bodyweight reps over timed sets', () => {
    const rows = topSets(workout([plank, pushUps, curl]), catalog, 'en');
    expect(rows.map((r) => r.load)).toEqual(['20 kg x 10', '20 reps', '45 s']);
  });

  it('names an exercise nothing knows', () => {
    expect(topSets(workout([exercise('gone', [set('x', { reps: 5 })])]), catalog, 'en')[0]!.exercise).toBe('Exercise');
  });
});

describe('setLoad', () => {
  it('writes weights, reps and seconds in the locale', () => {
    expect(setLoad({ weightKg: 62.5, reps: 8, seconds: null }, 'en')).toBe('62.5 kg x 8');
    expect(setLoad({ weightKg: 62.5, reps: 8, seconds: null }, 'id')).toBe('62,5 kg x 8');
    expect(setLoad({ weightKg: 40, reps: null, seconds: 30 }, 'en')).toBe('40 kg x 30 s');
    expect(setLoad({ weightKg: null, reps: 1, seconds: null }, 'en')).toBe('1 rep');
    expect(setLoad({ weightKg: null, reps: 12, seconds: null }, 'id')).toBe('12 repetisi');
    expect(setLoad({ weightKg: null, reps: null, seconds: 45 }, 'id')).toBe('45 dtk');
    expect(setLoad({ weightKg: 0, reps: null, seconds: null }, 'en')).toBe('');
  });
});

describe('strengthShareStats', () => {
  const records: PersonalRecord[] = [{ exerciseId: 'barbell_bench_press', kind: 'weight', setId: 'b', value: 70, previous: 65 }];

  it('leads with volume and lists duration, sets, reps and energy', () => {
    const s = strengthShareStats(workout([bench, squat]), catalog, 'en', records);
    expect(s.name).toBe('Push day');
    expect(s.stats.map((x) => [x.key, x.value, x.unit])).toEqual([
      ['volume', '1,330', 'kg'],
      ['time', '1 h 00 min', undefined],
      ['sets', '3', undefined],
      ['reps', '18', undefined],
      ['kcal', '250', 'kcal'],
    ]);
    expect(s.prCount).toBe(1);
    expect(s.prLabel).toBe('1 new PR');
    expect(s.subtitle).toContain('2026');
  });

  it('shows total reps instead of volume for a bodyweight-only workout', () => {
    const s = strengthShareStats(workout([pushUps, plank]), catalog, 'en', []);
    expect(s.stats[0]).toMatchObject({ key: 'reps', value: '20' });
    expect(s.stats.find((x) => x.key === 'hold')).toMatchObject({ value: '0:45' });
    expect(s.stats.some((x) => x.key === 'volume')).toBe(false);
    expect(s.prLabel).toBeNull();
    expect(s.topSets.map((r) => r.load)).toEqual(['20 reps', '45 s']);
  });

  it('falls back to time when only timed sets were done, and omits energy when unknown', () => {
    const s = strengthShareStats(workout([plank], { kcal: null, kcalSource: null }), catalog, 'id', []);
    expect(s.stats.map((x) => x.key)).toEqual(['hold', 'time', 'sets']);
    expect(s.stats[0]).toMatchObject({ key: 'hold', value: '0:45' });
    expect(s.topSets[0]!.load).toBe('45 dtk');
  });

  it('copes with an empty workout and a missing name', () => {
    const s = strengthShareStats(workout([], { name: ' ', durationSec: 0, kcal: null }), catalog, 'en', []);
    expect(s.name).toBe('Strength workout');
    expect(s.stats).toEqual([]);
    expect(s.topSets).toEqual([]);
  });
});

describe('strengthDescription', () => {
  it('summarises totals, top sets and records', () => {
    const text = strengthDescription(workout([bench, squat]), catalog, 'en', [{ exerciseId: 'x', kind: 'weight', setId: 'a', value: 1, previous: 0 }]);
    const [totals, top, pr] = text.split('\n');
    expect(totals).toBe('Total volume 1,330 kg, 3 sets, 18 reps.');
    expect(top).toStartWith('Top sets: ');
    expect(top).toContain('100 kg x 5');
    expect(pr).toBe('1 new PR');
  });

  it('describes a bodyweight workout by reps and is empty with no sets', () => {
    expect(strengthDescription(workout([pushUps]), catalog, 'id')).toStartWith('1 set, 20 repetisi.');
    expect(strengthDescription(workout([]), catalog, 'en')).toBe('');
  });

  it('describes a timed-only workout by the time held, not by 0 reps', () => {
    const two = exercise('plank', [set('g', { seconds: 45 }), set('h', { seconds: 75 })]);
    expect(strengthDescription(workout([two]), catalog, 'en').split('\n')[0]).toBe('2 sets, 2:00 held.');
    expect(strengthDescription(workout([two]), catalog, 'id').split('\n')[0]).toBe('2 set, tahan 2:00.');
    expect(strengthDescription(workout([pushUps, plank]), catalog, 'en')).toContain('Total hold time 0:45.');
  });
});

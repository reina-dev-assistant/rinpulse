import { describe, expect, it } from 'bun:test';

import type { MuscleResolver } from './calc';
import { contrast, heatFill, heatLevel, mixHex, readableOn, weekContributors } from './heat';
import type { StrengthExercise, StrengthSet, StrengthWorkout } from './types';

describe('heatLevel', () => {
  it('uses the documented thresholds', () => {
    expect([0, 0.5, 1, 4, 4.5, 5, 9, 9.5, 10, 14, 14.5, 15, 40].map(heatLevel)).toEqual([0, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4]);
    expect(heatLevel(-1)).toBe(0);
    expect(heatLevel(NaN)).toBe(0);
  });
});

describe('colours', () => {
  it('mixes hex colours and leaves others alone', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#102030', '#ffffff', 0)).toBe('#102030');
    expect(mixHex('rgba(0,0,0,0.1)', '#ffffff', 0.5)).toBe('rgba(0,0,0,0.1)');
  });

  it('fills level 0 with the empty colour and level 4 with the accent', () => {
    expect(heatFill(0, '#f0ece5', '#0a6580')).toBe('#f0ece5');
    expect(heatFill(4, '#f0ece5', '#0a6580')).toBe('#0a6580');
  });

  it('picks the readable text colour on every level of the light and dark classic themes', () => {
    const themes = [
      { empty: '#F0ECE5', accent: '#0A6580', fg: '#1D1A15', bg: '#FFFFFF' },
      { empty: '#242C2F', accent: '#58C4DE', fg: '#EEF1F0', bg: '#171D1F' },
    ];
    for (const { empty, accent, fg, bg } of themes) {
      for (const level of [0, 1, 2, 3, 4] as const) {
        const fill = heatFill(level, empty, accent);
        const text = readableOn(fill, [fg, bg]);
        expect(contrast(fill, text)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

let n = 0;
const set = (over: Partial<StrengthSet> = {}): StrengthSet => ({ id: `s${n++}`, type: 'normal', weightKg: 50, reps: 8, seconds: null, rpe: null, done: true, doneAt: 1, ...over });
const exercise = (exerciseId: string, sets: StrengthSet[]): StrengthExercise => ({ key: `k${n++}`, exerciseId, note: '', restSec: null, supersetGroup: null, sets });
const workout = (startedAt: number, exercises: StrengthExercise[], over: Partial<StrengthWorkout> = {}): StrengthWorkout => ({
  id: `w${n++}`,
  name: 'x',
  startedAt,
  endedAt: startedAt + 1,
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

const resolve: MuscleResolver = (id) =>
  id === 'bench' ? { primary: ['chest'], secondary: ['triceps'] } : id === 'pushdown' ? { primary: ['triceps'], secondary: [] } : null;

describe('weekContributors', () => {
  const monday = new Date(2026, 9, 12, 12).getTime();
  const w = workout(monday, [exercise('bench', [set(), set(), set(), set({ type: 'warmup' })]), exercise('pushdown', [set()]), exercise('mystery', [set()])]);
  const next = workout(monday + 8 * 86_400_000, [exercise('pushdown', [set()])]);
  const gone = workout(monday, [exercise('pushdown', [set()])], { deletedAt: 1 });

  it('lists the exercises behind a muscle group in a week, secondary sets counting half', () => {
    const list = weekContributors([w, next, gone], resolve, 'triceps', '2026-10-12');
    expect(list).toEqual([
      { exerciseId: 'bench', sets: 1.5, counted: 3, secondary: true },
      { exerciseId: 'pushdown', sets: 1, counted: 1, secondary: false },
    ]);
  });

  it('lists primary exercises in full and nothing for an untrained group', () => {
    expect(weekContributors([w], resolve, 'chest', '2026-10-12')).toEqual([{ exerciseId: 'bench', sets: 3, counted: 3, secondary: false }]);
    expect(weekContributors([w], resolve, 'quads', '2026-10-12')).toEqual([]);
  });
});

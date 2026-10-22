import { describe, expect, it } from 'bun:test';

import { isStrengthSport, lastUsedRoutineId } from './watchLive';
import type { Routine, StrengthWorkout } from './types';

const routine = (id: string) => ({ id }) as Routine;
const workout = (routineId: string | null, startedAt: number, deletedAt: number | null = null) =>
  ({ routineId, startedAt, deletedAt }) as StrengthWorkout;

describe('isStrengthSport', () => {
  it('knows the gym sports and nothing else', () => {
    expect(isStrengthSport(140)).toBe(true);
    expect(isStrengthSport(157)).toBe(true);
    expect(isStrengthSport(1)).toBe(false);
    expect(isStrengthSport(null)).toBe(false);
  });
});

describe('lastUsedRoutineId', () => {
  it('takes the routine of the latest workout that still exists', () => {
    const routines = [routine('r1'), routine('r2')];
    expect(lastUsedRoutineId(routines, [workout('r1', 10), workout('r2', 20), workout('r9', 30)])).toBe('r2');
  });
  it('skips deleted workouts and workouts without a routine', () => {
    expect(lastUsedRoutineId([routine('r1')], [workout('r1', 10), workout('r1', 99, 100), workout(null, 50)])).toBe('r1');
    expect(lastUsedRoutineId([routine('r1')], [workout(null, 50)])).toBeNull();
    expect(lastUsedRoutineId([], [workout('r1', 1)])).toBeNull();
  });
});

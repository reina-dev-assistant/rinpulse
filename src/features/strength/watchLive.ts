/**
 * A workout the watch records on its own (`LiveWorkout`, followed through `17/03`) that belongs in the strength logger: Strength training
 * (Huawei sport 140) and the other gym-type sports whose sets a person may want to tick off (CrossFit 145, Functional training 146, Core
 * training 157). The phone cannot start or control the watch's workout (`docs/strength.md`), so the logger follows the watch instead.
 * Framework free: runs under bun test.
 */
import type { Routine, StrengthWorkout } from './types';

export const STRENGTH_SPORT_TYPES: readonly number[] = [140, 145, 146, 157];

export function isStrengthSport(sportType: number | null | undefined): boolean {
  return sportType !== null && sportType !== undefined && STRENGTH_SPORT_TYPES.includes(sportType);
}

/**
 * The routine to preselect in the quick picker: the routine of the most recently started finished workout that still exists. Null when
 * no workout came from a saved routine (the picker then preselects nothing and "no routine" starts an empty workout).
 */
export function lastUsedRoutineId(routines: readonly Routine[], workouts: readonly StrengthWorkout[]): string | null {
  const known = new Set(routines.map((r) => r.id));
  let best: StrengthWorkout | null = null;
  for (const w of workouts) {
    if (w.deletedAt !== null || w.routineId === null || !known.has(w.routineId)) continue;
    if (best === null || w.startedAt > best.startedAt) best = w;
  }
  return best?.routineId ?? null;
}

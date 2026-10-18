/** What Today says about strength training when there is no watch to fill the screen: the last workout and how many in the past week. */

const WEEK_MS = 7 * 86_400_000;

export interface StrengthGlance {
  /** Start of the newest workout (ms), null with none. */
  lastAt: number | null;
  lastName: string;
  /** Workouts that started in the 7 days before `now`. */
  lastWeek: number;
}

interface WorkoutLike {
  startedAt: number;
  name: string;
}

/** `workouts` in any order. */
export function strengthGlance(workouts: readonly WorkoutLike[], now: number): StrengthGlance {
  let last: WorkoutLike | null = null;
  let lastWeek = 0;
  for (const w of workouts) {
    if (last === null || w.startedAt > last.startedAt) last = w;
    if (w.startedAt > now - WEEK_MS && w.startedAt <= now) lastWeek += 1;
  }
  return { lastAt: last?.startedAt ?? null, lastName: last?.name ?? '', lastWeek };
}

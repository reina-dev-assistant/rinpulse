/**
 * The person's lactate threshold: the heart rate (LTHR) and the pace at it. Two sources, neither derived from a personal best:
 * the JoyoFit time trial (`trial.ts`, kept by `lactate.ts`) and the value the watch itself works out in its workouts (`additional.lthrHr` and
 * `lthrPace` of the workout totals; the watch has to support it, and a build from the lactate-threshold commit on has to read it). The newer wins.
 * Pure: no storage here.
 */
import type { WorkoutRow } from '@/db/queries';
import type { WorkoutSummary } from '@/features/workouts/summary';

/** LTHR limits taken for real: under 90 or over 215 bpm is not a threshold. */
export const LTHR_RANGE = { min: 90, max: 215 } as const;
/** Threshold paces taken for real, seconds per km: 2:30 to 15:00. */
export const PACE_RANGE = { min: 150, max: 900 } as const;

export interface LactateValue {
  lthr: number;
  /** Seconds per km; null when the source gave none. */
  paceSecKm: number | null;
  /** Unix seconds: the effort of the trial, or the end of the watch's workout. */
  at: number;
  source: 'test' | 'watch';
  /** The workout the value comes from. */
  workoutId: number | null;
}

const inRange = (v: unknown, r: { min: number; max: number }): v is number => typeof v === 'number' && Number.isFinite(v) && v >= r.min && v <= r.max;

/** The time-trial result from its stored JSON; null when it is not one. */
export function parseLactateTest(raw: string | null): LactateValue | null {
  if (raw === null) return null;
  try {
    const doc = JSON.parse(raw) as Record<string, unknown>;
    const lthr = Math.round(Number(doc.lthr));
    const pace = doc.paceSecKm === null || doc.paceSecKm === undefined ? null : Math.round(Number(doc.paceSecKm));
    const at = Number(doc.at);
    if (!inRange(lthr, LTHR_RANGE) || !Number.isFinite(at)) return null;
    return { lthr, paceSecKm: inRange(pace, PACE_RANGE) ? pace : null, at, source: 'test', workoutId: typeof doc.workoutId === 'number' ? doc.workoutId : null };
  } catch {
    return null;
  }
}

/**
 * The watch's own lactate threshold: the newest workout (list is newest first) whose totals carry a plausible `lthrHr`. The pace is kept only
 * when it is a plausible seconds-per-km figure: the unit of `lthrPace` is the watch's and has not been checked against a capture.
 */
export function watchLactate(workouts: readonly { workout: Pick<WorkoutRow, 'id' | 'end' | 'start'>; summary: Pick<WorkoutSummary, 'additional'> }[]): LactateValue | null {
  let best: LactateValue | null = null;
  for (const { workout, summary } of workouts) {
    const extra = summary.additional;
    if (!extra) continue;
    const lthr = Math.round(Number(extra.lthrHr));
    if (!inRange(lthr, LTHR_RANGE)) continue;
    const pace = Math.round(Number(extra.lthrPace));
    const at = workout.end > 0 ? workout.end : workout.start;
    if (best === null || at > best.at) best = { lthr, paceSecKm: inRange(pace, PACE_RANGE) ? pace : null, at, source: 'watch', workoutId: workout.id };
  }
  return best;
}

/** The value to show first (the newer of the two) and the other one, when there is one. */
export function currentLactate(test: LactateValue | null, watch: LactateValue | null): { current: LactateValue; other: LactateValue | null } | null {
  if (test && watch) return test.at >= watch.at ? { current: test, other: watch } : { current: watch, other: test };
  const only = test ?? watch;
  return only ? { current: only, other: null } : null;
}

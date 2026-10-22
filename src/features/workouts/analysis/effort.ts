import type { HrZones } from '@/features/hrzones/zones';
import { strainAddedToDay, type WorkoutStrain } from '@/features/today/strain';
import type { WorkoutSummary } from '@/features/workouts/summary';
import type { StepSample } from '@/wear';

import { round, roundOrNull } from './round';
import { effortBand, type AnalysisEffort, type AnalysisLoad } from './types';

const DAY_SEC = 86400;
const ACUTE_DAYS = 7;
const CHRONIC_DAYS = 28;

export interface TrimpEntry {
  /** Unix seconds. */
  start: number;
  trimp: number;
}

/**
 * Relative effort: the workout's own strain (0..21) and Edwards TRIMP from `workoutStrain`, its band, and what it added to
 * its day on top of the day's other heart rate. `addedToDay` is null when there are no day samples to compare with.
 */
export function buildEffort(
  strain: WorkoutStrain,
  workout: { start: number; end: number },
  daySamples: readonly StepSample[],
  zones: HrZones,
): AnalysisEffort {
  const added = daySamples.length > 0 ? strainAddedToDay(daySamples, workout, strain.trimp, zones).added : null;
  const value = round(strain.strain, 1);
  return { strain: value, trimp: round(strain.trimp, 1), band: effortBand(value), addedToDay: roundOrNull(added, 1) };
}

/**
 * Training load: this workout's TRIMP against the previous days. `acute` sums the last 7 days up to and including this
 * workout, `chronicWeekly` the last 28 days divided by 4. `history` holds OTHER workouts; entries that did not start before
 * this one are ignored.
 */
export function buildLoad(trimp: number, start: number, history: readonly TrimpEntry[], summary: WorkoutSummary): AnalysisLoad {
  let acute = trimp;
  let chronic = trimp;
  for (const h of history) {
    if (!(h.start < start)) continue;
    if (h.start > start - CHRONIC_DAYS * DAY_SEC) chronic += h.trimp;
    if (h.start > start - ACUTE_DAYS * DAY_SEC) acute += h.trimp;
  }
  const chronicWeekly = chronic / (CHRONIC_DAYS / 7);
  return {
    trimp: round(trimp, 1),
    acute: round(acute, 1),
    chronicWeekly: round(chronicWeekly, 1),
    ratio: chronicWeekly > 0 ? round(acute / chronicWeekly, 2) : null,
    watchLoad: roundOrNull(summary.workoutLoad, 1),
    aerobicEffect: roundOrNull(summary.aerobicEffect, 1),
    anaerobicEffect: roundOrNull(summary.anaerobicEffect, 1),
    recoveryHours: roundOrNull(summary.recoveryHours, 1),
  };
}

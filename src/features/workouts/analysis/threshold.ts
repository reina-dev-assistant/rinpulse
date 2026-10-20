import type { WorkoutRow } from '@/db/queries';

import { bestEffortsForHistory, type EffortSeconds } from './efforts';
import type { RawFix } from './geo';
import { sportKind } from './sport';
import type { SportKind } from './types';

/**
 * Days of runs the threshold pace is taken over. The workout analysis (runs before the workout) and the coach (runs before
 * now) both use it, so an easy week never pulls the threshold slower than the best run of these days.
 */
export const THRESHOLD_WINDOW_DAYS = 90;

const DAY_SEC = 86400;

/** Best efforts per finished workout; a complete download never changes, so each one's points are read once. */
const cache = new Map<string, EffortSeconds>();

/**
 * Whether the finished workout `w` is one of the on-foot workouts of `kind` that started inside the window before `beforeSec`.
 * With kind 'run' these are the runs the threshold pace is taken from (walks and hikes never are). The kind comes from the
 * sport name and then the summary's `kind`, because the name differs by source ("Running" from the watch, "Run" recorded
 * on the phone or imported from a FIT file, "Trail run").
 */
export function inEffortWindow(w: WorkoutRow, summaryKind: string | undefined, kind: SportKind, beforeSec: number): boolean {
  return w.complete && w.start < beforeSec && w.start >= beforeSec - THRESHOLD_WINDOW_DAYS * DAY_SEC && sportKind(w.sportName, summaryKind) === kind;
}

/** Best efforts of `w` already read, if any. */
export function cachedEfforts(w: WorkoutRow): EffortSeconds | undefined {
  return cache.get(`${w.id}:${w.start}:${w.end}`);
}

/**
 * Best efforts of a finished on-foot workout from its stored points, remembered for complete workouts. Running and walking
 * clean the track the same way, so one set serves both.
 */
export function effortsOf(w: WorkoutRow, points: readonly RawFix[]): EffortSeconds {
  const efforts = bestEffortsForHistory(points, 'run');
  if (w.complete) cache.set(`${w.id}:${w.start}:${w.end}`, efforts);
  return efforts;
}

/** Forgets every remembered effort set (tests that reuse workout ids across databases). */
export function clearEffortCache(): void {
  cache.clear();
}

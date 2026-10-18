import { sportKind } from '@/features/workouts/analysis/sport';
import { liveDone, type DoneEntry } from './doc';
import type { PlannedSession } from './plans/types';
import { daysBetween, localDay } from './time';

/**
 * Matching finished sessions to watch workouts, automatically after each sync. A workout belongs to the plan session that
 *  - is of the same kind: running sessions take a run (a walk or a run for walk/run and recovery sessions), strength
 *    sessions take a strength-type workout (strength, functional, core, HIIT);
 *  - lasted long enough: at least 50 % of the planned minutes (60 % for walk/run, whose minutes include the walking),
 *    a race session at least 90 % of its distance, a strength session at least 15 minutes;
 *  - falls from one day before the session's day to two days after it (a session done a day early or two late still
 *    counts), and is not before the day the plan was made.
 * Workouts are taken oldest first; each takes the nearest free session by day, then by slot. A session already done or
 * skipped is left alone, and one workout never counts twice.
 */

const EARLY_DAYS = 1;
const LATE_DAYS = 2;
const MIN_SHARE = 0.5;
const MIN_WALKRUN_SHARE = 0.6;
const MIN_RACE_SHARE = 0.9;
const MIN_STRENGTH_SEC = 15 * 60;

export interface MatchWorkout {
  /** `workouts.start`, unix seconds. */
  start: number;
  /** Active seconds. */
  duration: number;
  /** Metres. */
  distance: number;
  sportName: string;
  summaryKind?: string;
}

const STRENGTH_RE = /strength|functional|core training|hiit|high-intensity|calisthenic|gym/i;

export function isStrengthWorkout(sportName: string, summaryKind?: string): boolean {
  return STRENGTH_RE.test(`${sportName} ${summaryKind ?? ''}`);
}

/** Whether the workout is long enough and of the right kind for the session. */
export function workoutFitsSession(workout: MatchWorkout, session: PlannedSession): boolean {
  if (session.kind === 'strength') {
    return isStrengthWorkout(workout.sportName, workout.summaryKind) && workout.duration >= MIN_STRENGTH_SEC;
  }
  const kind = sportKind(workout.sportName, workout.summaryKind);
  const type = session.type;
  const onFoot = type === 'walkrun' || type === 'recovery' ? kind === 'run' || kind === 'walk' : kind === 'run';
  if (!onFoot) return false;
  if (type === 'race' && session.run?.distanceM) return workout.distance >= session.run.distanceM * MIN_RACE_SHARE;
  const share = type === 'walkrun' ? MIN_WALKRUN_SHARE : MIN_SHARE;
  return workout.duration >= session.minutes * 60 * share;
}

/**
 * The new `done` entries for workouts that match sessions. `done` is what is already stored (matched workouts are not
 * matched again). Returns only the additions.
 */
export function matchWorkouts(
  sessions: readonly PlannedSession[],
  done: Record<string, DoneEntry>,
  workouts: readonly MatchWorkout[],
  nowMs: number,
): Record<string, DoneEntry> {
  const used = new Set(Object.values(done).map((d) => d.workoutStart).filter((s): s is number => s !== null));
  const added: Record<string, DoneEntry> = {};
  const live = liveDone(done);
  const open = sessions.filter((s) => !s.beforeStart && !live[s.key]);
  for (const workout of [...workouts].sort((a, b) => a.start - b.start)) {
    if (used.has(workout.start)) continue;
    const day = localDay(workout.start);
    let best: PlannedSession | null = null;
    let bestOffset = Infinity;
    for (const session of open) {
      if (added[session.key]) continue;
      const offset = daysBetween(session.day, day);
      if (offset < -EARLY_DAYS || offset > LATE_DAYS) continue;
      if (!workoutFitsSession(workout, session)) continue;
      const distance = Math.abs(offset) + (offset < 0 ? 0.5 : 0);
      if (distance < bestOffset || (distance === bestOffset && best !== null && session.slot < best.slot)) {
        best = session;
        bestOffset = distance;
      }
    }
    if (best) {
      added[best.key] = { workoutStart: workout.start, at: nowMs, manual: false, skipped: false };
      used.add(workout.start);
    }
  }
  return added;
}

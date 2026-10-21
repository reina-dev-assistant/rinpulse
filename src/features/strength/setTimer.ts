/**
 * The stopwatch of one timed set (plank, wall sit): started from the play button of a set row, it counts up, or down from the set's
 * planned seconds, and stops by a tap or by reaching zero. Pure functions of the clock (`now` is a parameter); the active-workout
 * screen holds one `SetTimer` and stores the result in the set with `updateSet`. The rest timer is a different thing (`draft.rest`).
 */
import { MAX_SECONDS } from './logFormat';

export interface SetTimer {
  exerciseKey: string;
  setId: string;
  /** Epoch ms of the start. */
  startedAt: number;
  /** Seconds to count down from; null = count up. */
  targetSec: number | null;
}

/** A countdown needs a planned time of at least one second; anything else counts up. */
export function startSetTimer(exerciseKey: string, setId: string, plannedSec: number | null, countdown: boolean, now: number): SetTimer {
  const target = countdown && plannedSec !== null && plannedSec >= 1 ? Math.min(MAX_SECONDS, Math.round(plannedSec)) : null;
  return { exerciseKey, setId, startedAt: now, targetSec: target };
}

/** Whole seconds since the start. */
export const timerElapsedSec = (timer: Pick<SetTimer, 'startedAt'>, now: number): number => Math.max(0, Math.floor((now - timer.startedAt) / 1000));

/** The clock the row shows: seconds left of a countdown (rounded up, so it reads 0:01 until the end), or seconds elapsed. */
export function timerShownSec(timer: SetTimer, now: number): number {
  if (timer.targetSec === null) return Math.min(MAX_SECONDS, timerElapsedSec(timer, now));
  return Math.max(0, Math.ceil((timer.startedAt + timer.targetSec * 1000 - now) / 1000));
}

/** A countdown that reached zero. */
export const timerFinished = (timer: SetTimer, now: number): boolean =>
  timer.targetSec !== null && now - timer.startedAt >= timer.targetSec * 1000;

/** The seconds a stop stores in the set: what elapsed, at most the target of a countdown, at least one. */
export function timerResultSec(timer: SetTimer, now: number): number {
  const elapsed = Math.max(1, Math.round((now - timer.startedAt) / 1000));
  return Math.min(MAX_SECONDS, timer.targetSec === null ? elapsed : Math.min(elapsed, timer.targetSec));
}

/** Vibration pattern (Android: wait, vibrate, wait, vibrate in ms; iOS plays one buzz) when a countdown ends. */
export const COUNTDOWN_VIBRATION: readonly number[] = [0, 350, 150, 350];

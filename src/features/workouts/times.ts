/**
 * The two durations of a workout and what is derived from them, in one place so the header, the analysis, the share card,
 * the JoyoRogo post and the Strava file all show the same figures.
 *
 * - `movingSec` is the watch's own timer (`duration`), the time the watch shows when the workout ends, and the time every
 *   average pace and speed is computed from (653 s over 1.01 km is 10'47"/km, as on the watch). Only when the watch gave
 *   no timer (0 or less) does it fall back to the elapsed time.
 * - `elapsedSec` is `end - start`, the watch's start and end time stamps ("Total waktu"). It is a few seconds longer than the
 *   timer (2 s on the 19 Oct run: 655 against 653; 3 s on the owner's walk) because the timer starts after the start stamp
 *   or the end stamp is written after the timer stops; longer when the wearer paused.
 * - The Strava file carries the same two figures: `total_timer_time` is `movingSec`, `total_elapsed_time` is `elapsedSec`, and
 *   the difference is written as a timer stop and start (see `activityFile.ts`) so Strava's moving time can follow the timer.
 */

export interface WorkoutTimes {
  elapsedSec: number;
  movingSec: number;
}

/** `end - start`; the watch's active time when the end is not usable. */
export function elapsedOfWorkout(w: { start: number; end: number; duration: number }): number {
  return w.end > w.start ? w.end - w.start : Math.max(w.duration, 0);
}

/** Moving seconds: the watch's timer, or the elapsed time when the watch gave none. */
export function movingOf(elapsedSec: number, activeSec: number): number {
  return activeSec > 0 ? activeSec : elapsedSec;
}

export function workoutTimes(w: { start: number; end: number; duration: number }): WorkoutTimes {
  const elapsedSec = elapsedOfWorkout(w);
  return { elapsedSec, movingSec: movingOf(elapsedSec, w.duration) };
}

/** Metres over moving seconds, as Strava's average speed; null without both or under 100 m. */
export function averageSpeedMs(distanceM: number, movingSec: number): number | null {
  return distanceM >= 100 && movingSec > 0 ? distanceM / movingSec : null;
}

/** Seconds per `perM` metres (1000 for km, 100 for swimming); null like `averageSpeedMs`. */
export function averagePaceSec(distanceM: number, movingSec: number, perM = 1000): number | null {
  const speed = averageSpeedMs(distanceM, movingSec);
  return speed === null ? null : perM / speed;
}

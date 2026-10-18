/**
 * The replay timeline. A replay is `intro` (the camera settles on the start), `run` (the route draws as the camera follows)
 * and `outro` (zoom out to the whole route, then the summary card). Its length scales with the workout: 15 s for 10 minutes
 * or less up to 45 s for 4 hours or more, on a log scale so a 1 h ride is not three times a 20 min one. The speed control
 * and the export only change how fast the timeline is walked, never the timeline.
 */

export const REPLAY_MIN_SEC = 15;
export const REPLAY_MAX_SEC = 45;
export const SHORT_WORKOUT_SEC = 10 * 60;
export const LONG_WORKOUT_SEC = 4 * 3600;
export const INTRO_SEC = 1.2;
export const OUTRO_SEC = 4.5;
/** Playback speeds the player offers. */
export const SPEEDS = [0.5, 1, 2] as const;
export type ReplaySpeed = (typeof SPEEDS)[number];
/** Share of the run spent speeding up and slowing down at either end. */
const RAMP = 0.07;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Seconds a replay of a workout of `workoutSec` lasts at 1x. */
export function replayDurationSec(workoutSec: number): number {
  if (!Number.isFinite(workoutSec) || workoutSec <= SHORT_WORKOUT_SEC) return REPLAY_MIN_SEC;
  const f = clamp01(Math.log(workoutSec / SHORT_WORKOUT_SEC) / Math.log(LONG_WORKOUT_SEC / SHORT_WORKOUT_SEC));
  return Math.round((REPLAY_MIN_SEC + (REPLAY_MAX_SEC - REPLAY_MIN_SEC) * f) * 10) / 10;
}

export interface Timing {
  introSec: number;
  runSec: number;
  outroSec: number;
  totalSec: number;
}

export function buildTiming(workoutSec: number): Timing {
  const totalSec = replayDurationSec(workoutSec);
  return { introSec: INTRO_SEC, runSec: totalSec - INTRO_SEC - OUTRO_SEC, outroSec: OUTRO_SEC, totalSec };
}

export type Phase = 'intro' | 'run' | 'outro';

export interface PhasePosition {
  phase: Phase;
  /** Route progress 0..1 (eased): 0 in the intro, 1 in the outro. */
  p: number;
  /** 0..1 through the outro; 0 before it. */
  outroP: number;
  /** 0..1 through the intro; 1 after it. */
  introP: number;
}

/**
 * Trapezoid speed profile: ease in over the first `RAMP` of the run, constant speed, ease out over the last `RAMP`.
 * Position is continuous, monotonic, 0 at 0 and 1 at 1.
 */
export function runProgress(u: number): number {
  const x = clamp01(u);
  const vmax = 1 / (1 - RAMP);
  if (x < RAMP) return (vmax * x * x) / (2 * RAMP);
  if (x > 1 - RAMP) {
    const r = 1 - x;
    return 1 - (vmax * r * r) / (2 * RAMP);
  }
  return (vmax * RAMP) / 2 + vmax * (x - RAMP);
}

export function phaseAt(timing: Timing, t: number): PhasePosition {
  const time = Math.min(timing.totalSec, Math.max(0, t));
  if (time < timing.introSec) return { phase: 'intro', p: 0, outroP: 0, introP: time / timing.introSec };
  const runEnd = timing.introSec + timing.runSec;
  if (time < runEnd) return { phase: 'run', p: runProgress((time - timing.introSec) / timing.runSec), outroP: 0, introP: 1 };
  return { phase: 'outro', p: 1, outroP: clamp01((time - runEnd) / timing.outroSec), introP: 1 };
}

/** The timeline second at which the route progress first reaches `p`. */
export function timeOfProgress(timing: Timing, p: number): number {
  const target = clamp01(p);
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (runProgress(mid) < target) lo = mid;
    else hi = mid;
  }
  return timing.introSec + ((lo + hi) / 2) * timing.runSec;
}

/** Wall seconds the replay takes at `speed`. */
export function playbackSec(timing: Timing, speed: number): number {
  return timing.totalSec / speed;
}

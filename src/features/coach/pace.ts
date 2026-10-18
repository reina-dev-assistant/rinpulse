import type { SessionType } from './plans/types';

/**
 * Pace targets as a share of the threshold pace (about a one-hour effort, `analysis/zones.ts`): [fast edge, slow edge].
 * Easy and long runs take the endurance zone (1.14 to 1.29), a recovery run goes slower, tempo sits at 1.06 to 1.14, intervals
 * at 0.94 to 1.0. Walk/run, a race and strength have no pace target.
 */
export const PACE_BANDS: Partial<Record<SessionType, [number, number]>> = {
  recovery: [1.29, 1.6],
  easy: [1.14, 1.29],
  long: [1.14, 1.29],
  tempo: [1.06, 1.14],
  intervals: [0.94, 1.0],
};

/** The types whose whole-workout average pace is judged in the post-workout feedback. */
export const SCORED_PACE_TYPES: readonly SessionType[] = ['easy', 'long', 'tempo'];

/** Seconds per km, fast and slow edge, for a session type at a threshold pace; null when the type has no pace target. */
export function paceTarget(type: SessionType, thresholdSecKm: number): { fast: number; slow: number } | null {
  const band = PACE_BANDS[type];
  return band ? { fast: thresholdSecKm * band[0], slow: thresholdSecKm * band[1] } : null;
}

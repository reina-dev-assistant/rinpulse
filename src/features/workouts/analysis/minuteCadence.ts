import { MAX_SPM, MIN_SPM } from './stride';

/** The part of a watch step sample the cadence needs: the minute it starts (unix seconds) and the steps counted in it. */
export interface MinuteSteps {
  timestamp: number;
  steps: number;
}

/**
 * Cadence from the watch's per-minute step samples, for a foot workout whose points carry no cadence: a minute with N steps is
 * N steps per minute. Only minutes that lie wholly inside `[start, end]` count (a partial minute would read low), and a minute
 * outside the human range (see `stride.ts`: a stop, a pause, a few steps) stays a gap rather than a zero. Each minute holds its
 * value across the grid samples it covers; there is no smoothing and nothing is filled between minutes. Null without any
 * usable minute.
 */
export function minuteCadenceGrid(
  samples: readonly MinuteSteps[],
  start: number,
  end: number,
  stepSec: number,
  n: number,
): (number | null)[] | null {
  const out: (number | null)[] = new Array(n).fill(null);
  let any = false;
  for (const sample of samples) {
    const begin = sample.timestamp;
    if (!(begin >= start) || !(begin + 60 <= end)) continue;
    if (!(sample.steps >= MIN_SPM && sample.steps <= MAX_SPM)) continue;
    const first = Math.ceil((begin - start) / stepSec);
    const last = Math.min(n - 1, Math.ceil((begin + 60 - start) / stepSec) - 1);
    for (let i = first; i <= last; i++) {
      out[i] = sample.steps;
      any = true;
    }
  }
  return any ? out : null;
}

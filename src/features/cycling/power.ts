import type { RideSeries } from './series';
import type { FtpSuggestion, PowerEffort, PowerZone, PowerZoneKey } from './types';

/**
 * Power metrics of a ride, from Coggan and Allen, "Training and Racing with a Power Meter" (3rd ed. 2019) and the definitions
 * TrainingPeaks and GoldenCheetah publish:
 *
 * - Normalized power (NP): the 30 s rolling mean of power, each value raised to the 4th power, averaged, then the 4th root. The
 *   first value is the mean of seconds 1 to 30. Stretches the recorder was stopped (not `covered`) are dropped before rolling, so a
 *   pause does not drag the average to zero; seconds the recorder ran with no watts (coasting) are zeros and stay.
 * - Intensity factor (IF) = NP / FTP.
 * - Training stress score (TSS) = seconds x NP x IF / (FTP x 3600) x 100, so an hour at FTP is 100.
 * - Variability index (VI) = NP / average power.
 * - Work in kJ = the sum of watts over the seconds / 1000.
 */
const NP_WINDOW_SEC = 30;

/** Watts per covered second: zero where the recorder was stopped, and where it ran but the meter said nothing (a dropout counts as coasting). */
export function wattsOf(series: RideSeries): Float64Array {
  const out = new Float64Array(series.n);
  for (let i = 0; i < series.n; i++) {
    const w = series.power[i];
    out[i] = series.covered[i] && !Number.isNaN(w) ? w : 0;
  }
  return out;
}

/** NP of watts over the covered seconds; null under 30 s of data. */
export function normalizedPower(watts: ArrayLike<number>, covered: ArrayLike<number>): number | null {
  const compact: number[] = [];
  for (let i = 0; i < watts.length; i++) if (covered[i]) compact.push(watts[i]);
  if (compact.length < NP_WINDOW_SEC) return null;
  let window = 0;
  for (let i = 0; i < NP_WINDOW_SEC - 1; i++) window += compact[i];
  let sum4 = 0;
  let count = 0;
  for (let i = NP_WINDOW_SEC - 1; i < compact.length; i++) {
    window += compact[i];
    const mean = window / NP_WINDOW_SEC;
    sum4 += mean ** 4;
    count += 1;
    window -= compact[i - NP_WINDOW_SEC + 1];
  }
  return (sum4 / count) ** 0.25;
}

/** Intensity factor, null without FTP or NP. */
export function intensityFactor(np: number | null, ftp: number | null): number | null {
  return np !== null && ftp !== null && ftp > 0 ? np / ftp : null;
}

/** TSS from the seconds the NP is based on, NP and FTP. */
export function trainingStressScore(sec: number, np: number | null, ftp: number | null): number | null {
  const intensity = intensityFactor(np, ftp);
  if (np === null || ftp === null || intensity === null) return null;
  return ((sec * np * intensity) / (ftp * 3600)) * 100;
}

/** Edwards TRIMP of one hour at FTP: heart rate at threshold is zone 4 (80 to 90 % of maximum), 4 x 60. */
export const TRIMP_PER_HOUR_AT_FTP = 240;
/** Edwards TRIMP per TSS point: TSS 100 is an hour at FTP, which the heart rate model scores 240. JoyoFit's calibration, not a published constant. */
export const TSS_TO_TRIMP = TRIMP_PER_HOUR_AT_FTP / 100;

/** Coggan's seven zones as shares of FTP: lower bounds, the first zone starting at 0 and the last open ended. */
const ZONE_EDGES: readonly { key: PowerZoneKey; from: number }[] = [
  { key: 'z1', from: 0 },
  { key: 'z2', from: 0.55 },
  { key: 'z3', from: 0.75 },
  { key: 'z4', from: 0.9 },
  { key: 'z5', from: 1.05 },
  { key: 'z6', from: 1.2 },
  { key: 'z7', from: 1.5 },
];

/** Watts of the zone edges at `ftp` (z1 .. z7), each zone from its edge up to the next. */
export function zoneBounds(ftp: number): { key: PowerZoneKey; fromW: number; toW: number | null }[] {
  return ZONE_EDGES.map((z, i) => ({
    key: z.key,
    fromW: i === 0 ? 0 : Math.round(z.from * ftp),
    toW: i === ZONE_EDGES.length - 1 ? null : Math.round(ZONE_EDGES[i + 1]!.from * ftp),
  }));
}

/** Seconds in each zone: every covered second counts once, coasting in zone 1 like in the Coggan chart. */
export function powerZones(watts: ArrayLike<number>, covered: ArrayLike<number>, ftp: number): PowerZone[] {
  const sec = ZONE_EDGES.map(() => 0);
  for (let i = 0; i < watts.length; i++) {
    if (!covered[i]) continue;
    const share = watts[i] / ftp;
    let z = 0;
    while (z + 1 < ZONE_EDGES.length && share >= ZONE_EDGES[z + 1]!.from) z += 1;
    sec[z] += 1;
  }
  return zoneBounds(ftp).map((b, i) => ({ ...b, sec: sec[i]! }));
}

/** The durations of the power curve, seconds; the five the brief names come first in meaning (5 s, 1, 5, 20, 60 min). */
export const CURVE_DURATIONS: readonly number[] = [1, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 2700, 3600, 5400, 7200];
export const KEY_DURATIONS: readonly number[] = [5, 60, 300, 1200, 3600];

/**
 * The best mean power for each duration over a continuous stretch of the ride (the wall clock: a stop inside the window counts as
 * zeros, as in Strava's and GoldenCheetah's curves). A duration longer than the ride has no entry. Prefix sums, O(n) per duration.
 */
export function powerCurve(watts: ArrayLike<number>, durations: readonly number[] = CURVE_DURATIONS): PowerEffort[] {
  const n = watts.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + watts[i];
  const out: PowerEffort[] = [];
  for (const d of durations) {
    if (d > n) continue;
    let best = -1;
    let at = 0;
    for (let i = 0; i + d <= n; i++) {
      const sum = prefix[i + d] - prefix[i];
      if (sum > best) {
        best = sum;
        at = i;
      }
    }
    if (best >= 0) out.push({ sec: d, watts: best / d, atSec: at });
  }
  return out;
}

/** FTP is 95 % of the best 20 minute power (Allen and Coggan). A suggestion only; null without a 20 minute effort. */
export function ftpSuggestion(best20Watts: number | null): FtpSuggestion | null {
  if (best20Watts === null || !(best20Watts > 0)) return null;
  return { watts: Math.round(best20Watts * 0.95), best20Watts: Math.round(best20Watts) };
}

export const FTP_MIN_W = 50;
export const FTP_MAX_W = 600;

/** The whole watts in a typed text, or null when it is empty or outside the plausible range. */
export function parseFtp(text: string): number | null {
  const digits = text.replace(/\D/g, '');
  if (digits.length === 0) return null;
  const value = Number(digits);
  return value >= FTP_MIN_W && value <= FTP_MAX_W ? value : null;
}

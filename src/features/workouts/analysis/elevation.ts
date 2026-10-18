import type { WorkoutSummary } from '@/features/workouts/summary';

import { altitudeGrid, elapsedOf, gridStep, type AnalysisPoint } from './series';

/**
 * Elevation gain and loss: a centred moving mean of the altitude over `ELEVATION_SMOOTH_SEC` seconds, then a hysteresis
 * of `ELEVATION_HYSTERESIS_M` metres (a climb or a drop counts once the smoothed altitude has moved that far from the last
 * counted level, in full).
 *
 * Why: the watch's own gain (`summary.elevationGain`) is the sum of every rise of its barometer, so sensor noise and the
 * breathing of the reading count as climbing: 59 m for a walk Strava gives 24 m (a 29 m span of altitude, up and down
 * twice). Strava does not take the device's value for a file like ours either: it replaces the altitude with its terrain
 * model (its altitude stream starts 8 m below our barometer and has steps of 0.1 m) and counts the rises of that smoother
 * curve. Terrain data cannot be reproduced on the phone, so the method is fitted to Strava's results instead: the four
 * JoyoFit uploads and nine Huawei Health uploads whose gain Strava shows (athlete 70568894; every window from 30 to 120 s
 * and threshold from 0 to 2 m tried). Several settings tie on the JoyoFit uploads, which have this watch's barometer
 * (13.5 to 14.5 m of total error); 60 s and 1 m has the smallest error over all 13 among them (48 m) and gives 24.3 m for
 * the owner's walk against Strava's 23.6 m, 1.0 against 2.1 for a flat walk, 3.1 against 0 for another and 9.3 against
 * 18.2 for a gentle one (the best fit over all 13 is 39 m but misses the owner's walk by 8 m). Strava's terrain curve
 * differs from the barometer in places, so one workout can still be several metres apart; the tests pin the values.
 */
export const ELEVATION_SMOOTH_SEC = 60;
export const ELEVATION_HYSTERESIS_M = 1;

export interface ElevationProfile {
  gain: number;
  loss: number;
  /** Cumulative gain/loss at every sample (non-decreasing), so a stretch's climb is a difference of two entries. */
  cumGain: number[];
  cumLoss: number[];
}

/** Centred moving mean over `windowSec`; nulls stay null and are skipped inside a window, a window is cut at the ends. */
function movingMean(values: readonly (number | null)[], stepSec: number, windowSec: number): (number | null)[] {
  const h = Math.max(0, Math.floor(windowSec / stepSec / 2));
  if (h === 0) return [...values];
  const prefix = [0];
  const counts = [0];
  for (const v of values) {
    prefix.push(prefix[prefix.length - 1] + (v ?? 0));
    counts.push(counts[counts.length - 1] + (v === null ? 0 : 1));
  }
  return values.map((v, i) => {
    if (v === null) return null;
    const lo = Math.max(0, i - h);
    const hi = Math.min(values.length, i + h + 1);
    return (prefix[hi] - prefix[lo]) / (counts[hi] - counts[lo]);
  });
}

/**
 * Gain and loss of an altitude series sampled every `stepSec` seconds (see the constants above for the method; a bike passes
 * its own smoothing and hysteresis, see `features/cycling`). Null samples carry the previous level.
 */
export function elevationProfile(
  alt: readonly (number | null)[],
  stepSec = 1,
  smoothSec = ELEVATION_SMOOTH_SEC,
  hysteresisM = ELEVATION_HYSTERESIS_M,
): ElevationProfile {
  const cumGain: number[] = [];
  const cumLoss: number[] = [];
  let gain = 0;
  let loss = 0;
  let ref: number | null = null;
  for (const a of movingMean(alt, stepSec, smoothSec)) {
    if (a !== null) {
      if (ref === null) ref = a;
      else if (a - ref >= hysteresisM) {
        gain += a - ref;
        ref = a;
      } else if (ref - a >= hysteresisM) {
        loss += ref - a;
        ref = a;
      }
    }
    cumGain.push(gain);
    cumLoss.push(loss);
  }
  return { gain, loss, cumGain, cumLoss };
}

export interface ElevationSummary {
  gainM: number;
  lossM: number;
  minM: number;
  maxM: number;
}

function finiteNonNegative(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Gain and loss to show. A file imported from another device (`importedFrom`) carries that device's own totals, which are
 * what its platform shows, so they win; a watch workout takes the profile of its altitude series (the watch's raw sum is
 * noise, see above) and only without altitude falls back to the watch's figures.
 */
function gainLoss(profile: ElevationProfile | null, summary: WorkoutSummary): { gain: number | null; loss: number | null } {
  const own = { gain: finiteNonNegative(summary.elevationGain), loss: finiteNonNegative(summary.elevationLoss) };
  const computed = profile ? { gain: profile.gain, loss: profile.loss } : { gain: null, loss: null };
  const [first, second] = summary.importedFrom !== undefined ? [own, computed] : [computed, own];
  return { gain: first.gain ?? second.gain, loss: first.loss ?? second.loss };
}

/** Elevation totals; min and max come from the altitude series, else the summary. Null when nothing says anything. */
export function elevationSummary(
  alt: readonly (number | null)[] | null,
  profile: ElevationProfile | null,
  summary: WorkoutSummary,
): ElevationSummary | null {
  const { gain, loss } = gainLoss(profile, summary);
  let min = Infinity;
  let max = -Infinity;
  for (const a of alt ?? []) {
    if (a === null) continue;
    if (a < min) min = a;
    if (a > max) max = a;
  }
  if (min === Infinity) {
    min = summary.minAltitude ?? Infinity;
    max = summary.maxAltitude ?? -Infinity;
  }
  if (gain === null || loss === null || min === Infinity || max === -Infinity) return null;
  return { gainM: gain, lossM: loss, minM: min, maxM: max };
}

/**
 * The gain and loss the analysis of this workout will show, without building the whole analysis: the header, the share
 * card and the Strava file use it to say the same numbers. Null when neither the points nor the summary have any.
 */
export function workoutElevation(
  workout: { start: number; end: number; duration: number },
  summary: WorkoutSummary,
  points: readonly AnalysisPoint[],
): { gainM: number; lossM: number } | null {
  const elapsedSec = elapsedOf({ ...workout, points });
  const stepSec = gridStep(elapsedSec);
  const altRaw = altitudeGrid(points, workout.start, stepSec, Math.ceil(elapsedSec / stepSec) + 1);
  const { gain, loss } = gainLoss(altRaw.some((a) => a !== null) ? elevationProfile(altRaw, stepSec) : null, summary);
  return gain === null || loss === null ? null : { gainM: gain, lossM: loss };
}

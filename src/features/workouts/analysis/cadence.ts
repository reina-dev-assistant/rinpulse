import type { WorkoutSummary } from '@/features/workouts/summary';

import type { AnalysisPoint, Grid } from './series';
import { isFootKind } from './sport';
import { cadenceFromSteps, MAX_PER_LEG_CADENCE, plausibleStepLength, stepLengthFromSpeed } from './stride';
import type { SportKind } from './types';

/**
 * Average and maximum cadence and the average step length of one workout, from the first source that has each figure. The
 * workout screen's stats, the cloud analysis, the share card and the Strava file all call `cadenceFigures`, so they show
 * the same numbers.
 *
 * Cadence is steps per minute on foot and revolutions per minute on a bike; step length is metres.
 */
export interface CadenceFigures {
  avgCad: number | null;
  maxCad: number | null;
  avgStrideM: number | null;
}

export interface CadenceInput {
  kind: SportKind;
  summary: WorkoutSummary;
  /** `workouts.steps`: what the watch counted. */
  steps: number;
  /** The shared time grid: its cadence series (zeros are gaps) and the moving time. */
  grid: Pick<Grid, 'cad' | 'movingSec'>;
  /** The raw points, for the measured step length. */
  points: readonly Pick<AnalysisPoint, 'stride'>[];
  /** Average speed in m/s, for the derived step length. */
  avgSpeedMs: number | null;
}

function finitePositive(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function gridMean(values: readonly (number | null)[] | null): number | null {
  if (!values) return null;
  let sum = 0;
  let count = 0;
  for (const v of values) {
    if (v !== null) {
      sum += v;
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

function gridMax(values: readonly (number | null)[] | null): number | null {
  if (!values) return null;
  let max: number | null = null;
  for (const v of values) if (v !== null && (max === null || v > max)) max = v;
  return max;
}

/** Mean of one field over the watch's per-km blocks that have it, weighted by block length (a short last block counts less). */
function sectionsMean(summary: WorkoutSummary, field: 'cadence' | 'stepLength'): number | null {
  let sum = 0;
  let weight = 0;
  for (const section of summary.sections ?? []) {
    const value = finitePositive(section[field]);
    if (value === null) continue;
    const w = finitePositive(section.distance) ?? 1;
    sum += value * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : null;
}

/**
 * Average and maximum cadence a workout's summary holds, in steps per minute. A FIT import keeps the file's own session
 * figures, which count strides (one foot) per minute on foot, so they are doubled; a watch workout keeps the mean of its
 * samples under `samples` (`avgStepRate` for walking with the new step algorithm, `avgCadence` otherwise) and its per-km
 * blocks under `sections`.
 */
export function summaryCadence(kind: SportKind, summary: WorkoutSummary, which: 'avg' | 'max'): number | null {
  const own = finitePositive(which === 'avg' ? summary.avgCadence : summary.maxCadence);
  if (own !== null) return summary.importedFrom && isFootKind(kind) && summary.cadencePerLeg !== false && own <= MAX_PER_LEG_CADENCE ? own * 2 : own;
  if (which === 'max') return null;
  return finitePositive(summary.samples?.avgCadence) ?? finitePositive(summary.samples?.avgStepRate) ?? sectionsMean(summary, 'cadence');
}

/** Metres per step a summary holds: a FIT session's `avg_step_length`, or a watch's own mean over its samples or per-km blocks (centimetres). */
function summaryStepLength(summary: WorkoutSummary): number | null {
  const watchCm = finitePositive(summary.samples?.avgStepLength) ?? sectionsMean(summary, 'stepLength');
  return plausibleStepLength(summary.avgStepLengthM) ?? plausibleStepLength(watchCm === null ? null : watchCm / 100);
}

/**
 * Cadence: the per-sample series, else the summary (the FIT session, the watch's sample averages, its per-km blocks), else on
 * foot the step count over the moving time. Step length: the per-sample values, else the summary, else on foot the average speed
 * over the average cadence. Estimates outside the human range are dropped, see `stride.ts`.
 */
export function cadenceFigures(input: CadenceInput): CadenceFigures {
  const { kind, summary, grid, points } = input;
  const foot = isFootKind(kind);
  const avgCad = gridMean(grid.cad) ?? summaryCadence(kind, summary, 'avg') ?? (foot ? cadenceFromSteps(input.steps, grid.movingSec) : null);
  const maxCad = gridMax(grid.cad) ?? summaryCadence(kind, summary, 'max');

  let strideSum = 0;
  let strideCount = 0;
  for (const p of points) {
    if (typeof p.stride === 'number' && p.stride > 0) {
      strideSum += p.stride;
      strideCount += 1;
    }
  }
  const avgStrideM =
    plausibleStepLength(strideCount > 0 ? strideSum / strideCount : null) ??
    summaryStepLength(summary) ??
    (foot ? stepLengthFromSpeed(input.avgSpeedMs, avgCad) : null);
  return { avgCad, maxCad, avgStrideM };
}

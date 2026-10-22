import type { WorkoutSummary } from './summary';

/** The running-form series a watch workout keeps in `summary_json.dynamics` (`RunDynamics.kt`): one value per `stepSec`, null for a gap. */
export interface DynamicsJson {
  /** Unix seconds of the first bucket. */
  start?: number;
  stepSec?: number;
  gct?: (number | null)[];
  vo?: (number | null)[];
  vr?: (number | null)[];
  gtb?: (number | null)[];
  hang?: (number | null)[];
}

export type DynamicsMetric = 'gct' | 'vo' | 'vr' | 'gtb';

/** The range a reading must lie in to count; the watch's own "no reading" markers and wild values fall outside it. */
const RANGE: Record<DynamicsMetric, readonly [number, number]> = {
  gct: [100, 600], // milliseconds
  vo: [2, 25], // centimetres
  vr: [2, 20], // percent of stride length
  gtb: [30, 70], // percent of the contact time on one foot
};

/** The key under `summary.samples` that holds each metric's mean. */
const AVERAGE_KEY: Record<DynamicsMetric, string> = {
  gct: 'avgGroundContactTime',
  vo: 'avgVerticalOscillation',
  vr: 'avgVerticalRatio',
  gtb: 'avgGroundContactBalance',
};

export const DYNAMICS_METRICS: readonly DynamicsMetric[] = ['gct', 'vo', 'vr', 'gtb'];

/** A chart needs a few buckets to say anything. */
const MIN_CHART_POINTS = 3;

export interface DynamicsSeries {
  metric: DynamicsMetric;
  /** One value per bucket; null where the watch had no reading. */
  values: (number | null)[];
  /** Seconds per bucket. */
  stepSec: number;
  min: number;
  max: number;
}

export interface RunningDynamics {
  /** Means over the whole workout; null for a metric the watch did not send. */
  averages: Record<DynamicsMetric, number | null>;
  /** Charts only for the metrics with enough readings. */
  series: DynamicsSeries[];
}

function inRange(metric: DynamicsMetric, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const [lo, hi] = RANGE[metric];
  return value >= lo && value <= hi;
}

function cleanSeries(metric: DynamicsMetric, raw: unknown, stepSec: number): DynamicsSeries | null {
  if (!Array.isArray(raw)) return null;
  const values = raw.map((v): number | null => (inRange(metric, v) ? v : null));
  const present = values.filter((v): v is number => v !== null);
  if (present.length < MIN_CHART_POINTS) return null;
  return { metric, values, stepSec, min: Math.min(...present), max: Math.max(...present) };
}

function mean(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null;
}

/**
 * The running form of a watch workout, or null when the watch sent none (the card is then not drawn). Means come from
 * `samples` (the native sync computes them over every sample); a workout synced before the dynamics were kept has only the
 * contact-time mean. A metric outside its plausible range is dropped.
 */
export function runningDynamics(summary: WorkoutSummary): RunningDynamics | null {
  const averages = { gct: null, vo: null, vr: null, gtb: null } as Record<DynamicsMetric, number | null>;
  const series: DynamicsSeries[] = [];
  const json = summary.dynamics;
  const stepSec = typeof json?.stepSec === 'number' && json.stepSec > 0 ? json.stepSec : 60;
  for (const metric of DYNAMICS_METRICS) {
    const own = summary.samples?.[AVERAGE_KEY[metric]];
    const fromSeries = json ? cleanSeries(metric, json[metric], stepSec) : null;
    if (fromSeries) series.push(fromSeries);
    averages[metric] = inRange(metric, own) ? own : fromSeries ? mean(fromSeries.values) : null;
  }
  return DYNAMICS_METRICS.some((m) => averages[m] !== null) ? { averages, series } : null;
}

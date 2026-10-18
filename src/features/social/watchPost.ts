import type { RogoHrSeries, RogoRoute, RogoVisibility, RogoWatchPostInput } from '@/cloud/rogo';
import type { WorkoutPointRow, WorkoutRow } from '@/db/queries';
import type { WorkoutAnalysis, AnalysisSeries } from '@/features/workouts/analysis/types';
import { downsample, heartRateBuckets, routePoints } from '@/features/workouts/summary';
import { workoutTimes } from '@/features/workouts/times';

/** The server's limits for `social.createWatchPost` (zod in JoyoRogo's `social.ts`). */
const MAX_SPORT_NAME = 60;
const MAX_DURATION_MIN = 1440;
const MAX_HR_BUCKETS = 600;
const MAX_ROUTE_POINTS = 1000;
const MIN_BPM = 20;
const MAX_BPM = 250;

/**
 * A workout may go to the JoyoRogo feed when the watch recorded all of it and it fits the post's duration limit.
 * Imported rows (Huawei export, FIT file) never do: they come from a file whose origin the app cannot tell, and a file
 * downloaded from Strava must not be shared (Strava API Agreement). The same rows already stay out of the cloud upload.
 */
export function canShareToRogo(workout: WorkoutRow): boolean {
  return workout.complete && !workout.imported && workout.duration > 0 && workout.duration <= MAX_DURATION_MIN * 60;
}

/** A bpm the server accepts, or null for a reading outside 20 to 250. */
function validBpm(value: number): number | null {
  const bpm = Math.round(value);
  return bpm >= MIN_BPM && bpm <= MAX_BPM ? bpm : null;
}

/**
 * Heart rate as at most 600 averaged readings, one per `intervalSec` seconds from `start`. The interval is the smallest
 * whole number of seconds that fits the workout into 600 buckets, so a 10-minute workout keeps one reading per second.
 * Null when the workout has no usable heart rate.
 */
export function hrSeries(points: readonly WorkoutPointRow[], start: number, end: number): RogoHrSeries | null {
  const intervalSec = Math.max(1, Math.ceil((end - start) / MAX_HR_BUCKETS));
  const count = Math.max(1, Math.ceil((end - start) / intervalSec));
  const buckets = heartRateBuckets(points, start, start + count * intervalSec, count);
  if (!buckets) return null;
  const bpm = buckets.values.map((value) => (value === null ? null : validBpm(value)));
  return bpm.some((value) => value !== null) ? { intervalSec, bpm } : null;
}

/** The GPS track as at most 1000 `[lat, lon]` pairs; null when fewer than two valid fixes remain. */
export function routePairs(points: readonly WorkoutPointRow[]): RogoRoute | null {
  const fixes = routePoints(points).filter((p) => Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
  if (fixes.length < 2) return null;
  return downsample(fixes, MAX_ROUTE_POINTS).map((p) => [p.lat, p.lon]);
}

/** JoyoRogo rejects an analysis above 200 KB (serialized); stay under this so a rounding difference never trips it. */
export const ANALYSIS_SOFT_LIMIT_BYTES = 190_000;
const MAX_STEP_SEC = 600;
const MAX_THIN_ROUNDS = 4;
/** The server accepts an analysis whose elapsed time is within a minute of the post's `durationMin * 60`. */
const ELAPSED_TOLERANCE_SEC = 60;

export interface ShareableOptions {
  includeHr: boolean;
  includeRoute: boolean;
  includeComparison: boolean;
}

/**
 * The part of a full analysis (computed with everything on) that the author agreed to share. Pure: the input is not
 * touched. Without heart-rate data the effort and load, which are derived from it, go too. Over 190 KB serialized the
 * series is thinned until it fits (see `thinAnalysis`).
 */
export function shareableAnalysis(full: WorkoutAnalysis, options: ShareableOptions): WorkoutAnalysis {
  let out: WorkoutAnalysis = { ...full, stats: { ...full.stats } };
  if (full.series) out.series = { ...full.series };
  if (!options.includeRoute && out.series) out.series.track = null;
  if (!options.includeHr) {
    if (out.series) out.series.hr = null;
    out.hrZones = null;
    out.effort = null;
    out.load = null;
    out.stats.avgHr = null;
    out.stats.maxHr = null;
    out.stats.minHr = null;
    out.splits = full.splits.map((split) => ({ ...split, hr: null }));
    out.laps = full.laps.map((lap) => ({ ...lap, avgHr: null, maxHr: null }));
  }
  if (!options.includeComparison) {
    out.comparison = null;
  } else if (!options.includeHr && full.comparison) {
    out.comparison = { ...full.comparison, items: full.comparison.items.map((item) => ({ ...item, avgHr: null })) };
  }
  for (let round = 0; round < MAX_THIN_ROUNDS && JSON.stringify(out).length > ANALYSIS_SOFT_LIMIT_BYTES; round++) {
    out = thinAnalysis(out);
  }
  return out;
}

function every2<T>(values: T[] | null): T[] | null {
  return values ? values.filter((_, i) => i % 2 === 0) : null;
}

/**
 * A coarser copy: every second sample of the shared grid (the step doubles, up to the server's 600 s) and GPS rounded to
 * 4 decimals (about 11 m). Splits, laps, zones and the rest stay as they are. A series that cannot be halved further is
 * only rounded.
 */
export function thinAnalysis(analysis: WorkoutAnalysis): WorkoutAnalysis {
  const series = analysis.series;
  if (!series) return analysis;
  const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const track = series.track ? series.track.map((p) => (p ? ([round4(p[0]), round4(p[1])] as [number, number]) : null)) : null;
  const halve = series.n >= 4 && series.stepSec * 2 <= MAX_STEP_SEC;
  const next: AnalysisSeries = halve
    ? {
        stepSec: series.stepSec * 2,
        n: Math.ceil(series.n / 2),
        dist: every2(series.dist),
        hr: every2(series.hr),
        pace: every2(series.pace),
        alt: every2(series.alt),
        cad: every2(series.cad),
        power: every2(series.power),
        track: every2(track),
      }
    : { ...series, track };
  return { ...analysis, series: next };
}

export interface WatchPostOptions {
  caption: string;
  visibility: RogoVisibility;
  includeHr: boolean;
  includeRoute: boolean;
  includeComparison: boolean;
}

/**
 * `social.createWatchPost` input from a local workout row and its points. Seconds on the watch side, minutes and
 * milliseconds on the server's. With `analysis` (the full result of `analyzeWorkout`) the detail is the shareable part of
 * it alone; without, the legacy heart-rate series and route. `includeRoute` is the post's "Tampilkan peta" switch: the
 * route goes along only while it is on, and `showMap` carries it so JoyoRogo shows the feed map (it trims 200 m off both
 * ends and simplifies the line itself) from the start.
 */
export function buildWatchPost(
  workout: WorkoutRow,
  points: readonly WorkoutPointRow[],
  options: WatchPostOptions,
  analysis: WorkoutAnalysis | null = null,
): RogoWatchPostInput {
  const caption = options.caption.trim();
  let durationMin = Math.max(1, Math.round(workoutTimes(workout).movingSec / 60));
  let shared: WorkoutAnalysis | null = null;
  if (analysis) {
    shared = shareableAnalysis(analysis, options);
    if (Math.abs(shared.elapsedSec - durationMin * 60) > ELAPSED_TOLERANCE_SEC) {
      durationMin = Math.min(MAX_DURATION_MIN, Math.max(1, Math.round(shared.elapsedSec / 60)));
    }
    if (shared.startedAt !== workout.start * 1000 || Math.abs(shared.elapsedSec - durationMin * 60) > ELAPSED_TOLERANCE_SEC) {
      shared = null;
    }
  }
  let detail: RogoWatchPostInput['detail'];
  if (shared) {
    detail = { analysis: shared };
  } else {
    const hr = options.includeHr ? hrSeries(points, workout.start, workout.end) : null;
    const route = options.includeRoute ? routePairs(points) : null;
    if (hr || route) detail = { hr, route };
  }
  return {
    workout: {
      sportName: workout.sportName.slice(0, MAX_SPORT_NAME),
      startedAt: workout.start * 1000,
      durationMin,
      kcal: workout.calories > 0 ? Math.round(workout.calories) : null,
      distanceM: workout.distance > 0 ? Math.round(workout.distance) : null,
      avgHr: workout.avgHr !== null ? validBpm(workout.avgHr) : null,
      maxHr: workout.maxHr !== null ? validBpm(workout.maxHr) : null,
    },
    ...(detail ? { detail } : {}),
    ...(caption ? { caption } : {}),
    visibility: options.visibility,
    showMap: options.includeRoute,
  };
}

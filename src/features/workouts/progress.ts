import { sportKind } from './analysis/sport';
import type { SportKind } from './analysis/types';
import { movingOf, elapsedOfWorkout } from './times';

/** The sports that get a progress card: the kinds with a distance. */
export type ProgressKind = Exclude<SportKind, 'other'>;
export const PROGRESS_KINDS: readonly ProgressKind[] = ['run', 'walk', 'ride', 'swim'];

export type ProgressPeriod = 'week' | 'month';

/** Bars on the chart: the last 12 weeks, or the last 12 months. */
export const PROGRESS_BUCKETS = 12;

/** What the card needs from one `workouts` row. `gain` is the summary's elevation gain in metres, null when it has none. */
export interface ProgressRow {
  /** Unix seconds. */
  start: number;
  end: number;
  sportName: string;
  /** Active seconds. */
  duration: number;
  /** Metres. */
  distance: number;
  gain: number | null;
}

export interface ProgressBucket {
  /** Local midnight (unix seconds) that opens the bucket, and the one that opens the next. */
  start: number;
  end: number;
  distance: number;
  movingSec: number;
  gain: number;
  count: number;
}

export interface Progress {
  /** Oldest first; the last one is the running week or month. */
  buckets: ProgressBucket[];
  current: ProgressBucket;
  previous: ProgressBucket;
}

/**
 * Local midnights that open the last `count` weeks (Monday) or months, oldest first, plus one more: the start of the period after
 * the current one, so bucket `i` spans `starts[i]` up to `starts[i + 1]`. Built from calendar fields, so a daylight-saving change
 * moves no boundary off midnight.
 */
export function periodStarts(period: ProgressPeriod, nowSec: number, count = PROGRESS_BUCKETS): number[] {
  const now = new Date(nowSec * 1000);
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const sinceMonday = (now.getDay() + 6) % 7;
  const starts: number[] = [];
  for (let i = count - 1; i >= -1; i--) {
    const at = period === 'week' ? new Date(y, m, d - sinceMonday - 7 * i) : new Date(y, m - i, 1);
    starts.push(Math.floor(at.getTime() / 1000));
  }
  return starts;
}

/** Where the oldest bar starts: rows from before it are not needed. One query for both periods reads from the earlier of the two. */
export function progressSinceSec(nowSec: number): number {
  return Math.min(periodStarts('week', nowSec)[0]!, periodStarts('month', nowSec)[0]!);
}

/** Workouts of one kind summed per bucket. A row counts in the bucket its start falls in (local time). */
export function aggregateProgress(rows: readonly ProgressRow[], kind: ProgressKind, period: ProgressPeriod, nowSec: number): Progress {
  const starts = periodStarts(period, nowSec);
  const buckets: ProgressBucket[] = [];
  for (let i = 0; i < PROGRESS_BUCKETS; i++) {
    buckets.push({ start: starts[i]!, end: starts[i + 1]!, distance: 0, movingSec: 0, gain: 0, count: 0 });
  }
  for (const row of rows) {
    if (sportKind(row.sportName) !== kind) continue;
    const bucket = buckets.find((b) => row.start >= b.start && row.start < b.end);
    if (!bucket) continue;
    bucket.distance += Math.max(0, row.distance);
    bucket.movingSec += movingOf(elapsedOfWorkout(row), row.duration);
    bucket.gain += Math.max(0, row.gain ?? 0);
    bucket.count += 1;
  }
  return { buckets, current: buckets[PROGRESS_BUCKETS - 1]!, previous: buckets[PROGRESS_BUCKETS - 2]! };
}

/** True when no bucket has a workout: the sport exists in the list but not within the chart's range. */
export function progressIsEmpty(progress: Progress): boolean {
  return progress.buckets.every((b) => b.count === 0);
}

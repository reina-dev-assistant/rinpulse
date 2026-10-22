import { mondayOf } from '@/features/fitness/intensityMinutes';
import { addDays } from '@/features/trends/series';

/**
 * The time axis of the shared metric-detail template: Day, Week, Month, 3 months, Year. Pure calendar arithmetic on local midnights
 * (unix seconds), so every metric screen steps through time the same way and the rules are tested once.
 *
 * - `D` one day, in hours.
 * - `W` the Monday-to-Sunday week, in days.
 * - `M` the calendar month, in days.
 * - `3M` thirteen Monday-to-Sunday weeks ending with the week of the anchor day, in weeks.
 * - `Y` the calendar year, in months.
 *
 * A period may run past today (this week, this month): its later buckets are `future` and carry no value.
 */
export const METRIC_RANGES = ['D', 'W', 'M', '3M', 'Y'] as const;
export type MetricRange = (typeof METRIC_RANGES)[number];

export interface Period {
  range: MetricRange;
  /** Local midnight of the first day. */
  from: number;
  /** Local midnight after the last day. */
  to: number;
  /** The day the period was built around. */
  anchor: number;
}

export interface Bucket {
  /** Start, unix seconds: an hour, a local midnight, a Monday or the first of a month. */
  from: number;
  /** End, exclusive. */
  to: number;
}

const WEEKS_IN_3M = 13;

/** Local midnight of the first day of the month that contains `day`, shifted by `months`. */
export function monthStart(day: number, months = 0): number {
  const d = new Date((day + 12 * 3600) * 1000);
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** Local midnight of 1 January of the year of `day`, shifted by `years`. */
export function yearStart(day: number, years = 0): number {
  const d = new Date((day + 12 * 3600) * 1000);
  d.setMonth(0, 1);
  d.setFullYear(d.getFullYear() + years);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** The period of `range` that contains the local day `anchor`. */
export function periodFor(range: MetricRange, anchor: number): Period {
  switch (range) {
    case 'D':
      return { range, from: anchor, to: addDays(anchor, 1), anchor };
    case 'W': {
      const from = mondayOf(anchor);
      return { range, from, to: addDays(from, 7), anchor };
    }
    case 'M': {
      const from = monthStart(anchor);
      return { range, from, to: monthStart(anchor, 1), anchor };
    }
    case '3M': {
      const week = mondayOf(anchor);
      return { range, from: addDays(week, -7 * (WEEKS_IN_3M - 1)), to: addDays(week, 7), anchor };
    }
    case 'Y': {
      const from = yearStart(anchor);
      return { range, from, to: yearStart(anchor, 1), anchor };
    }
  }
}

/** The anchor one step before (`delta` -1) or after (+1) the period, so the new period abuts it. */
export function shiftAnchor(period: Period, delta: -1 | 1): number {
  switch (period.range) {
    case 'D':
      return addDays(period.anchor, delta);
    case 'W':
      return addDays(period.from, 7 * delta);
    case 'M':
      return monthStart(period.from, delta);
    case '3M':
      return addDays(period.from, 7 * WEEKS_IN_3M * delta + 7 * (WEEKS_IN_3M - 1));
    case 'Y':
      return yearStart(period.from, delta);
  }
}

/** The period holds today: there is nothing later to step to, and "back to today" has no work to do. */
export function holdsToday(period: Period, todayStart: number): boolean {
  return todayStart >= period.from && todayStart < period.to;
}

/** Stepping forward is possible: the period ends before today. */
export function canStepForward(period: Period, todayStart: number): boolean {
  return period.to <= todayStart;
}

/** The anchor to open a range with when the person switches range: stay on the day in view, but never past today. */
export function anchorFor(period: Period, todayStart: number): number {
  return Math.min(period.anchor, todayStart);
}

/** The period's slots in order: 24 hours (`D`), days (`W`, `M`), weeks (`3M`) or months (`Y`). */
export function bucketsOf(period: Period): Bucket[] {
  const out: Bucket[] = [];
  switch (period.range) {
    case 'D':
      // Hours are walked on the clock so a 23- or 25-hour daylight-saving day still has 24 slots labelled 0..23.
      for (let h = 0; h < 24; h++) {
        const from = period.from + h * 3600;
        out.push({ from, to: from + 3600 });
      }
      return out;
    case 'W':
    case 'M':
      for (let day = period.from; day < period.to; day = addDays(day, 1)) out.push({ from: day, to: addDays(day, 1) });
      return out;
    case '3M':
      for (let week = period.from; week < period.to; week = addDays(week, 7)) out.push({ from: week, to: addDays(week, 7) });
      return out;
    case 'Y':
      for (let month = period.from; month < period.to; month = monthStart(month, 1)) out.push({ from: month, to: monthStart(month, 1) });
      return out;
  }
}

/** The local midnights of every day of the period, oldest first (the bounds a per-day SQL aggregate needs). */
export function daysOf(period: Period): number[] {
  const out: number[] = [];
  for (let day = period.from; day < period.to; day = addDays(day, 1)) out.push(day);
  return out;
}

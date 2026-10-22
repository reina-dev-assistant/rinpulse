import { bucketsOf, type Period } from '@/features/metric/range';

/**
 * Steps of one period as bars, one per slot of the period (`bucketsOf`). A slot's value is what the bar draws:
 * the steps of the hour (`D`) or of the day (`W`, `M`), and for the slots that hold several days (`3M` weeks, `Y` months) the average
 * steps of the days that have stored steps, so every bar from `W` up reads against the same daily goal.
 *
 * Days without a single stored minute are "no data", not zero steps: they count for nothing in an average and no bar is drawn for them.
 */
export interface StepBar {
  from: number;
  to: number;
  /** What the bar draws (see above). */
  value: number;
  /** Steps stored in the slot. */
  total: number;
  /** Days of the slot with stored steps (0 for an hour slot). */
  days: number;
  /** The slot lies after today: nothing can be stored there yet. */
  future: boolean;
  /** A day (or the average of a week or month) that reached the daily goal; never set on hours. */
  hit: boolean;
}

export interface StepsInput {
  period: Period;
  /** Steps per local day (`listDailySteps`); used by every range but `D`. */
  daily: ReadonlyMap<number, number>;
  /** Steps per local clock hour, index 0..23 (`hourlySteps`); used by `D`. */
  hourly: readonly number[] | null;
  goal: number;
  /** Local midnight of today, and now: what lies after them is `future`. */
  todayStart: number;
  nowSec: number;
}

export function stepBars({ period, daily, hourly, goal, todayStart, nowSec }: StepsInput): StepBar[] {
  const buckets = bucketsOf(period);
  if (period.range === 'D') {
    return buckets.map((b, h) => {
      const value = hourly?.[h] ?? 0;
      return { from: b.from, to: b.to, value, total: value, days: 0, future: b.from > nowSec, hit: false };
    });
  }
  const days = [...daily.keys()].sort((a, b) => a - b);
  return buckets.map((b) => {
    let total = 0;
    let count = 0;
    for (const day of days) {
      if (day < b.from || day >= b.to) continue;
      total += daily.get(day) ?? 0;
      count += 1;
    }
    const single = period.range === 'W' || period.range === 'M';
    const value = single ? total : count > 0 ? total / count : 0;
    return { from: b.from, to: b.to, value, total, days: count, future: b.from > todayStart, hit: count > 0 && value >= goal };
  });
}

export interface StepsSummary {
  /** The figure the screen leads with: the day's total on `D`, the average per day with data otherwise; null when nothing is stored. */
  headline: number | null;
  /** Days with stored steps in the period (0 on `D`). */
  days: number;
  /** Days that reached the goal (0 on `D`). */
  daysAtGoal: number;
  total: number;
}

export function summarizeSteps(range: Period['range'], bars: readonly StepBar[], daily: ReadonlyMap<number, number>, period: Period, goal: number): StepsSummary {
  if (range === 'D') {
    const total = bars.reduce((a, b) => a + b.total, 0);
    return { headline: total > 0 ? total : null, days: 0, daysAtGoal: 0, total };
  }
  let total = 0;
  let days = 0;
  let daysAtGoal = 0;
  for (const [day, steps] of daily) {
    if (day < period.from || day >= period.to) continue;
    total += steps;
    days += 1;
    if (steps >= goal) daysAtGoal += 1;
  }
  return { headline: days > 0 ? total / days : null, days, daysAtGoal, total };
}

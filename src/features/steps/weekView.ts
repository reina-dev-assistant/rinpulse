/**
 * Numbers of the Today steps card, apart from the screen so they can be tested: the seven day values, their total and what is left of
 * today's goal. A value that is not a usable count (NaN, negative, Infinity) is a day without steps. No React: unit tested with `bun test`.
 */

/** A count of steps: whole, not negative, finite; anything else is 0. */
export function stepCount(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export interface WeekSteps {
  /** One per day, oldest first. */
  values: number[];
  total: number;
  /** The last day's, which is today. */
  today: number;
}

/**
 * The days' steps as the card draws them. Today's bar is the larger of what is stored and the ring's own count (the watch's counter
 * runs ahead of the stored minutes), so the bar and the ring on Today always agree.
 */
export function weekSteps(days: readonly number[], daily: ReadonlyMap<number, number>, dayStart: number, todaySteps: number): WeekSteps {
  const values = days.map((day) => {
    const stored = stepCount(daily.get(day));
    return day === dayStart ? Math.max(stored, stepCount(todaySteps)) : stored;
  });
  return { values, total: values.reduce((a, b) => a + b, 0), today: values[values.length - 1] ?? 0 };
}

/** Steps still to take today; 0 once the goal is reached, and 0 for a goal that is not a usable number (nothing to be left of). */
export function stepsLeft(goal: number, today: number): number {
  if (!Number.isFinite(goal) || goal <= 0) return 0;
  return Math.max(0, Math.round(goal) - stepCount(today));
}

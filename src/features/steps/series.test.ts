import { describe, expect, it } from 'bun:test';

import { periodFor } from '@/features/metric/range';
import { addDays } from '@/features/trends/series';

import { stepBars, summarizeSteps } from './series';

const local = (y: number, m: number, d: number) => Math.floor(new Date(y, m - 1, d).getTime() / 1000);
const TODAY = local(2026, 10, 22); // Thursday
const NOW = TODAY + 15 * 3600;
const GOAL = 8000;

const week = periodFor('W', TODAY);
const daily = new Map<number, number>([
  [local(2026, 10, 19), 9000],
  [local(2026, 10, 20), 4000],
  [local(2026, 10, 22), 8000],
]);

describe('stepBars', () => {
  it('draws a day per bar on a week, marks goal days, leaves days without data empty and later days as future', () => {
    const bars = stepBars({ period: week, daily, hourly: null, goal: GOAL, todayStart: TODAY, nowSec: NOW });
    expect(bars.map((b) => b.value)).toEqual([9000, 4000, 0, 8000, 0, 0, 0]);
    expect(bars.map((b) => b.hit)).toEqual([true, false, false, true, false, false, false]);
    expect(bars.map((b) => b.future)).toEqual([false, false, false, false, true, true, true]);
    expect(bars[2].days).toBe(0);
  });

  it('averages the days with data for the slots of a three-month view, never counting a missing day as zero', () => {
    const p = periodFor('3M', TODAY);
    const bars = stepBars({ period: p, daily, hourly: null, goal: GOAL, todayStart: TODAY, nowSec: NOW });
    const last = bars[bars.length - 1];
    expect(last.total).toBe(21000);
    expect(last.days).toBe(3);
    expect(last.value).toBe(7000);
    expect(last.hit).toBe(false);
    expect(bars[0].value).toBe(0);
  });

  it('averages per month on a year and marks a month whose average reached the goal', () => {
    const p = periodFor('Y', TODAY);
    const days = new Map([[local(2026, 3, 3), 10000], [local(2026, 3, 4), 8000]]);
    const bars = stepBars({ period: p, daily: days, hourly: null, goal: GOAL, todayStart: TODAY, nowSec: NOW });
    expect(bars[2]).toMatchObject({ value: 9000, days: 2, hit: true });
    expect(bars[11].future).toBe(true);
  });

  it('uses the hours on a day and marks the hours still to come', () => {
    const hourly = new Array<number>(24).fill(0);
    hourly[8] = 1200;
    const bars = stepBars({ period: periodFor('D', TODAY), daily: new Map(), hourly, goal: GOAL, todayStart: TODAY, nowSec: NOW });
    expect(bars).toHaveLength(24);
    expect(bars[8].value).toBe(1200);
    expect(bars[14].future).toBe(false);
    expect(bars[16].future).toBe(true);
  });

  it('a past day has no future hours', () => {
    const y = addDays(TODAY, -1);
    const bars = stepBars({ period: periodFor('D', y), daily: new Map(), hourly: null, goal: GOAL, todayStart: TODAY, nowSec: NOW });
    expect(bars.some((b) => b.future)).toBe(false);
  });
});

describe('summarizeSteps', () => {
  it('leads with the average per day with data and counts the goal days', () => {
    const bars = stepBars({ period: week, daily, hourly: null, goal: GOAL, todayStart: TODAY, nowSec: NOW });
    const s = summarizeSteps('W', bars, daily, week, GOAL);
    expect(s).toEqual({ headline: 7000, days: 3, daysAtGoal: 2, total: 21000 });
  });

  it('has no headline when nothing is stored', () => {
    const none = new Map<number, number>();
    const bars = stepBars({ period: week, daily: none, hourly: null, goal: GOAL, todayStart: TODAY, nowSec: NOW });
    expect(summarizeSteps('W', bars, none, week, GOAL).headline).toBeNull();
  });

  it('leads with the total on a day', () => {
    const d = periodFor('D', TODAY);
    const hourly = new Array<number>(24).fill(0);
    hourly[7] = 500;
    hourly[9] = 700;
    const bars = stepBars({ period: d, daily: new Map(), hourly, goal: GOAL, todayStart: TODAY, nowSec: NOW });
    expect(summarizeSteps('D', bars, new Map(), d, GOAL).headline).toBe(1200);
  });
});

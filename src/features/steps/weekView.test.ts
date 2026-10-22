import { describe, expect, test } from 'bun:test';

import { stepCount, stepsLeft, weekSteps } from './weekView';

const DAY = 86_400;
const days = Array.from({ length: 7 }, (_, i) => 1_000_000 + i * DAY);
const today = days[6]!;

describe('stepCount', () => {
  test('whole counts pass, everything else is 0', () => {
    expect(stepCount(7825)).toBe(7825);
    expect(stepCount(100_000)).toBe(100_000);
    expect(stepCount(12.6)).toBe(13);
    for (const bad of [undefined, NaN, Infinity, -Infinity, -5, 0]) expect(stepCount(bad)).toBe(0);
  });
});

describe('weekSteps', () => {
  test('values oldest first, their total, and today the last', () => {
    const daily = new Map(days.map((d, i) => [d, 1000 * (i + 1)]));
    const week = weekSteps(days, daily, today, 0);
    expect(week.values).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000]);
    expect(week.total).toBe(28_000);
    expect(week.today).toBe(7000);
  });
  test("today's bar is the ring's count when the watch counted more than the stored minutes", () => {
    const daily = new Map([[today, 6000]]);
    expect(weekSteps(days, daily, today, 7825).today).toBe(7825);
    expect(weekSteps(days, daily, today, 100).today).toBe(6000);
  });
  test('one huge day keeps its own value and the total adds up (no clamp, no overflow)', () => {
    const daily = new Map([[days[2]!, 100_000], [days[3]!, 99_999], [today, 30_000]]);
    const week = weekSteps(days, daily, today, 30_000);
    expect(week.values[2]).toBe(100_000);
    expect(week.total).toBe(229_999);
  });
  test('a day with no stored steps, or a NaN, is 0 and does not poison the total', () => {
    const daily = new Map([[days[0]!, NaN], [days[1]!, 5000]]);
    const week = weekSteps(days, daily, today, NaN);
    expect(week.values.every(Number.isFinite)).toBe(true);
    expect(week.total).toBe(5000);
    expect(week.today).toBe(0);
  });
  test('no days at all', () => {
    expect(weekSteps([], new Map(), today, 100)).toEqual({ values: [], total: 0, today: 0 });
  });
});

describe('stepsLeft', () => {
  test('7,825 of 8,000 leaves 175; 0 steps leaves the whole goal', () => {
    expect(stepsLeft(8000, 7825)).toBe(175);
    expect(stepsLeft(8000, 0)).toBe(8000);
  });
  test('at or over the goal leaves nothing, however far over', () => {
    expect(stepsLeft(8000, 8000)).toBe(0);
    expect(stepsLeft(8000, 30_000)).toBe(0);
    expect(stepsLeft(8000, 100_000)).toBe(0);
  });
  test('a goal of 100,000 with 99,999 done leaves 1', () => {
    expect(stepsLeft(100_000, 99_999)).toBe(1);
  });
  test('a goal that is 0, NaN or Infinity leaves nothing, not NaN', () => {
    for (const goal of [0, NaN, Infinity, -1]) expect(stepsLeft(goal, 5000)).toBe(0);
    expect(stepsLeft(8000, NaN)).toBe(8000);
  });
});

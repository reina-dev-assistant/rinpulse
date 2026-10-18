import { describe, expect, it } from 'bun:test';

import { localDay } from './calc';
import {
  consistency,
  dayCounts,
  groupByMonth,
  mergeByDay,
  monthGrid,
  monthKey,
  prCounts,
  shiftMonth,
  weekStarts,
  weekStreak,
  weekTotals,
  weeklyCounts,
  type WatchRow,
} from './historyModel';
import type { StrengthExercise, StrengthSet, StrengthWorkout } from './types';

let n = 0;
const set = (weightKg: number | null, reps: number | null, over: Partial<StrengthSet> = {}): StrengthSet => ({
  id: `s${n++}`,
  type: 'normal',
  weightKg,
  reps,
  seconds: null,
  rpe: null,
  done: true,
  doneAt: 1,
  ...over,
});
const exercise = (exerciseId: string, sets: StrengthSet[]): StrengthExercise => ({ key: `k${n++}`, exerciseId, note: '', restSec: null, supersetGroup: null, sets });
const workout = (startedAt: number, exercises: StrengthExercise[] = [], over: Partial<StrengthWorkout> = {}): StrengthWorkout => ({
  id: `w${n++}`,
  name: 'x',
  startedAt,
  endedAt: startedAt + 3600_000,
  durationSec: 3600,
  note: '',
  routineId: null,
  planKey: null,
  exercises,
  workoutStart: null,
  kcal: null,
  kcalSource: null,
  updatedAt: startedAt,
  deletedAt: null,
  ...over,
});
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const watch = (start: number, over: Partial<WatchRow> = {}): WatchRow => ({ id: start, start, end: start + 3600, sportName: 'Running', duration: 3600, calories: 400, ...over });

describe('groupByMonth', () => {
  it('groups consecutive workouts of one month, newest first, across a year boundary', () => {
    const list = [workout(at(2026, 1, 3)), workout(at(2026, 1, 1)), workout(at(2025, 12, 31)), workout(at(2025, 11, 2))];
    const groups = groupByMonth(list);
    expect(groups.map((g) => [g.key, g.workouts.length])).toEqual([['2026-01', 2], ['2025-12', 1], ['2025-11', 1]]);
    expect(groups[0]!.at).toBe(list[0]!.startedAt);
  });

  it('is empty for no workouts', () => {
    expect(groupByMonth([])).toEqual([]);
    expect(monthKey(at(2026, 3, 31, 23))).toBe('2026-03');
  });
});

describe('mergeByDay', () => {
  it('merges watch and strength workouts by local day, ordered by time', () => {
    const lift = workout(at(2026, 5, 10, 18));
    const run = watch(Math.floor(at(2026, 5, 10, 7) / 1000));
    const other = watch(Math.floor(at(2026, 5, 11, 7) / 1000));
    const days = mergeByDay([lift], [other, run]);
    expect([...days.keys()].sort()).toEqual(['2026-05-10', '2026-05-11']);
    expect(days.get('2026-05-10')!.map((i) => i.kind)).toEqual(['watch', 'strength']);
    expect(dayCounts(days.get('2026-05-10'))).toEqual({ strength: 1, other: 1 });
    expect(dayCounts(undefined)).toEqual({ strength: 0, other: 0 });
  });

  it('shows the merged twin of a strength workout once, as the strength item', () => {
    const start = Math.floor(at(2026, 5, 10, 18) / 1000);
    const lift = workout(start * 1000, [], { workoutStart: start });
    const days = mergeByDay([lift], [watch(start)]);
    expect(days.get('2026-05-10')!.map((i) => i.kind)).toEqual(['strength']);
  });

  it('keeps imported history without a workouts row and skips deleted workouts', () => {
    const imported = workout(at(2026, 2, 1), [], { id: 'rogo:5', workoutStart: null });
    const gone = workout(at(2026, 2, 2), [], { deletedAt: 1 });
    const days = mergeByDay([imported, gone], []);
    expect([...days.keys()]).toEqual(['2026-02-01']);
  });

  it('puts a late-evening workout on its device-time day', () => {
    const late = workout(new Date(2026, 4, 10, 23, 50).getTime());
    expect(localDay(late.startedAt)).toBe('2026-05-10');
    expect([...mergeByDay([late], []).keys()]).toEqual(['2026-05-10']);
  });
});

describe('monthGrid', () => {
  it('starts on Monday and pads with the neighbouring months', () => {
    // 1 Oct 2026 is a Thursday: three leading days, 31 days, 28 cells = 4 weeks + 3 = 5 rows.
    const grid = monthGrid({ year: 2026, month: 9 });
    expect(grid.length).toBe(5);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid[0]![0]).toEqual({ day: '2026-09-28', date: 28, inMonth: false });
    expect(grid[0]![3]).toEqual({ day: '2026-10-01', date: 1, inMonth: true });
    expect(grid[4]![6]).toEqual({ day: '2026-11-01', date: 1, inMonth: false });
  });

  it('fits a month that starts on Monday and has 28 days in four rows', () => {
    // February 2027 starts on a Monday.
    const grid = monthGrid({ year: 2027, month: 1 });
    expect(grid.length).toBe(4);
    expect(grid.flat().every((d) => d.inMonth)).toBe(true);
  });

  it('needs six rows when a 31-day month starts on Saturday or Sunday', () => {
    // 1 Aug 2026 is a Saturday.
    expect(monthGrid({ year: 2026, month: 7 }).length).toBe(6);
  });

  it('shifts months across years', () => {
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2026, month: 5 }, -18)).toEqual({ year: 2024, month: 11 });
  });
});

describe('weeks', () => {
  const now = at(2026, 10, 14); // a Wednesday
  const lift = (d: number, m = 10) => workout(at(2026, m, d), [exercise('a', [set(100, 5), set(60, 10, { type: 'warmup' })])]);

  it('totals the Monday to Sunday week of now', () => {
    const totals = weekTotals([lift(12), lift(14), lift(11)], now);
    expect(totals).toEqual({ workouts: 2, volume: 1000, sets: 2 });
  });

  it('lists the last Mondays', () => {
    expect(weekStarts(now, 3)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
  });

  it('counts workouts per week', () => {
    const counts = weeklyCounts([lift(12), lift(14), lift(6)], now, 3);
    expect(counts.map((c) => c.workouts)).toEqual([0, 1, 2]);
  });

  it('counts a streak of weeks and forgives an empty current week', () => {
    expect(weekStreak([lift(12), lift(6), lift(1)], now)).toBe(3);
    expect(weekStreak([lift(6), lift(1)], now)).toBe(2);
    expect(weekStreak([lift(1)], now)).toBe(0);
    expect(weekStreak([], now)).toBe(0);
  });

  it('measures consistency over the last weeks', () => {
    const c = consistency([lift(12), lift(14), lift(6)], now, 4);
    expect(c.activeWeeks).toBe(2);
    expect(c.weeks).toBe(4);
    expect(c.perWeek).toBe(0.75);
  });
});

describe('prCounts', () => {
  it('counts the records a workout set against everything earlier, none for the first', () => {
    const w1 = workout(at(2026, 1, 1), [exercise('bench', [set(60, 8)])]);
    const w2 = workout(at(2026, 1, 8), [exercise('bench', [set(70, 8)])]);
    const w3 = workout(at(2026, 1, 15), [exercise('bench', [set(50, 8)])]);
    const counts = prCounts([w3, w1, w2]);
    expect(counts.has(w1.id)).toBe(false);
    expect(counts.get(w2.id)).toBeGreaterThanOrEqual(3); // weight, 1RM and set volume
    expect(counts.has(w3.id)).toBe(false);
  });

  it('ignores warm-up sets and deleted workouts', () => {
    const w1 = workout(at(2026, 1, 1), [exercise('bench', [set(60, 8)])]);
    const w2 = workout(at(2026, 1, 8), [exercise('bench', [set(100, 8, { type: 'warmup' })])]);
    const w3 = workout(at(2026, 1, 9), [exercise('bench', [set(200, 8)])], { deletedAt: 5 });
    expect(prCounts([w1, w2, w3]).size).toBe(0);
  });
});

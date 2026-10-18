/**
 * The pure side of the history screens (`history.ts` holds the hook): grouping by month, merging strength and watch workouts per
 * calendar day, the month grid, weekly totals, streaks and the PR count of every workout. No React Native, no i18n.
 *
 * Days are device-time-zone days (`localDay`); weeks start on Monday (`weekKey`).
 */
import { addToBests, emptyBests, findPersonalRecords, localDay, weekKey, workoutTotals, type ExerciseBests } from './calc';
import type { StrengthWorkout } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Month groups
// ---------------------------------------------------------------------------------------------------------------------

export interface MonthGroup {
  /** `YYYY-MM`, device time zone. */
  key: string;
  /** Epoch ms of the first workout of the group, for formatting the heading. */
  at: number;
  workouts: StrengthWorkout[];
}

/** `YYYY-MM` of `ms` in the device's time zone. */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Consecutive workouts of the same month under one group; keeps the order given (newest first from `useStrengthHistory`). */
export function groupByMonth(workouts: readonly StrengthWorkout[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const workout of workouts) {
    const key = monthKey(workout.startedAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.workouts.push(workout);
    else groups.push({ key, at: workout.startedAt, workouts: [workout] });
  }
  return groups;
}

// ---------------------------------------------------------------------------------------------------------------------
// Days: strength and watch workouts merged
// ---------------------------------------------------------------------------------------------------------------------

/** The part of a `workouts` row the calendar needs. `start` and `end` are unix seconds. */
export interface WatchRow {
  id: number;
  start: number;
  end: number;
  sportName: string;
  duration: number;
  calories: number;
}

export type DayItem =
  | { kind: 'strength'; at: number; workout: StrengthWorkout }
  | { kind: 'watch'; at: number; row: WatchRow };

/**
 * Every workout of the person by calendar day, oldest first inside a day. A watch row that is the stored form of a strength workout
 * (a strength workout's `workoutStart` equals the row's `start`: its own row or the watch row it merged with) is left out: that
 * workout appears once, as the strength item.
 */
export function mergeByDay(strength: readonly StrengthWorkout[], watch: readonly WatchRow[]): Map<string, DayItem[]> {
  const days = new Map<string, DayItem[]>();
  const add = (item: DayItem) => {
    const key = localDay(item.at);
    const list = days.get(key);
    if (list) list.push(item);
    else days.set(key, [item]);
  };
  const twins = new Set<number>();
  for (const workout of strength) {
    if (workout.deletedAt !== null) continue;
    if (workout.workoutStart !== null) twins.add(workout.workoutStart);
    add({ kind: 'strength', at: workout.startedAt, workout });
  }
  for (const row of watch) {
    if (twins.has(row.start)) continue;
    add({ kind: 'watch', at: row.start * 1000, row });
  }
  for (const list of days.values()) list.sort((a, b) => a.at - b.at);
  return days;
}

export interface DayCounts {
  strength: number;
  other: number;
}

export function dayCounts(items: readonly DayItem[] | undefined): DayCounts {
  const counts: DayCounts = { strength: 0, other: 0 };
  for (const item of items ?? []) counts[item.kind === 'strength' ? 'strength' : 'other'] += 1;
  return counts;
}

// ---------------------------------------------------------------------------------------------------------------------
// Month grid
// ---------------------------------------------------------------------------------------------------------------------

export interface MonthRef {
  year: number;
  /** 0 to 11. */
  month: number;
}

export interface GridDay {
  /** `YYYY-MM-DD`. */
  day: string;
  /** 1 to 31. */
  date: number;
  inMonth: boolean;
}

export const monthOf = (ms: number): MonthRef => {
  const d = new Date(ms);
  return { year: d.getFullYear(), month: d.getMonth() };
};

export function shiftMonth(ref: MonthRef, delta: number): MonthRef {
  const index = ref.year * 12 + ref.month + delta;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
}

export const sameMonth = (a: MonthRef, b: MonthRef): boolean => a.year === b.year && a.month === b.month;

/** The weeks (Monday first) that cover the month: 4 to 6 rows of 7 days, the days around the month marked `inMonth: false`. */
export function monthGrid(ref: MonthRef): GridDay[][] {
  const first = new Date(ref.year, ref.month, 1);
  const lead = (first.getDay() + 6) % 7;
  const length = new Date(ref.year, ref.month + 1, 0).getDate();
  const rows = Math.ceil((lead + length) / 7);
  const grid: GridDay[][] = [];
  for (let r = 0; r < rows; r++) {
    const week: GridDay[] = [];
    for (let c = 0; c < 7; c++) {
      // Built from year, month and day, so a daylight-saving change never repeats or skips a day.
      const d = new Date(ref.year, ref.month, 1 - lead + r * 7 + c);
      week.push({ day: localDay(d.getTime()), date: d.getDate(), inMonth: d.getMonth() === ref.month });
    }
    grid.push(week);
  }
  return grid;
}

// ---------------------------------------------------------------------------------------------------------------------
// Weeks: totals, streak, consistency
// ---------------------------------------------------------------------------------------------------------------------

export interface PeriodTotals {
  workouts: number;
  /** kg of counted sets. */
  volume: number;
  sets: number;
}

/** Totals of the week (Monday to Sunday) that holds `now`. */
export function weekTotals(workouts: readonly StrengthWorkout[], now: number): PeriodTotals {
  const key = weekKey(now);
  const totals: PeriodTotals = { workouts: 0, volume: 0, sets: 0 };
  for (const workout of workouts) {
    if (workout.deletedAt !== null || weekKey(workout.startedAt) !== key) continue;
    const t = workoutTotals(workout);
    totals.workouts += 1;
    totals.volume += t.volume;
    totals.sets += t.sets;
  }
  return totals;
}

/** The Mondays (`YYYY-MM-DD`) of the last `weeks` weeks ending with the one that holds `now`, oldest first. */
export function weekStarts(now: number, weeks: number): string[] {
  const monday = new Date(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 7 * (weeks - 1));
  const keys: string[] = [];
  for (let i = 0; i < weeks; i++) {
    keys.push(localDay(monday.getTime()));
    monday.setDate(monday.getDate() + 7);
  }
  return keys;
}

/** Workouts per week for the last `weeks` weeks, oldest first. */
export function weeklyCounts(workouts: readonly StrengthWorkout[], now: number, weeks: number): { week: string; workouts: number }[] {
  const counts = new Map(weekStarts(now, weeks).map((week) => [week, 0]));
  for (const workout of workouts) {
    if (workout.deletedAt !== null) continue;
    const key = weekKey(workout.startedAt);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([week, n]) => ({ week, workouts: n }));
}

/**
 * Consecutive weeks with at least one workout, counted back from this week; a week that is not over yet and still empty does not
 * break a streak that reaches up to last week.
 */
export function weekStreak(workouts: readonly StrengthWorkout[], now: number): number {
  const trained = new Set(workouts.filter((w) => w.deletedAt === null).map((w) => weekKey(w.startedAt)));
  const cursor = new Date(now);
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
  if (!trained.has(localDay(cursor.getTime()))) cursor.setDate(cursor.getDate() - 7);
  let streak = 0;
  while (trained.has(localDay(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 7);
  }
  return streak;
}

/** Weeks of the last `weeks` that have a workout, and the average workouts per week over them. */
export function consistency(workouts: readonly StrengthWorkout[], now: number, weeks: number): { activeWeeks: number; weeks: number; perWeek: number } {
  const counts = weeklyCounts(workouts, now, weeks);
  const total = counts.reduce((sum, c) => sum + c.workouts, 0);
  return { activeWeeks: counts.filter((c) => c.workouts > 0).length, weeks, perWeek: weeks > 0 ? total / weeks : 0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Personal records per workout
// ---------------------------------------------------------------------------------------------------------------------

/** How many records each workout set when it was done (against everything earlier), by workout id; workouts without a record are absent. */
export function prCounts(workouts: readonly StrengthWorkout[]): Map<string, number> {
  const ordered = workouts.filter((w) => w.deletedAt === null).sort((a, b) => a.startedAt - b.startedAt);
  const bests = new Map<string, ExerciseBests>();
  const counts = new Map<string, number>();
  for (const workout of ordered) {
    const records = findPersonalRecords(workout, bests);
    if (records.length > 0) counts.set(workout.id, records.length);
    for (const exercise of workout.exercises) {
      let b = bests.get(exercise.exerciseId);
      if (!b) bests.set(exercise.exerciseId, (b = emptyBests()));
      for (const s of exercise.sets) addToBests(b, s);
    }
  }
  return counts;
}

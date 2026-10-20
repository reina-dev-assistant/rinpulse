import { sportKind } from './analysis/sport';
import type { ProgressPeriod } from './progress';
import { sportIcon } from './sportIcon';

/** The list's sport filter. Order is the order of the chips. */
export type WorkoutGroup = 'run' | 'walk' | 'ride' | 'swim' | 'strength' | 'other';
export type WorkoutFilter = 'all' | WorkoutGroup;
export const FILTER_ORDER: readonly WorkoutFilter[] = ['all', 'run', 'walk', 'ride', 'swim', 'strength', 'other'];

/**
 * The chip a workout sits under: strength when the strength logger owns it or its name is a strength sport, then the
 * on-foot/wheel/water kinds of `sportKind`, everything else under "other".
 */
export function workoutGroup(sportName: string, isStrengthLog: boolean): WorkoutGroup {
  if (isStrengthLog || sportIcon(sportName) === 'weight-lifter') return 'strength';
  return sportKind(sportName);
}

export function countGroups<T>(items: readonly T[], groupOf: (item: T) => WorkoutGroup): Record<WorkoutFilter, number> {
  const counts: Record<WorkoutFilter, number> = { all: items.length, run: 0, walk: 0, ride: 0, swim: 0, strength: 0, other: 0 };
  for (const item of items) counts[groupOf(item)] += 1;
  return counts;
}

/** The chips to show: "all" plus every group with a workout. */
export function visibleFilters(counts: Record<WorkoutFilter, number>): WorkoutFilter[] {
  return FILTER_ORDER.filter((f) => f === 'all' || counts[f] > 0);
}

/** A remembered filter whose workouts are gone (or an unknown stored value) reads as "all". */
export function effectiveFilter(selected: WorkoutFilter, counts: Record<WorkoutFilter, number>): WorkoutFilter {
  return selected === 'all' || counts[selected] > 0 ? selected : 'all';
}

/** What the list remembers between visits (`strength_meta`, local only). */
export interface WorkoutView {
  filter: WorkoutFilter;
  period: ProgressPeriod;
}
export const VIEW_META_KEY = 'workouts_view';
export const DEFAULT_VIEW: WorkoutView = { filter: 'all', period: 'week' };

/** Stored JSON back into a view; anything unreadable or unknown falls back field by field. */
export function parseView(json: string | null): WorkoutView {
  let raw: Partial<Record<keyof WorkoutView, unknown>> = {};
  try {
    const value: unknown = json ? JSON.parse(json) : null;
    if (typeof value === 'object' && value !== null) raw = value;
  } catch {
    // keep the defaults
  }
  return {
    filter: FILTER_ORDER.find((f) => f === raw.filter) ?? DEFAULT_VIEW.filter,
    period: raw.period === 'month' ? 'month' : DEFAULT_VIEW.period,
  };
}

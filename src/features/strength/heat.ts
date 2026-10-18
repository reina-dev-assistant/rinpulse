/**
 * The weekly muscle heat map: intensity levels by hard sets, colours that stay legible on every theme, and the exercises behind a
 * cell. Pure; the screen is `app/strength/muscles.tsx`.
 */
import { muscleSets, weekKey, type MuscleGroup, type MuscleResolver } from './calc';
import type { StrengthWorkout } from './types';

/** 0 no sets, 1 under 5, 2 from 5, 3 from 10, 4 from 15 hard sets in the week. 10 to 20 per muscle and week is a common target. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/** The lowest number of sets of levels 2, 3 and 4; level 1 is anything above 0 (secondary muscles count half). */
export const HEAT_FROM: readonly [number, number, number] = [5, 10, 15];

/** The weekly target the "This week" bars fill up to. */
export const WEEKLY_TARGET_SETS = 20;

export function heatLevel(sets: number): HeatLevel {
  if (!(sets > 0)) return 0;
  if (sets >= HEAT_FROM[2]) return 4;
  if (sets >= HEAT_FROM[1]) return 3;
  if (sets >= HEAT_FROM[0]) return 2;
  return 1;
}

// ---------------------------------------------------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------------------------------------------------

/** `#RRGGBB` to channels; null for anything else (a theme colour like `rgba(...)`). */
function channels(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: readonly number[]): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** `from` moved `share` (0 to 1) of the way to `to`; `from` itself when a colour is not `#RRGGBB`. */
export function mixHex(from: string, to: string, share: number): string {
  const a = channels(from);
  const b = channels(to);
  if (!a || !b) return from;
  return toHex(a.map((v, i) => v + (b[i]! - v) * share));
}

/** WCAG relative luminance of `#RRGGBB`; 0 when it is not one. */
export function luminance(hex: string): number {
  const c = channels(hex);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Of `candidates`, the colour that reads best on `background`. */
export function readableOn(background: string, candidates: readonly string[]): string {
  let best = candidates[0]!;
  let bestRatio = 0;
  for (const c of candidates) {
    const ratio = contrast(background, c);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = c;
    }
  }
  return best;
}

/** Share of the way from the empty cell colour to the accent, per level. */
const LEVEL_MIX: readonly number[] = [0, 0.28, 0.5, 0.75, 1];

/** Fill of a cell: `empty` for level 0, then steps towards `accent`. */
export function heatFill(level: HeatLevel, empty: string, accent: string): string {
  return level === 0 ? empty : mixHex(empty, accent, LEVEL_MIX[level]!);
}

// ---------------------------------------------------------------------------------------------------------------------
// What is behind a cell
// ---------------------------------------------------------------------------------------------------------------------

export interface Contributor {
  exerciseId: string;
  /** Hard sets it adds to the group (secondary muscles count half). */
  sets: number;
  /** Counted sets of the exercise that week. */
  counted: number;
  /** The group is a secondary muscle of the exercise. */
  secondary: boolean;
}

/** The exercises that loaded `group` in the week that starts on `week` (`YYYY-MM-DD`, a Monday), most sets first. */
export function weekContributors(
  workouts: readonly StrengthWorkout[],
  resolve: MuscleResolver,
  group: MuscleGroup,
  week: string,
): Contributor[] {
  const byExercise = new Map<string, Contributor>();
  for (const workout of workouts) {
    if (workout.deletedAt !== null || weekKey(workout.startedAt) !== week) continue;
    for (const exercise of workout.exercises) {
      const load = muscleSets({ exercises: [exercise] }, resolve).get(group) ?? 0;
      if (load <= 0) continue;
      const counted = exercise.sets.filter((s) => s.done && s.type !== 'warmup').length;
      const entry = byExercise.get(exercise.exerciseId) ?? { exerciseId: exercise.exerciseId, sets: 0, counted: 0, secondary: load < counted };
      entry.sets += load;
      entry.counted += counted;
      byExercise.set(exercise.exerciseId, entry);
    }
  }
  return [...byExercise.values()].sort((a, b) => b.sets - a.sets || b.counted - a.counted);
}

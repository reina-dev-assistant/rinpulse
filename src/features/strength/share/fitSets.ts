/**
 * A strength workout as the FIT `set` messages Strava reads (see `buildFit`'s `sets` option): which `exercise_category` an
 * exercise gets and when each set started and ended. Pure, no React Native.
 */
import type { FitSet } from '@/features/strava/activityFile';

import type { Catalog, CatalogExercise } from '../catalog';
import type { Muscle, StrengthWorkout } from '../types';

/** `exercise_category` enum values of the FIT profile (`@garmin/fitsdk` Profile.js), the ones used below. */
export const FIT_CATEGORY = {
  benchPress: 0,
  calfRaise: 1,
  cardio: 2,
  core: 5,
  crunch: 6,
  curl: 7,
  deadlift: 8,
  flye: 9,
  hipRaise: 10,
  hipStability: 11,
  hipSwing: 12,
  hyperextension: 13,
  lateralRaise: 14,
  legCurl: 15,
  legRaise: 16,
  lunge: 17,
  plank: 19,
  pullUp: 21,
  pushUp: 22,
  row: 23,
  shoulderPress: 24,
  shoulderStability: 25,
  shrug: 26,
  sitUp: 27,
  squat: 28,
  totalBody: 29,
  tricepsExtension: 30,
  run: 32,
  unknown: 65534,
} as const;

/** By exercise id, first match wins; an exercise the table does not name falls back to its movement pattern. */
const SLUG_RULES: readonly (readonly [RegExp, number])[] = [
  [/pike_push_up/, FIT_CATEGORY.shoulderPress],
  [/push_up/, FIT_CATEGORY.pushUp],
  [/plank/, FIT_CATEGORY.plank],
  [/lateral_raise/, FIT_CATEGORY.lateralRaise],
  [/y_raise|face_pull/, FIT_CATEGORY.shoulderStability],
  [/shrug/, FIT_CATEGORY.shrug],
  [/leg_curl/, FIT_CATEGORY.legCurl],
  [/sit_up/, FIT_CATEGORY.sitUp],
  [/crunch/, FIT_CATEGORY.crunch],
  [/leg_raise/, FIT_CATEGORY.legRaise],
  [/back_extension|hyperextension/, FIT_CATEGORY.hyperextension],
  [/flye|crossover/, FIT_CATEGORY.flye],
  [/swing/, FIT_CATEGORY.hipSwing],
  [/donkey_kick|fire_hydrant|lateral_walk|hip_abduction|cable_kickback/, FIT_CATEGORY.hipStability],
  [/hip_thrust|glute_bridge/, FIT_CATEGORY.hipRaise],
  [/deadlift|rdl|good_morning|pull_through/, FIT_CATEGORY.deadlift],
  [/skull_crusher|triceps|bench_dip/, FIT_CATEGORY.tricepsExtension],
  [/curl/, FIT_CATEGORY.curl],
  [/burpee/, FIT_CATEGORY.totalBody],
  [/treadmill/, FIT_CATEGORY.run],
];

const PATTERN_CATEGORY: Record<string, number> = {
  squat: FIT_CATEGORY.squat,
  hinge: FIT_CATEGORY.deadlift,
  lunge: FIT_CATEGORY.lunge,
  push_h: FIT_CATEGORY.benchPress,
  push_v: FIT_CATEGORY.shoulderPress,
  pull_h: FIT_CATEGORY.row,
  pull_v: FIT_CATEGORY.pullUp,
  core: FIT_CATEGORY.core,
  glute: FIT_CATEGORY.hipRaise,
  calf: FIT_CATEGORY.calfRaise,
  cardio: FIT_CATEGORY.cardio,
};

/** A custom exercise has no pattern, so its first primary muscle decides. */
const MUSCLE_CATEGORY: Record<Muscle, number> = {
  abs: FIT_CATEGORY.core,
  abductors: FIT_CATEGORY.hipStability,
  adductors: FIT_CATEGORY.hipStability,
  biceps: FIT_CATEGORY.curl,
  calves: FIT_CATEGORY.calfRaise,
  chest: FIT_CATEGORY.benchPress,
  forearms: FIT_CATEGORY.curl,
  glutes: FIT_CATEGORY.hipRaise,
  hamstrings: FIT_CATEGORY.legCurl,
  lats: FIT_CATEGORY.pullUp,
  lower_back: FIT_CATEGORY.hyperextension,
  middle_back: FIT_CATEGORY.row,
  neck: FIT_CATEGORY.unknown,
  quadriceps: FIT_CATEGORY.squat,
  shoulders: FIT_CATEGORY.shoulderPress,
  traps: FIT_CATEGORY.shrug,
  triceps: FIT_CATEGORY.tricepsExtension,
};

/** The FIT `exercise_category` of an exercise; `unknown` (65534) for an id nothing knows or a custom exercise without a muscle. */
export function exerciseCategory(exerciseId: string, exercise: Pick<CatalogExercise, 'def' | 'primary'> | null): number {
  for (const [pattern, category] of SLUG_RULES) if (pattern.test(exerciseId)) return category;
  const def = exercise?.def;
  if (def) {
    if (def.pattern === 'arms') return def.primary[0] === 'triceps' ? FIT_CATEGORY.tricepsExtension : FIT_CATEGORY.curl;
    return PATTERN_CATEGORY[def.pattern] ?? FIT_CATEGORY.unknown;
  }
  const muscle = exercise?.primary[0];
  return muscle ? MUSCLE_CATEGORY[muscle] : FIT_CATEGORY.unknown;
}

/** A set with reps takes at most this long (ms); the rest of the time since the previous set was rest and is not written. */
export const ACTIVE_SET_MS = 40_000;

/**
 * The completed sets of a workout as FIT sets, in the order they were checked. A set has only the moment it was checked
 * (`doneAt`), so it is taken to end then: it ends at `max(doneAt, end of the previous set)` and lasts
 * `min(time since the previous set ended, 40 s)`, a timed set `min(its seconds, that gap)`; the first set counts from the
 * workout's start. Sets therefore never overlap and never start before the workout. Only active sets are written, no rest sets:
 * warm-up, drop and failure sets are active sets too (FIT has no such types here). A done set without a `doneAt` is left out.
 */
export function fitSetsOf(workout: Pick<StrengthWorkout, 'startedAt' | 'exercises'>, catalog: Pick<Catalog, 'get'>): FitSet[] {
  const done: { doneAt: number; order: number; exerciseId: string; weightKg: number | null; reps: number | null; seconds: number | null }[] = [];
  let order = 0;
  for (const exercise of workout.exercises) {
    for (const set of exercise.sets) {
      if (set.done && set.doneAt !== null) done.push({ doneAt: set.doneAt, order: order++, exerciseId: exercise.exerciseId, weightKg: set.weightKg, reps: set.reps, seconds: set.seconds });
      else order += 1;
    }
  }
  done.sort((a, b) => a.doneAt - b.doneAt || a.order - b.order);

  const sets: FitSet[] = [];
  let previousEnd = workout.startedAt;
  for (const set of done) {
    const endMs = Math.max(set.doneAt, previousEnd);
    const gap = endMs - previousEnd;
    const timed = set.seconds !== null && set.seconds > 0;
    const durationMs = timed ? Math.min((set.seconds as number) * 1000, gap) : Math.min(ACTIVE_SET_MS, gap);
    sets.push({
      startMs: endMs - durationMs,
      endMs,
      durationMs,
      reps: timed ? null : set.reps,
      weightKg: set.weightKg,
      category: exerciseCategory(set.exerciseId, catalog.get(set.exerciseId)),
    });
    previousEnd = endMs;
  }
  return sets;
}

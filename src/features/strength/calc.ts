/**
 * The strength numbers: volume, estimated one-rep max, personal records, muscle load and the burned-energy estimate.
 * Pure functions on the types of `types.ts`, no React Native and no i18n, so they run under `bun test`.
 *
 * What counts: a set counts when it is done and not a warm-up (`isCounted`). Volume is weight x reps of counted sets; a
 * bodyweight set (no weight) adds reps to `totalReps` and 0 to volume.
 */
import type { Muscle, StrengthExercise, StrengthSet, StrengthWorkout } from './types';

/** A set that is done and not a warm-up. */
export const isCounted = (set: Pick<StrengthSet, 'done' | 'type'>): boolean => set.done && set.type !== 'warmup';

/** Weight x reps of one set; 0 for a set without weight or reps. */
export function setVolume(set: Pick<StrengthSet, 'weightKg' | 'reps'>): number {
  return (set.weightKg ?? 0) * (set.reps ?? 0);
}

/**
 * Epley's estimated one-rep max: `w * (1 + reps / 30)`; one rep is the weight itself. Null for a set it does not describe
 * (no weight, no reps, more than 30 reps).
 */
export function epley1rm(weightKg: number | null, reps: number | null): number | null {
  if (weightKg === null || reps === null || weightKg <= 0 || reps < 1 || reps > 30) return null;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

/** Rounded for display: whole kg above 100, one decimal below. */
export const roundKg = (kg: number): number => (kg >= 100 ? Math.round(kg) : Math.round(kg * 10) / 10);

/** Counted sets of one exercise entry. */
export const countedSets = (exercise: Pick<StrengthExercise, 'sets'>): StrengthSet[] => exercise.sets.filter(isCounted);

export interface WorkoutTotals {
  /** kg, counted sets. */
  volume: number;
  /** Counted sets (warm-ups excluded). */
  sets: number;
  warmupSets: number;
  /** Repetitions of counted sets. */
  reps: number;
  /** Seconds of counted timed sets (plank, wall sit, or anything measured in time). */
  seconds: number;
  /** Exercises with at least one done set. */
  exercises: number;
}

export function workoutTotals(workout: Pick<StrengthWorkout, 'exercises'>): WorkoutTotals {
  const totals: WorkoutTotals = { volume: 0, sets: 0, warmupSets: 0, reps: 0, seconds: 0, exercises: 0 };
  for (const exercise of workout.exercises) {
    let any = false;
    for (const set of exercise.sets) {
      if (!set.done) continue;
      any = true;
      if (set.type === 'warmup') {
        totals.warmupSets += 1;
        continue;
      }
      totals.sets += 1;
      totals.volume += setVolume(set);
      totals.reps += set.reps ?? 0;
      totals.seconds += set.seconds ?? 0;
    }
    if (any) totals.exercises += 1;
  }
  return totals;
}

/** The set with the highest weight x reps (ties: the heavier, then the later); null when no counted set has either. */
export function bestSet(sets: readonly StrengthSet[]): StrengthSet | null {
  let best: StrengthSet | null = null;
  for (const set of sets) {
    if (!isCounted(set)) continue;
    if (set.weightKg === null && set.reps === null && set.seconds === null) continue;
    if (best === null || compareSets(set, best) >= 0) best = set;
  }
  return best;
}

/** Order of "better": weight x reps, then weight, then reps, then seconds. */
function compareSets(a: StrengthSet, b: StrengthSet): number {
  return (
    setVolume(a) - setVolume(b) ||
    (a.weightKg ?? 0) - (b.weightKg ?? 0) ||
    (a.reps ?? 0) - (b.reps ?? 0) ||
    (a.seconds ?? 0) - (b.seconds ?? 0)
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Personal records
// ---------------------------------------------------------------------------------------------------------------------

/** `weight` heaviest load, `e1rm` best estimated 1RM, `volume` best weight x reps of one set, `reps` most reps at that load or a heavier one, `time` longest timed set. */
export type PrKind = 'weight' | 'e1rm' | 'volume' | 'reps' | 'time';

export interface PersonalRecord {
  exerciseId: string;
  kind: PrKind;
  /** The set that set the record. */
  setId: string;
  /** kg for weight, e1rm and volume (volume in kg), reps for reps, seconds for time. */
  value: number;
  /** The record before this workout. */
  previous: number;
}

/** The best of every kind among earlier sets of one exercise; the starting point of `findPersonalRecords`. */
export interface ExerciseBests {
  weight: number;
  e1rm: number;
  volume: number;
  time: number;
  /** Counted sets seen; a record needs at least one earlier set, or a first workout would be all records. */
  sets: number;
  /** Earlier counted sets as [weightKg, reps] pairs, for the rep record. */
  loads: [weightKg: number, reps: number][];
}

export const emptyBests = (): ExerciseBests => ({ weight: 0, e1rm: 0, volume: 0, time: 0, sets: 0, loads: [] });

/** Adds one counted set to `bests`. */
export function addToBests(bests: ExerciseBests, set: StrengthSet): void {
  if (!isCounted(set)) return;
  const weight = set.weightKg ?? 0;
  const reps = set.reps ?? 0;
  const seconds = set.seconds ?? 0;
  if (weight === 0 && reps === 0 && seconds === 0) return;
  bests.sets += 1;
  bests.weight = Math.max(bests.weight, weight);
  bests.e1rm = Math.max(bests.e1rm, epley1rm(set.weightKg, set.reps) ?? 0);
  bests.volume = Math.max(bests.volume, setVolume(set));
  bests.time = Math.max(bests.time, seconds);
  if (reps > 0) bests.loads.push([weight, reps]);
}

/** Most reps among earlier sets at `weight` or heavier. */
const repsAtOrAbove = (bests: ExerciseBests, weight: number): number =>
  bests.loads.reduce((most, [w, r]) => (w >= weight && r > most ? r : most), 0);

/** Bests of every exercise over `workouts` (deleted ones skipped). */
export function bestsByExercise(workouts: readonly StrengthWorkout[]): Map<string, ExerciseBests> {
  const map = new Map<string, ExerciseBests>();
  for (const workout of workouts) {
    if (workout.deletedAt !== null) continue;
    for (const exercise of workout.exercises) {
      let bests = map.get(exercise.exerciseId);
      if (!bests) map.set(exercise.exerciseId, (bests = emptyBests()));
      for (const set of exercise.sets) addToBests(bests, set);
    }
  }
  return map;
}

/**
 * The records `workout` sets against `before` (the bests of everything earlier, `bestsByExercise` of the earlier workouts).
 * One record per exercise and kind: the best set of the workout when it beats the earlier best. An exercise never done before has
 * no records. Weight, 1RM and volume of a bodyweight set are 0 and never records.
 */
export function findPersonalRecords(
  workout: Pick<StrengthWorkout, 'exercises'>,
  before: ReadonlyMap<string, ExerciseBests>,
): PersonalRecord[] {
  const records: PersonalRecord[] = [];
  const seen = new Map<string, ExerciseBests>();
  for (const exercise of workout.exercises) {
    const prior = before.get(exercise.exerciseId);
    if (!prior || prior.sets === 0) continue;
    // Two entries of one exercise in a workout compete with each other too.
    const running = seen.get(exercise.exerciseId) ?? { ...prior, loads: [...prior.loads] };
    const found = new Map<PrKind, PersonalRecord>();
    const consider = (kind: PrKind, setId: string, value: number, previous: number) => {
      if (value <= previous) return;
      const current = found.get(kind);
      if (!current || value > current.value) found.set(kind, { exerciseId: exercise.exerciseId, kind, setId, value, previous });
    };
    for (const set of exercise.sets) {
      if (!isCounted(set)) continue;
      const weight = set.weightKg ?? 0;
      const reps = set.reps ?? 0;
      consider('weight', set.id, weight, prior.weight);
      consider('e1rm', set.id, epley1rm(set.weightKg, set.reps) ?? 0, prior.e1rm);
      consider('volume', set.id, setVolume(set), prior.volume);
      // Like a rep record, a hold needs an earlier hold: an exercise first timed after being counted in reps starts its record here.
      if (prior.time > 0) consider('time', set.id, set.seconds ?? 0, prior.time);
      // A load never lifted before is a weight record, not a rep record: a rep record needs an earlier set at that load or heavier.
      const earlierReps = repsAtOrAbove(prior, weight);
      if (reps > 0 && earlierReps > 0) consider('reps', set.id, reps, earlierReps);
    }
    for (const set of exercise.sets) addToBests(running, set);
    seen.set(exercise.exerciseId, running);
    records.push(...found.values());
  }
  return records;
}

// ---------------------------------------------------------------------------------------------------------------------
// Per-exercise history
// ---------------------------------------------------------------------------------------------------------------------

export interface ExercisePoint {
  workoutId: string;
  /** Epoch ms of the workout's start. */
  at: number;
  /** Heaviest counted load; 0 for bodyweight. */
  maxWeightKg: number;
  /** Best estimated 1RM of the workout; null when no set has weight and reps. */
  e1rm: number | null;
  /** kg, counted sets. */
  volume: number;
  /** Reps of counted sets. */
  reps: number;
  /** Longest timed set, seconds. */
  maxSeconds: number;
  sets: number;
  /** The best set (`bestSet`) as `weight x reps`. */
  best: { weightKg: number | null; reps: number | null; seconds: number | null } | null;
}

/** One point per workout that has a counted set of `exerciseId`, oldest first. */
export function exerciseHistory(workouts: readonly StrengthWorkout[], exerciseId: string): ExercisePoint[] {
  const points: ExercisePoint[] = [];
  for (const workout of workouts) {
    if (workout.deletedAt !== null) continue;
    const sets = workout.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets.filter(isCounted));
    if (sets.length === 0) continue;
    let maxWeight = 0;
    let e1rm: number | null = null;
    let volume = 0;
    let reps = 0;
    let maxSeconds = 0;
    for (const set of sets) {
      maxWeight = Math.max(maxWeight, set.weightKg ?? 0);
      const estimate = epley1rm(set.weightKg, set.reps);
      if (estimate !== null && (e1rm === null || estimate > e1rm)) e1rm = estimate;
      volume += setVolume(set);
      reps += set.reps ?? 0;
      maxSeconds = Math.max(maxSeconds, set.seconds ?? 0);
    }
    const best = bestSet(sets);
    points.push({
      workoutId: workout.id,
      at: workout.startedAt,
      maxWeightKg: maxWeight,
      e1rm,
      volume,
      reps,
      maxSeconds,
      sets: sets.length,
      best: best ? { weightKg: best.weightKg, reps: best.reps, seconds: best.seconds } : null,
    });
  }
  return points.sort((a, b) => a.at - b.at);
}

/** Every exercise id with a counted set, by number of workouts it appears in, most first. */
export function exercisesUsed(workouts: readonly StrengthWorkout[]): { exerciseId: string; workouts: number; lastAt: number }[] {
  const map = new Map<string, { workouts: number; lastAt: number }>();
  for (const workout of workouts) {
    if (workout.deletedAt !== null) continue;
    for (const id of new Set(workout.exercises.filter((e) => e.sets.some(isCounted)).map((e) => e.exerciseId))) {
      const entry = map.get(id) ?? { workouts: 0, lastAt: 0 };
      entry.workouts += 1;
      entry.lastAt = Math.max(entry.lastAt, workout.startedAt);
      map.set(id, entry);
    }
  }
  return [...map].map(([exerciseId, v]) => ({ exerciseId, ...v })).sort((a, b) => b.workouts - a.workouts || b.lastAt - a.lastAt);
}

// ---------------------------------------------------------------------------------------------------------------------
// Muscle load
// ---------------------------------------------------------------------------------------------------------------------

/** The groups of the weekly heat map; `Muscle` values are folded into them. */
export const MUSCLE_GROUPS = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'glutes',
  'quads',
  'hamstrings',
  'calves',
  'hips',
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

const GROUP_OF: Readonly<Record<Muscle, MuscleGroup>> = {
  abs: 'abs',
  abductors: 'hips',
  adductors: 'hips',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'back',
  lower_back: 'back',
  middle_back: 'back',
  neck: 'shoulders',
  quadriceps: 'quads',
  shoulders: 'shoulders',
  traps: 'shoulders',
  triceps: 'triceps',
};

export const muscleGroup = (muscle: Muscle): MuscleGroup => GROUP_OF[muscle];

/** Share of a set a secondary muscle gets (a bench press loads the triceps, but less than a pushdown does). */
export const SECONDARY_WEIGHT = 0.5;

/** The muscles an exercise id trains; null for an id nothing knows (a deleted custom exercise). */
export type MuscleResolver = (exerciseId: string) => { primary: readonly Muscle[]; secondary: readonly Muscle[] } | null;

/**
 * Hard sets per muscle group: each counted set adds 1 to every group of the exercise's primary muscles and
 * `SECONDARY_WEIGHT` to every group of its secondary muscles (a group counts once per set, at its highest share).
 */
export function muscleSets(workout: Pick<StrengthWorkout, 'exercises'>, resolve: MuscleResolver): Map<MuscleGroup, number> {
  const load = new Map<MuscleGroup, number>();
  for (const exercise of workout.exercises) {
    const muscles = resolve(exercise.exerciseId);
    if (!muscles) continue;
    const shares = new Map<MuscleGroup, number>();
    for (const m of muscles.secondary) shares.set(GROUP_OF[m], SECONDARY_WEIGHT);
    for (const m of muscles.primary) shares.set(GROUP_OF[m], 1);
    const sets = countedSets(exercise).length;
    if (sets === 0) continue;
    for (const [group, share] of shares) load.set(group, (load.get(group) ?? 0) + sets * share);
  }
  return load;
}

/** `YYYY-MM-DD` of the Monday of the week that holds `ms`, in the device's time zone. */
export function weekKey(ms: number): string {
  const d = new Date(ms);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return localDay(d.getTime());
}

/** `YYYY-MM-DD` in the device's time zone. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface WeeklyMuscleLoad {
  /** Monday, `YYYY-MM-DD`. */
  week: string;
  sets: Map<MuscleGroup, number>;
}

/** The last `weeks` weeks ending with the one of `now` (oldest first), each with its hard sets per muscle group. */
export function weeklyMuscleLoad(
  workouts: readonly StrengthWorkout[],
  resolve: MuscleResolver,
  now: number,
  weeks: number,
): WeeklyMuscleLoad[] {
  const result: WeeklyMuscleLoad[] = [];
  const index = new Map<string, WeeklyMuscleLoad>();
  const monday = new Date(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 7 * (weeks - 1));
  for (let i = 0; i < weeks; i++) {
    const key = localDay(monday.getTime());
    const entry: WeeklyMuscleLoad = { week: key, sets: new Map() };
    result.push(entry);
    index.set(key, entry);
    monday.setDate(monday.getDate() + 7);
  }
  for (const workout of workouts) {
    if (workout.deletedAt !== null) continue;
    const entry = index.get(weekKey(workout.startedAt));
    if (!entry) continue;
    for (const [group, n] of muscleSets(workout, resolve)) entry.sets.set(group, (entry.sets.get(group) ?? 0) + n);
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// Energy
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Energy of a strength workout the watch did not record, from its duration and intensity (MET method, the formula
 * JoyoRogo uses for its quick entries too: kcal per minute = MET x 3.5 x kg / 200).
 *
 *   sets per hour = counted sets / hours of the stopwatch (pauses excluded)
 *   MET = 3.5 + 2.5 x clamp((sets per hour - 12) / (30 - 12), 0, 1)   from light (3.5) to vigorous resistance training (6.0)
 *   + 0.5 when the average RPE of counted sets is 8.5 or more (at most 6.5)
 *   kcal = MET x 3.5 x weightKg x minutes / 200
 *
 * The 3.5 and 6.0 are the Compendium of Physical Activities values for light-to-moderate and vigorous resistance training;
 * 12 and 30 sets per hour are a slow session with long rests and a circuit. It is an estimate, never a measurement.
 */
export function strengthMet(input: { countedSets: number; durationSec: number; avgRpe: number | null }): number {
  const hours = Math.max(input.durationSec, 60) / 3600;
  const perHour = input.countedSets / hours;
  const t = Math.min(1, Math.max(0, (perHour - 12) / (30 - 12)));
  let met = 3.5 + 2.5 * t;
  if (input.avgRpe !== null && input.avgRpe >= 8.5) met = Math.min(6.5, met + 0.5);
  return met;
}

export function estimateKcal(workout: Pick<StrengthWorkout, 'exercises' | 'durationSec'>, weightKg: number): number {
  const counted = workout.exercises.flatMap(countedSets);
  const rpes = counted.map((s) => s.rpe).filter((r): r is number => r !== null);
  const avgRpe = rpes.length > 0 ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;
  const met = strengthMet({ countedSets: counted.length, durationSec: workout.durationSec, avgRpe });
  return Math.round((met * 3.5 * weightKg * (workout.durationSec / 60)) / 200);
}

/** Average RPE of the counted sets that have one; null when none has. */
export function averageRpe(workout: Pick<StrengthWorkout, 'exercises'>): number | null {
  const rpes = workout.exercises.flatMap(countedSets).map((s) => s.rpe).filter((r): r is number => r !== null);
  return rpes.length > 0 ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;
}


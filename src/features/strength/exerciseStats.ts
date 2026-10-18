/**
 * What the exercise page shows, from the finished workouts: the metric series for the charts, the records card, the rep records
 * (most reps at each weight) and the past sessions. Pure; counted sets only (`isCounted`: done, not a warm-up).
 */
import { bestSet, epley1rm, exerciseHistory, isCounted, setVolume, type ExercisePoint } from './calc';
import type { StrengthSet, StrengthWorkout } from './types';

/** `bestSet` weight of the best set, `e1rm` Epley, `volume` per workout, `reps` per workout, `time` longest timed set, `totalTime` timed seconds per workout. */
export type ExerciseMetric = 'bestSet' | 'e1rm' | 'volume' | 'reps' | 'time' | 'totalTime';

export const EXERCISE_METRICS: readonly ExerciseMetric[] = ['bestSet', 'e1rm', 'volume', 'reps', 'time', 'totalTime'];

export interface SeriesPoint {
  workoutId: string;
  at: number;
  value: number;
  /** The best set of that workout, for the readout of `bestSet`. */
  best: ExercisePoint['best'];
}

/** Seconds of timed counted sets per workout, by workout id (`ExercisePoint` has the longest set only). */
function totalSeconds(workouts: readonly StrengthWorkout[], exerciseId: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const workout of workouts) {
    if (workout.deletedAt !== null) continue;
    let sum = 0;
    for (const entry of workout.exercises) {
      if (entry.exerciseId !== exerciseId) continue;
      for (const set of entry.sets) if (isCounted(set)) sum += set.seconds ?? 0;
    }
    if (sum > 0) totals.set(workout.id, sum);
  }
  return totals;
}

/** One value per workout of `exerciseId`, oldest first; workouts without a value for the metric are skipped. */
export function exerciseSeries(workouts: readonly StrengthWorkout[], exerciseId: string, metric: ExerciseMetric): SeriesPoint[] {
  const history = exerciseHistory(workouts, exerciseId);
  const seconds = metric === 'totalTime' ? totalSeconds(workouts, exerciseId) : null;
  const series: SeriesPoint[] = [];
  for (const p of history) {
    let value: number | null;
    switch (metric) {
      case 'bestSet':
        value = p.best?.weightKg ?? null;
        break;
      case 'e1rm':
        value = p.e1rm;
        break;
      case 'volume':
        value = p.volume;
        break;
      case 'reps':
        value = p.reps;
        break;
      case 'time':
        value = p.maxSeconds;
        break;
      case 'totalTime':
        value = seconds?.get(p.workoutId) ?? null;
        break;
    }
    if (value === null || !(value > 0)) continue;
    series.push({ workoutId: p.workoutId, at: p.at, value, best: p.best });
  }
  return series;
}

/** The charts that have something to show for this exercise, in tab order. */
export function availableMetrics(workouts: readonly StrengthWorkout[], exerciseId: string): ExerciseMetric[] {
  return EXERCISE_METRICS.filter((metric) => exerciseSeries(workouts, exerciseId, metric).length > 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------------------------------------

export interface RecordEntry {
  /** kg for weight, e1rm and volume (volume in kg); seconds for time. */
  value: number;
  /** Epoch ms of the workout. */
  at: number;
  workoutId: string;
  /** Reps of the set that set it. */
  reps: number | null;
  weightKg: number | null;
}

export interface ExerciseRecordsCard {
  weight: RecordEntry | null;
  e1rm: RecordEntry | null;
  volume: RecordEntry | null;
  time: RecordEntry | null;
}

/** Every counted set of `exerciseId` with the workout it belongs to, oldest workout first. */
function* countedSetsOf(workouts: readonly StrengthWorkout[], exerciseId: string): Generator<{ workout: StrengthWorkout; set: StrengthSet }> {
  const ordered = workouts.filter((w) => w.deletedAt === null).sort((a, b) => a.startedAt - b.startedAt);
  for (const workout of ordered) {
    for (const entry of workout.exercises) {
      if (entry.exerciseId !== exerciseId) continue;
      for (const set of entry.sets) if (isCounted(set)) yield { workout, set };
    }
  }
}

/** The best of each kind over all workouts; a tie keeps the earlier set (the day the record was first set). */
export function exerciseRecords(workouts: readonly StrengthWorkout[], exerciseId: string): ExerciseRecordsCard {
  const card: ExerciseRecordsCard = { weight: null, e1rm: null, volume: null, time: null };
  const consider = (kind: keyof ExerciseRecordsCard, value: number, workout: StrengthWorkout, set: StrengthSet) => {
    if (!(value > 0)) return;
    const current = card[kind];
    if (current === null || value > current.value) {
      card[kind] = { value, at: workout.startedAt, workoutId: workout.id, reps: set.reps, weightKg: set.weightKg };
    }
  };
  for (const { workout, set } of countedSetsOf(workouts, exerciseId)) {
    consider('weight', set.weightKg ?? 0, workout, set);
    consider('e1rm', epley1rm(set.weightKg, set.reps) ?? 0, workout, set);
    consider('volume', setVolume(set), workout, set);
    consider('time', set.seconds ?? 0, workout, set);
  }
  return card;
}

export interface RepRecord {
  /** kg; 0 is bodyweight. */
  weightKg: number;
  reps: number;
  at: number;
  workoutId: string;
}

/** The most reps at each weight, heaviest first. Sets without reps are skipped; a tie keeps the earlier set. */
export function repRecords(workouts: readonly StrengthWorkout[], exerciseId: string): RepRecord[] {
  const byWeight = new Map<number, RepRecord>();
  for (const { workout, set } of countedSetsOf(workouts, exerciseId)) {
    const reps = set.reps ?? 0;
    if (reps <= 0) continue;
    const weightKg = set.weightKg ?? 0;
    const current = byWeight.get(weightKg);
    if (!current || reps > current.reps) byWeight.set(weightKg, { weightKg, reps, at: workout.startedAt, workoutId: workout.id });
  }
  return [...byWeight.values()].sort((a, b) => b.weightKg - a.weightKg);
}

// ---------------------------------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------------------------------

export interface ExerciseSession {
  workoutId: string;
  name: string;
  at: number;
  /** Counted sets in the order they were done (two entries of the exercise in one workout are joined). */
  sets: { type: StrengthSet['type']; weightKg: number | null; reps: number | null; seconds: number | null }[];
  best: { weightKg: number | null; reps: number | null; seconds: number | null } | null;
}

/** Past sessions of the exercise, newest first. */
export function exerciseSessions(workouts: readonly StrengthWorkout[], exerciseId: string): ExerciseSession[] {
  const sessions: ExerciseSession[] = [];
  for (const workout of workouts) {
    if (workout.deletedAt !== null) continue;
    const sets = workout.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets.filter(isCounted));
    if (sets.length === 0) continue;
    const best = bestSet(sets);
    sessions.push({
      workoutId: workout.id,
      name: workout.name,
      at: workout.startedAt,
      sets: sets.map((s) => ({ type: s.type, weightKg: s.weightKg, reps: s.reps, seconds: s.seconds })),
      best: best ? { weightKg: best.weightKg, reps: best.reps, seconds: best.seconds } : null,
    });
  }
  return sessions.sort((a, b) => b.at - a.at);
}

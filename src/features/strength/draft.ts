/**
 * What can happen to the workout in progress, as pure functions on `StrengthDraft` (no React, no database, no clock: `now` is a
 * parameter). The active-workout screen calls them and saves the result (`saveDraft`); the rules live here so they are tested once.
 */
import { newId } from './store';
import type {
  Routine,
  RoutineExercise,
  RoutineSet,
  SetType,
  StrengthDraft,
  StrengthExercise,
  StrengthSet,
  StrengthWorkout,
} from './types';

/** What an exercise needs to know when it is added: whether it is timed. */
export interface ExerciseInfo {
  exerciseId: string;
  timed: boolean;
}

/** The part of the coach's `PlannedExercise` the logger needs (`features/coach/plans/types.ts`). */
export interface PlannedInput {
  exerciseId: string;
  sets: number;
  /** Repetitions per set; 0 for a timed exercise. */
  reps: number;
  seconds: number | null;
  restSec: number;
}

export const MAX_SETS_PER_EXERCISE = 30;
export const MAX_EXERCISES = 40;
export const MIN_REST_SEC = 5;
export const MAX_REST_SEC = 60 * 15;

export function newSet(type: SetType = 'normal', from: Partial<Pick<StrengthSet, 'weightKg' | 'reps' | 'seconds'>> = {}): StrengthSet {
  return { id: newId('s'), type, weightKg: from.weightKg ?? null, reps: from.reps ?? null, seconds: from.seconds ?? null, rpe: null, done: false, doneAt: null };
}

export function newExercise(info: ExerciseInfo, sets = 1, restSec: number | null = null): StrengthExercise {
  return {
    key: newId('k'),
    exerciseId: info.exerciseId,
    note: '',
    restSec,
    supersetGroup: null,
    sets: Array.from({ length: Math.max(1, sets) }, () => newSet()),
  };
}

export function emptyDraft(now: number, name = ''): StrengthDraft {
  return {
    id: newId('w', now),
    name,
    startedAt: now,
    pausedMs: 0,
    pausedAt: null,
    note: '',
    routineId: null,
    planKey: null,
    exercises: [],
    rest: null,
  };
}

/** A draft that holds a routine's exercises and sets, nothing done. */
export function draftFromRoutine(routine: Pick<Routine, 'id' | 'name' | 'exercises'>, now: number): StrengthDraft {
  const draft = emptyDraft(now, routine.name);
  return {
    ...draft,
    routineId: routine.id.startsWith('builtin:') ? null : routine.id,
    exercises: routine.exercises.map(exerciseFromRoutine),
  };
}

function exerciseFromRoutine(e: RoutineExercise): StrengthExercise {
  return {
    key: newId('k'),
    exerciseId: e.exerciseId,
    note: e.note,
    restSec: e.restSec,
    supersetGroup: e.supersetGroup,
    sets: e.sets.length > 0 ? e.sets.map((s) => newSet(s.type, s)) : [newSet()],
  };
}

/** A draft for a coach plan session: `sets` empty sets per exercise with the planned reps (or seconds) filled in, the planned rest. */
export function draftFromPlan(planKey: string, planned: readonly PlannedInput[], now: number, name = ''): StrengthDraft {
  const draft = emptyDraft(now, name);
  return {
    ...draft,
    planKey,
    exercises: planned.map((p) => ({
      key: newId('k'),
      exerciseId: p.exerciseId,
      note: '',
      restSec: p.restSec > 0 ? p.restSec : null,
      supersetGroup: null,
      sets: Array.from({ length: Math.max(1, p.sets) }, () =>
        newSet('normal', p.seconds !== null && p.seconds > 0 ? { seconds: p.seconds } : { reps: p.reps > 0 ? p.reps : null }),
      ),
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Stopwatch
// ---------------------------------------------------------------------------------------------------------------------

/** Milliseconds the stopwatch has run at `now`, pauses excluded. */
export function elapsedMs(draft: Pick<StrengthDraft, 'startedAt' | 'pausedMs' | 'pausedAt'>, now: number): number {
  const end = draft.pausedAt ?? now;
  return Math.max(0, end - draft.startedAt - draft.pausedMs);
}

export const pauseDraft = (draft: StrengthDraft, now: number): StrengthDraft => (draft.pausedAt === null ? { ...draft, pausedAt: now } : draft);

export function resumeDraft(draft: StrengthDraft, now: number): StrengthDraft {
  if (draft.pausedAt === null) return draft;
  // A paused rest timer would otherwise run out while paused: it is pushed by the pause.
  const paused = now - draft.pausedAt;
  return {
    ...draft,
    pausedMs: draft.pausedMs + paused,
    pausedAt: null,
    rest: draft.rest ? { ...draft.rest, endsAt: draft.rest.endsAt + paused } : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------------------------------------------------

const mapExercise = (draft: StrengthDraft, key: string, change: (e: StrengthExercise) => StrengthExercise): StrengthDraft => ({
  ...draft,
  exercises: draft.exercises.map((e) => (e.key === key ? change(e) : e)),
});

/** Adds exercises at the end, each with one empty set (timed exercises get a seconds field instead of reps in the UI). */
export function addExercises(draft: StrengthDraft, infos: readonly ExerciseInfo[], restOf: (exerciseId: string) => number | null = () => null): StrengthDraft {
  const room = MAX_EXERCISES - draft.exercises.length;
  if (room <= 0) return draft;
  return { ...draft, exercises: [...draft.exercises, ...infos.slice(0, room).map((i) => newExercise(i, 1, restOf(i.exerciseId)))] };
}

/** Swaps the exercise of an entry for another one, keeping its sets that fit (weight and reps are kept; set types too). */
export function replaceExercise(draft: StrengthDraft, key: string, info: ExerciseInfo): StrengthDraft {
  return mapExercise(draft, key, (e) => ({
    ...e,
    exerciseId: info.exerciseId,
    sets: e.sets.map((s) => ({ ...s, done: false, doneAt: null, seconds: info.timed ? s.seconds : null, reps: info.timed ? null : s.reps })),
  }));
}

export function removeExercise(draft: StrengthDraft, key: string): StrengthDraft {
  const exercises = draft.exercises.filter((e) => e.key !== key);
  return { ...draft, exercises: dropLoneSupersets(exercises), rest: draft.rest?.exerciseKey === key ? null : draft.rest };
}

/** Moves an entry to `toIndex` (clamped). */
export function moveExercise(draft: StrengthDraft, key: string, toIndex: number): StrengthDraft {
  const from = draft.exercises.findIndex((e) => e.key === key);
  if (from < 0) return draft;
  const to = Math.min(Math.max(0, toIndex), draft.exercises.length - 1);
  if (to === from) return draft;
  const exercises = [...draft.exercises];
  const [moved] = exercises.splice(from, 1);
  exercises.splice(to, 0, moved as StrengthExercise);
  return { ...draft, exercises };
}

export const setExerciseNote = (draft: StrengthDraft, key: string, note: string): StrengthDraft => mapExercise(draft, key, (e) => ({ ...e, note }));

export const setExerciseRest = (draft: StrengthDraft, key: string, restSec: number | null): StrengthDraft =>
  mapExercise(draft, key, (e) => ({ ...e, restSec: restSec === null ? null : clampRest(restSec) }));

export const clampRest = (sec: number): number => Math.min(MAX_REST_SEC, Math.max(MIN_REST_SEC, Math.round(sec)));

// ---------------------------------------------------------------------------------------------------------------------
// Supersets
// ---------------------------------------------------------------------------------------------------------------------

/** A group left with one member stops being a superset. */
function dropLoneSupersets(exercises: StrengthExercise[]): StrengthExercise[] {
  const counts = new Map<number, number>();
  for (const e of exercises) if (e.supersetGroup !== null) counts.set(e.supersetGroup, (counts.get(e.supersetGroup) ?? 0) + 1);
  return exercises.map((e) => (e.supersetGroup !== null && (counts.get(e.supersetGroup) ?? 0) < 2 ? { ...e, supersetGroup: null } : e));
}

/**
 * Groups the given entries as one superset (two or more; they are moved next to the first one, in the order given). Entries that were
 * in another group leave it.
 */
export function makeSuperset(draft: StrengthDraft, keys: readonly string[]): StrengthDraft {
  const chosen = keys.filter((k) => draft.exercises.some((e) => e.key === k));
  if (chosen.length < 2) return draft;
  const used = new Set(draft.exercises.map((e) => e.supersetGroup).filter((g): g is number => g !== null));
  let group = 1;
  while (used.has(group)) group += 1;
  const first = draft.exercises.findIndex((e) => e.key === chosen[0]);
  const members = chosen.map((k) => draft.exercises.find((e) => e.key === k) as StrengthExercise);
  const rest = draft.exercises.filter((e) => !chosen.includes(e.key));
  const before = draft.exercises.slice(0, first).filter((e) => !chosen.includes(e.key)).length;
  const exercises = [...rest.slice(0, before), ...members.map((m) => ({ ...m, supersetGroup: group })), ...rest.slice(before)];
  return { ...draft, exercises: dropLoneSupersets(exercises) };
}

/** Takes an entry out of its superset. */
export function leaveSuperset(draft: StrengthDraft, key: string): StrengthDraft {
  return { ...draft, exercises: dropLoneSupersets(draft.exercises.map((e) => (e.key === key ? { ...e, supersetGroup: null } : e))) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------------------------------------------------

/** Appends a set that starts with the values of the last set (same weight and reps is the common case); a warm-up copies nothing. */
export function addSet(draft: StrengthDraft, key: string, type: SetType = 'normal'): StrengthDraft {
  return mapExercise(draft, key, (e) => {
    if (e.sets.length >= MAX_SETS_PER_EXERCISE) return e;
    const last = [...e.sets].reverse().find((s) => s.type !== 'warmup') ?? e.sets[e.sets.length - 1];
    const from = type === 'warmup' || !last ? {} : { weightKg: last.weightKg, reps: last.reps, seconds: last.seconds };
    return { ...e, sets: [...e.sets, newSet(type, from)] };
  });
}

export function removeSet(draft: StrengthDraft, key: string, setId: string): StrengthDraft {
  const next = mapExercise(draft, key, (e) => ({ ...e, sets: e.sets.filter((s) => s.id !== setId) }));
  return { ...next, rest: draft.rest?.setId === setId ? null : draft.rest };
}

export type SetPatch = Partial<Pick<StrengthSet, 'weightKg' | 'reps' | 'seconds' | 'rpe' | 'type'>>;

export function updateSet(draft: StrengthDraft, key: string, setId: string, patch: SetPatch): StrengthDraft {
  return mapExercise(draft, key, (e) => ({ ...e, sets: e.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) }));
}

/** Normal sets of an exercise are numbered 1, 2, 3 and warm-ups say `W`: the label a set row shows (drop and failure sets keep their number). */
export function setLabels(sets: readonly Pick<StrengthSet, 'type'>[]): string[] {
  let n = 0;
  return sets.map((s) => {
    if (s.type === 'warmup') return 'W';
    if (s.type === 'drop') return 'D';
    n += 1;
    return String(n);
  });
}

export interface RestContext {
  defaultRestSec: number;
  autoRest: boolean;
  /** Saved rest per exercise id (`listRestPrefs`). */
  prefs: ReadonlyMap<string, number>;
}

export interface CompleteResult {
  draft: StrengthDraft;
  /** The set could not be completed: it has neither reps nor seconds (and no `fallback` filled them). */
  refused: boolean;
  /** A rest timer was started by this completion. */
  restStarted: boolean;
}

/** The rest of an exercise: its own, else the saved one, else the default. */
export function restFor(exercise: Pick<StrengthExercise, 'exerciseId' | 'restSec'>, context: Pick<RestContext, 'defaultRestSec' | 'prefs'>): number {
  return exercise.restSec ?? context.prefs.get(exercise.exerciseId) ?? context.defaultRestSec;
}

/**
 * Ticks a set done, or takes the tick back. Completing fills a missing weight / reps / seconds from `fallback` (the "previous" values
 * the row shows as placeholders) and refuses when the set still has neither reps nor seconds. With `autoRest` a completion starts the
 * rest timer of the exercise, except in the middle of a superset round (the partner exercise's set at the same position is
 * still to do): then the person goes straight to it.
 */
export function toggleSetDone(
  draft: StrengthDraft,
  key: string,
  setId: string,
  now: number,
  context: RestContext,
  fallback: { weightKg: number | null; reps: number | null; seconds: number | null } | null = null,
): CompleteResult {
  const exercise = draft.exercises.find((e) => e.key === key);
  const set = exercise?.sets.find((s) => s.id === setId);
  if (!exercise || !set) return { draft, refused: false, restStarted: false };

  if (set.done) {
    const undone = updateSetRaw(draft, key, setId, { done: false, doneAt: null });
    return { draft: { ...undone, rest: draft.rest?.setId === setId ? null : draft.rest }, refused: false, restStarted: false };
  }

  const filled = {
    weightKg: set.weightKg ?? fallback?.weightKg ?? null,
    reps: set.reps ?? fallback?.reps ?? null,
    seconds: set.seconds ?? fallback?.seconds ?? null,
  };
  if (filled.reps === null && filled.seconds === null) return { draft, refused: true, restStarted: false };
  const completed = updateSetRaw(draft, key, setId, { ...filled, done: true, doneAt: now });

  if (!context.autoRest || draft.pausedAt !== null || inMidRound(completed, exercise, setId)) return { draft: completed, refused: false, restStarted: false };
  const totalSec = restFor(exercise, context);
  return {
    draft: { ...completed, rest: { endsAt: now + totalSec * 1000, totalSec, exerciseKey: key, setId } },
    refused: false,
    restStarted: true,
  };
}

const updateSetRaw = (draft: StrengthDraft, key: string, setId: string, patch: Partial<StrengthSet>): StrengthDraft =>
  mapExercise(draft, key, (e) => ({ ...e, sets: e.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) }));

/** True when `exercise` is in a superset and another member has a set at the same position that is not done yet. */
function inMidRound(draft: StrengthDraft, exercise: StrengthExercise, setId: string): boolean {
  if (exercise.supersetGroup === null) return false;
  const index = exercise.sets.findIndex((s) => s.id === setId);
  return draft.exercises.some(
    (other) => other.key !== exercise.key && other.supersetGroup === exercise.supersetGroup && other.sets[index] !== undefined && !other.sets[index]!.done,
  );
}

/** Starts the rest timer by hand (the timer button), `totalSec` long. */
export const startRest = (draft: StrengthDraft, now: number, totalSec: number): StrengthDraft => {
  const sec = clampRest(totalSec);
  const last = [...draft.exercises].reverse().find((e) => e.sets.some((s) => s.done));
  const setId = last ? ([...last.sets].reverse().find((s) => s.done)?.id ?? '') : '';
  return { ...draft, rest: { endsAt: now + sec * 1000, totalSec: sec, exerciseKey: last?.key ?? '', setId } };
};

/** Adds (or, negative, removes) seconds on the running rest timer; it ends when it reaches zero. */
export function adjustRest(draft: StrengthDraft, deltaSec: number, now: number): StrengthDraft {
  if (!draft.rest) return draft;
  const endsAt = draft.rest.endsAt + deltaSec * 1000;
  if (endsAt <= now) return { ...draft, rest: null };
  return { ...draft, rest: { ...draft.rest, endsAt, totalSec: Math.max(MIN_REST_SEC, draft.rest.totalSec + deltaSec) } };
}

export const skipRest = (draft: StrengthDraft): StrengthDraft => (draft.rest ? { ...draft, rest: null } : draft);

/** Seconds left on the rest timer, or null when it is not running or already over. */
export function restLeftSec(draft: Pick<StrengthDraft, 'rest' | 'pausedAt'>, now: number): number | null {
  if (!draft.rest) return null;
  const at = draft.pausedAt ?? now;
  const left = Math.ceil((draft.rest.endsAt - at) / 1000);
  return left > 0 ? left : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Finishing
// ---------------------------------------------------------------------------------------------------------------------

export interface DraftProgress {
  doneSets: number;
  totalSets: number;
}

export function draftProgress(draft: Pick<StrengthDraft, 'exercises'>): DraftProgress {
  let doneSets = 0;
  let totalSets = 0;
  for (const e of draft.exercises)
    for (const s of e.sets) {
      totalSets += 1;
      if (s.done) doneSets += 1;
    }
  return { doneSets, totalSets };
}

/**
 * The finished workout: only done sets are kept, an exercise without any is dropped, the stopwatch is stopped at `now`. Null when
 * nothing was done (there is nothing to save). `workoutStart`, `kcal` and `kcalSource` are filled in by `link.ts`.
 */
export function finishDraft(draft: StrengthDraft, now: number, fallbackName: string): StrengthWorkout | null {
  const exercises = draft.exercises
    .map((e) => ({ ...e, sets: e.sets.filter((s) => s.done) }))
    .filter((e) => e.sets.length > 0);
  if (exercises.length === 0) return null;
  const stopped = draft.pausedAt === null ? draft : resumeDraft(draft, now);
  const durationSec = Math.max(1, Math.round(elapsedMs(stopped, now) / 1000));
  return {
    id: draft.id,
    name: draft.name.trim() || fallbackName,
    startedAt: draft.startedAt,
    endedAt: now,
    durationSec,
    note: draft.note.trim(),
    routineId: draft.routineId,
    planKey: draft.planKey,
    exercises: dropLoneSupersets(exercises),
    workoutStart: null,
    kcal: null,
    kcalSource: null,
    updatedAt: now,
    deletedAt: null,
  };
}

/** The draft as a routine's exercises (a "save as routine" after a workout): done sets only, weights and reps as logged. */
export function routineExercisesOf(workout: Pick<StrengthWorkout, 'exercises'>): RoutineExercise[] {
  return workout.exercises.map((e) => ({
    exerciseId: e.exerciseId,
    restSec: e.restSec,
    note: e.note,
    supersetGroup: e.supersetGroup,
    sets: e.sets.map((s): RoutineSet => ({ type: s.type, weightKg: s.weightKg, reps: s.reps, seconds: s.seconds })),
  }));
}

/** A finished workout as a draft again (the "repeat workout" action and editing a finished workout): all its sets done. */
export function draftFromWorkout(workout: StrengthWorkout, now: number, repeat: boolean): StrengthDraft {
  const base = emptyDraft(now, workout.name);
  return {
    ...base,
    id: repeat ? base.id : workout.id,
    startedAt: repeat ? now : workout.startedAt,
    routineId: workout.routineId,
    planKey: repeat ? null : workout.planKey,
    note: repeat ? '' : workout.note,
    exercises: workout.exercises.map((e) => ({
      ...e,
      key: newId('k'),
      note: repeat ? '' : e.note,
      sets: e.sets.map((s) => ({ ...s, id: newId('s'), done: !repeat, doneAt: repeat ? null : s.doneAt })),
    })),
  };
}

/**
 * A finished workout after editing it in the logger (`draftFromWorkout(..., false)`): same id, start, end and duration, the new
 * exercises, name and note, only done sets. Null when no set is left (the screen offers to delete the workout instead).
 */
export function applyEdit(original: StrengthWorkout, draft: StrengthDraft, now: number): StrengthWorkout | null {
  const exercises = draft.exercises.map((e) => ({ ...e, sets: e.sets.filter((s) => s.done) })).filter((e) => e.sets.length > 0);
  if (exercises.length === 0) return null;
  return { ...original, name: draft.name.trim() || original.name, note: draft.note.trim(), exercises: dropLoneSupersets(exercises), updatedAt: Math.max(now, original.updatedAt + 1) };
}

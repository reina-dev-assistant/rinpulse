/**
 * The strength logger's data. Exercise ids are `ExerciseDef.id` of the library in `features/coach/exercises` (stable slugs,
 * never reused) or `custom_<base36 ms>` for an exercise the person made (`CustomExercise`, stored here).
 *
 * Everything below is plain JSON: each record is stored in `strength_record` (see `store.ts`) and travels to JoyoRogo's
 * `strength_record` table unchanged (`src/cloud/strengthSync.ts`). The server validates the same shapes
 * (`packages/api/src/lib/strength-record.ts` in the joyorogo repo): change both together.
 */
import type { Equipment, Muscle } from '@/features/coach/exercises/types';

export type { Equipment, Muscle };

/** Warm-up sets never count toward volume, PRs or muscle load. */
export type SetType = 'normal' | 'warmup' | 'drop' | 'failure';

export const SET_TYPES: readonly SetType[] = ['normal', 'warmup', 'drop', 'failure'];

export interface StrengthSet {
  /** Unique inside the workout; keeps list rows stable while sets are added, moved and removed. */
  id: string;
  type: SetType;
  /** Load in kg; null = bodyweight or not entered. */
  weightKg: number | null;
  /** Repetitions; null for a timed set or one not entered yet. */
  reps: number | null;
  /** Seconds of a timed set (plank, wall sit). */
  seconds: number | null;
  /** Rate of perceived exertion, 1 to 10 in steps of 0.5; null = not entered. */
  rpe: number | null;
  /** The completed check. Only completed sets count. */
  done: boolean;
  /** When it was checked, ms; null until then. */
  doneAt: number | null;
}

export interface StrengthExercise {
  /** Unique inside the workout. */
  key: string;
  exerciseId: string;
  note: string;
  /** Rest after a completed set of this exercise, seconds; null = the exercise's saved rest, else the default. */
  restSec: number | null;
  /** Exercises with the same number are a superset (alternate their sets); null = alone. */
  supersetGroup: number | null;
  sets: StrengthSet[];
}

export interface StrengthWorkout {
  /** `w<base36 ms>`; imported JoyoRogo sessions use `rogo:<session id>`. */
  id: string;
  name: string;
  /** Epoch ms; `Math.floor(startedAt / 1000)` is `workouts.start` of the row the workout is stored as. */
  startedAt: number;
  endedAt: number;
  /** Seconds the stopwatch ran, pauses excluded. */
  durationSec: number;
  note: string;
  /** The routine it was started from. */
  routineId: string | null;
  /** The coach plan session (`<planId>:<week>:<slot>`) it was started for. */
  planKey: string | null;
  exercises: StrengthExercise[];
  /** `workouts.start` (unix seconds) of the row this workout is stored as: its own (`imported = 1`) or the watch's it was merged with. */
  workoutStart: number | null;
  /** Burned kcal; `watch` = the watch's figure of the merged workout, `hr` = from a heart rate strap worn in the session (Keytel), `estimate` = `estimateKcal` (MET). */
  kcal: number | null;
  kcalSource: 'watch' | 'hr' | 'estimate' | null;
  updatedAt: number;
  deletedAt: number | null;
}

export interface RoutineSet {
  type: SetType;
  weightKg: number | null;
  reps: number | null;
  seconds: number | null;
}

export interface RoutineExercise {
  exerciseId: string;
  restSec: number | null;
  note: string;
  supersetGroup: number | null;
  sets: RoutineSet[];
}

export interface Routine {
  /** `r<base36 ms>`; built-in starters are not stored, they have `builtin:<slug>` ids (see `starterRoutines.ts`). */
  id: string;
  name: string;
  folderId: string | null;
  note: string;
  exercises: RoutineExercise[];
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface RoutineFolder {
  /** `f<base36 ms>`. */
  id: string;
  name: string;
  sortOrder: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface CustomExercise {
  /** `custom_<base36 ms>`. */
  id: string;
  name: string;
  primary: Muscle[];
  equipment: Equipment;
  timed: boolean;
  updatedAt: number;
  deletedAt: number | null;
}

/** Saved choices per exercise, keyed by exercise id (record kind `pref`): the rest timer length. */
export interface ExercisePref {
  /** The exercise id. */
  id: string;
  restSec: number | null;
  updatedAt: number;
  deletedAt: number | null;
}

/** What the rest timer is doing in an active workout. */
export interface RestTimer {
  /** When it ends, epoch ms. */
  endsAt: number;
  /** Its length when started, seconds (the ring's full circle; +15 s / -15 s change `endsAt` and this). */
  totalSec: number;
  /** The exercise `key` and set `id` it was started by. */
  exerciseKey: string;
  setId: string;
}

/**
 * The workout being done. Saved to the device on every change (`draft.ts`), so closing the app, a crash or a reboot
 * loses nothing; the stopwatch is derived from `startedAt` and `pausedMs`.
 */
export interface StrengthDraft {
  /** Workout id the finished workout will get. */
  id: string;
  name: string;
  startedAt: number;
  /** Total milliseconds the stopwatch was paused before `pausedAt`. */
  pausedMs: number;
  /** When the current pause began; null while running. */
  pausedAt: number | null;
  note: string;
  routineId: string | null;
  planKey: string | null;
  exercises: StrengthExercise[];
  rest: RestTimer | null;
}

export type KcalSource = NonNullable<StrengthWorkout['kcalSource']>;

/** Record kinds in `strength_record` and in the cloud. */
export type StrengthKind = 'workout' | 'routine' | 'folder' | 'exercise' | 'pref';

export interface KindDoc {
  workout: StrengthWorkout;
  routine: Routine;
  folder: RoutineFolder;
  exercise: CustomExercise;
  pref: ExercisePref;
}

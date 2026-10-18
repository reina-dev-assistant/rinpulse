import type { SQLiteDatabase } from 'expo-sqlite';

import { wibDay } from './calc';
import { getRecord, putRecord, setStrengthMeta } from './store';
import type { CustomExercise, Equipment, Muscle, Routine, RoutineExercise, SetType, StrengthExercise, StrengthSet, StrengthWorkout } from './types';

/**
 * One-time import of the person's JoyoRogo strength history (sessions, routines, custom exercises) into JoyoFit.
 * Imported records are history: workouts get the id `rogo:<session id>` and `workoutStart: null` (no `workouts` row, never
 * pushed to the watch cloud, no kcal push). Pure mapping first, then `importRogoStrength`, which only writes what is missing:
 * a record that exists locally (edited, newer, or deleted) is never overwritten or resurrected.
 */

/** JoyoRogo catalog id -> JoyoFit library slug (`coach/exercises/exercises.json`), 50 verified entries. */
export const ROGO_TO_FIT: Record<string, string> = {
  bench_press: 'barbell_bench_press',
  overhead_press: 'barbell_overhead_press',
  barbell_row: 'barbell_bent_over_row',
  deadlift: 'barbell_deadlift',
  romanian_deadlift: 'barbell_rdl',
  squat: 'barbell_back_squat',
  barbell_lunge: 'barbell_lunge',
  hip_thrust: 'barbell_hip_thrust',
  barbell_curl: 'barbell_curl',
  dumbbell_bench_press: 'db_bench_press',
  incline_dumbbell_press: 'incline_db_press',
  dumbbell_shoulder_press: 'db_shoulder_press',
  lateral_raise: 'db_lateral_raise',
  dumbbell_row: 'one_arm_db_row',
  dumbbell_curl: 'db_biceps_curl',
  hammer_curl: 'hammer_curl',
  goblet_squat: 'goblet_squat',
  bulgarian_split_squat: 'bulgarian_split_squat_db',
  dumbbell_lunge: 'db_lunge',
  dumbbell_step_up: 'step_up',
  triceps_kickback: 'db_triceps_kickback',
  leg_press: 'leg_press',
  leg_extension: 'leg_extension',
  leg_curl: 'seated_leg_curl',
  lat_pulldown: 'lat_pulldown',
  machine_chest_press: 'machine_chest_press',
  machine_shoulder_press: 'machine_shoulder_press',
  machine_row: 'machine_row',
  back_extension: 'back_extension',
  standing_calf_raise: 'standing_calf_raise_machine',
  seated_calf_raise: 'seated_calf_raise_machine',
  triceps_pushdown: 'triceps_pushdown',
  cable_fly: 'cable_crossover',
  cable_curl: 'cable_biceps_curl',
  cable_row: 'seated_cable_row',
  push_up: 'push_up',
  diamond_push_up: 'close_grip_push_up',
  pike_push_up: 'pike_push_up',
  pull_up: 'pull_up',
  chin_up: 'chin_up',
  inverted_row: 'inverted_row',
  bodyweight_squat: 'bodyweight_squat',
  wall_sit: 'wall_sit',
  glute_bridge: 'glute_bridge',
  plank: 'plank',
  side_plank: 'side_plank',
  crunch: 'crunch',
  leg_raise: 'lying_leg_raise',
  hanging_knee_raise: 'hanging_leg_raise',
  russian_twist: 'russian_twist',
};

/** JoyoRogo muscle key -> JoyoFit muscle. */
export const MUSCLE_MAP: Record<string, Muscle> = {
  dada: 'chest',
  punggung_atas: 'middle_back',
  lats: 'lats',
  bahu_depan: 'shoulders',
  bahu_samping: 'shoulders',
  bahu_belakang: 'shoulders',
  biceps: 'biceps',
  triceps: 'triceps',
  lengan_bawah: 'forearms',
  perut: 'abs',
  glutes: 'glutes',
  quadriceps: 'quadriceps',
  hamstring: 'hamstrings',
  betis: 'calves',
};

/** JoyoRogo equipment key -> JoyoFit equipment. */
export const EQUIPMENT_MAP: Record<string, Equipment> = {
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  mesin: 'machine',
  kabel: 'cable',
  bodyweight: 'bodyweight',
};

interface UnmappedExercise {
  name: string;
  primary: Muscle[];
  equipment: Equipment;
  timed: boolean;
}

/** The 14 JoyoRogo catalog exercises JoyoFit's library has no match for: imported as custom exercises. */
export const ROGO_UNMAPPED: Record<string, UnmappedExercise> = {
  incline_bench_press: { name: 'Incline bench press', primary: ['chest'], equipment: 'barbell', timed: false },
  close_grip_bench_press: { name: 'Close-grip bench press', primary: ['triceps'], equipment: 'barbell', timed: false },
  front_squat: { name: 'Front squat', primary: ['quadriceps'], equipment: 'barbell', timed: false },
  front_raise: { name: 'Front raise', primary: ['shoulders'], equipment: 'dumbbell', timed: false },
  rear_delt_fly: { name: 'Rear delt fly', primary: ['shoulders'], equipment: 'dumbbell', timed: false },
  dumbbell_fly: { name: 'Dumbbell fly', primary: ['chest'], equipment: 'dumbbell', timed: false },
  wrist_curl: { name: 'Wrist curl', primary: ['forearms'], equipment: 'dumbbell', timed: false },
  pec_deck: { name: 'Pec deck', primary: ['chest'], equipment: 'machine', timed: false },
  overhead_triceps_extension: { name: 'Overhead triceps extension', primary: ['triceps'], equipment: 'cable', timed: false },
  face_pull: { name: 'Face pull', primary: ['shoulders'], equipment: 'cable', timed: false },
  dips: { name: 'Dips', primary: ['chest', 'triceps'], equipment: 'bodyweight', timed: false },
  superman: { name: 'Superman', primary: ['middle_back'], equipment: 'bodyweight', timed: false },
  dead_hang: { name: 'Dead hang', primary: ['forearms'], equipment: 'bodyweight', timed: true },
  farmer_carry: { name: 'Farmer carry', primary: ['forearms', 'middle_back'], equipment: 'bodyweight', timed: false },
};

// ---------------------------------------------------------------------------------------------------------------------
// Wire types (`workout/exportAll`, dates are ISO strings after oRPC JSON)
// ---------------------------------------------------------------------------------------------------------------------

export interface RogoSet {
  id: string;
  exerciseId: string;
  position: number;
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
  rpe: number | null;
  setType: string;
  note: string | null;
  supersetGroup: number | null;
}

export interface RogoSession {
  id: string;
  /** WIB day, `YYYY-MM-DD`. */
  date: string;
  name: string;
  startedAt: string | number | null;
  durationMin: number | null;
  note: string | null;
  createdAt: string | number;
  kcal: number | null;
  sets: RogoSet[];
}

export interface RogoRoutineExercise {
  exerciseId: string;
  restSec?: number | null;
  note?: string | null;
  supersetGroup?: number | null;
  sets?: { setType?: string; reps?: number | null; weightKg?: number | null; durationSec?: number | null }[];
}

export interface RogoRoutine {
  id: string;
  name: string;
  note: string | null;
  exercises: RogoRoutineExercise[];
  createdAt: string | number;
  updatedAt: string | number;
}

export interface RogoCustomExercise {
  id: string;
  name: string;
  muscle: string;
  equipment: string;
  type: string;
  createdAt: string | number;
}

export interface RogoExportPage {
  sessions: RogoSession[];
  nextCursor: string | null;
  routines?: RogoRoutine[];
  customExercises?: RogoCustomExercise[];
  total?: { sessions: number; sets: number };
}

// ---------------------------------------------------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------------------------------------------------

const SET_TYPES: readonly string[] = ['normal', 'warmup', 'drop', 'failure'];

function toMs(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function setTypeOf(value: string | null | undefined): SetType {
  return SET_TYPES.includes(value ?? '') ? (value as SetType) : 'normal';
}

/** The JoyoFit exercise id of a JoyoRogo one: a library slug, else the custom exercise `custom_rogo_<id>`. */
export function fitExerciseId(rogoId: string): string {
  return ROGO_TO_FIT[rogoId] ?? `custom_rogo_${rogoId}`;
}

/** RPE in steps of 0.5 (JoyoRogo accepts any 1..10 value). */
export function roundRpe(rpe: number | null): number | null {
  if (rpe === null || !Number.isFinite(rpe)) return null;
  return Math.min(10, Math.max(1, Math.round(rpe * 2) / 2));
}

/** A JoyoRogo session, `startedAt` falls back to noon WIB of its day when missing or when the person backdated it. */
export function sessionStart(session: Pick<RogoSession, 'date' | 'startedAt'>): number {
  const started = toMs(session.startedAt);
  if (started !== null && wibDay(started) === session.date) return started;
  return Date.parse(`${session.date}T12:00:00+07:00`);
}

export function mapSession(session: RogoSession): StrengthWorkout {
  const startedAt = sessionStart(session);
  const durationSec = Math.round((session.durationMin ?? 0) * 60);
  const rows = session.sets
    .map((set, index) => ({ set, index }))
    .sort((a, b) => a.set.position - b.set.position || a.index - b.index)
    .map((r) => r.set);

  const exercises: StrengthExercise[] = [];
  let lastKey: string | null = null;
  for (const row of rows) {
    const key = `${row.exerciseId}\u0000${row.supersetGroup ?? ''}`;
    if (key !== lastKey || exercises.length === 0) {
      exercises.push({ key: `e${exercises.length}`, exerciseId: fitExerciseId(row.exerciseId), note: '', restSec: null, supersetGroup: row.supersetGroup ?? null, sets: [] });
      lastKey = key;
    }
    const exercise = exercises[exercises.length - 1]!;
    if (!exercise.note && row.note) exercise.note = row.note;
    const set: StrengthSet = {
      id: row.id,
      type: setTypeOf(row.setType),
      weightKg: row.weightKg,
      reps: row.reps,
      seconds: row.durationSec,
      rpe: roundRpe(row.rpe),
      done: true,
      doneAt: null,
    };
    exercise.sets.push(set);
  }

  return {
    id: `rogo:${session.id}`,
    name: session.name,
    startedAt,
    endedAt: startedAt + durationSec * 1000,
    durationSec,
    note: session.note ?? '',
    routineId: null,
    planKey: null,
    exercises,
    workoutStart: null,
    kcal: session.kcal ?? null,
    kcalSource: session.kcal === null || session.kcal === undefined ? null : 'estimate',
    updatedAt: toMs(session.createdAt) ?? startedAt,
    deletedAt: null,
  };
}

export function mapRoutine(routine: RogoRoutine, sortOrder: number): Routine {
  const exercises: RoutineExercise[] = (routine.exercises ?? []).map((e) => ({
    exerciseId: fitExerciseId(e.exerciseId),
    restSec: e.restSec ?? null,
    note: e.note ?? '',
    supersetGroup: e.supersetGroup ?? null,
    sets: (e.sets ?? []).map((s) => ({
      type: setTypeOf(s.setType),
      weightKg: s.weightKg ?? null,
      reps: s.reps ?? null,
      seconds: s.durationSec ?? null,
    })),
  }));
  const createdAt = toMs(routine.createdAt) ?? 0;
  return {
    id: `rogo:${routine.id}`,
    name: routine.name,
    folderId: null,
    note: routine.note ?? '',
    exercises,
    sortOrder,
    createdAt,
    updatedAt: toMs(routine.updatedAt) ?? createdAt,
    deletedAt: null,
  };
}

/** A custom exercise of the person's JoyoRogo account. */
export function mapCustomExercise(exercise: RogoCustomExercise): CustomExercise {
  const muscle = MUSCLE_MAP[exercise.muscle];
  return {
    id: `custom_rogo_${exercise.id}`,
    name: exercise.name,
    primary: muscle ? [muscle] : [],
    equipment: EQUIPMENT_MAP[exercise.equipment] ?? 'other',
    timed: exercise.type === 'duration' || exercise.type === 'distance_duration',
    updatedAt: toMs(exercise.createdAt) ?? 0,
    deletedAt: null,
  };
}

/**
 * The custom exercise standing in for a JoyoRogo exercise id that has no library slug: one of the 14 unmapped catalog
 * entries, else a bare one named by the raw id (cannot happen with today's data).
 */
export function mapUnmappedExercise(rogoId: string, updatedAt: number): CustomExercise {
  const known = ROGO_UNMAPPED[rogoId];
  return {
    id: `custom_rogo_${rogoId}`,
    name: known?.name ?? rogoId,
    primary: known ? [...known.primary] : [],
    equipment: known?.equipment ?? 'other',
    timed: known?.timed ?? false,
    updatedAt,
    deletedAt: null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------------------------------

export const ROGO_IMPORT_META = 'rogoImport';
export const ROGO_IMPORT_DISMISSED_META = 'rogoImportDismissed';
export const PAGE_LIMIT = 50;

export interface RogoImportResult {
  /** Workouts now in JoyoFit from JoyoRogo (written now or already there). */
  workouts: number;
  routines: number;
  /** Custom exercises written now. */
  exercises: number;
  /** Records written by this run (a second run writes none). */
  written: number;
  /** Records left alone: deleted or changed in JoyoFit since. */
  skipped: number;
  /** JoyoRogo has no `workout/exportAll` yet (404): nothing was imported and nothing was stored. */
  unavailable: boolean;
  aborted: boolean;
}

export interface RogoImportIo {
  /** One page of `workout/exportAll`; null when the procedure does not exist yet. */
  fetchPage?: (cursor: string | undefined, limit: number) => Promise<RogoExportPage | null>;
  /** Sessions and routines handled so far, of how many (0 when the server did not say). */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  now?: () => number;
}

/** `workout/exportAll` over the JoyoRogo session; null on 404 (not deployed yet). */
export async function fetchRogoPage(cursor: string | undefined, limit: number): Promise<RogoExportPage | null> {
  // Dynamic: `@/cloud/rogo` pulls in the native auth client, which the pure mapping and its bun tests must not load.
  const { rogoCall, RogoError } = await import('@/cloud/rogo');
  try {
    const page = await rogoCall<RogoExportPage>('workout/exportAll', cursor ? { cursor, limit } : { limit });
    return { ...page, sessions: page.sessions ?? [] };
  } catch (error) {
    if (error instanceof RogoError && error.status === 404) return null;
    throw error;
  }
}

/** What a JoyoRogo account has to import, from the first page alone; null when nothing is available (404). */
export async function probeRogoImport(
  fetchPage: NonNullable<RogoImportIo['fetchPage']> = fetchRogoPage,
): Promise<{ sessions: number; routines: number } | null> {
  const page = await fetchPage(undefined, 1);
  if (!page) return null;
  return { sessions: page.total?.sessions ?? page.sessions.length, routines: page.routines?.length ?? 0 };
}

type Outcome = 'written' | 'present' | 'skipped';

async function writeMissing(
  db: SQLiteDatabase,
  kind: 'workout' | 'routine' | 'exercise',
  doc: StrengthWorkout | Routine | CustomExercise,
): Promise<Outcome> {
  const existing = await getRecord(db, kind, doc.id);
  if (existing) {
    if (existing.deletedAt !== null) return 'skipped';
    if (existing.updatedAt > doc.updatedAt) return 'skipped';
    if (existing.updatedAt === doc.updatedAt) return 'present';
  }
  await putRecord(db, kind, doc as never);
  return 'written';
}

/**
 * Brings every JoyoRogo session, routine and custom exercise into JoyoFit. Safe to run again and to interrupt: only missing
 * records are written, and the meta `rogoImport` is stored once everything went through.
 */
export async function importRogoStrength(db: SQLiteDatabase, io: RogoImportIo = {}): Promise<RogoImportResult> {
  const fetchPage = io.fetchPage ?? fetchRogoPage;
  const now = io.now ?? Date.now;
  const result: RogoImportResult = { workouts: 0, routines: 0, exercises: 0, written: 0, skipped: 0, unavailable: false, aborted: false };

  const tally = (outcome: Outcome, key: 'workouts' | 'routines' | 'exercises') => {
    if (outcome === 'skipped') result.skipped += 1;
    else {
      if (key !== 'exercises' || outcome === 'written') result[key] += 1;
      if (outcome === 'written') result.written += 1;
    }
  };

  const custom = new Map<string, RogoCustomExercise>();
  const ensured = new Set<string>();
  const ensureExercises = async (rogoIds: Iterable<string>, at: number) => {
    for (const rogoId of rogoIds) {
      if (ROGO_TO_FIT[rogoId] || ensured.has(rogoId)) continue;
      ensured.add(rogoId);
      const own = custom.get(rogoId);
      const doc = own ? mapCustomExercise(own) : mapUnmappedExercise(rogoId, at);
      const outcome = await writeMissing(db, 'exercise', doc);
      if (outcome === 'skipped') result.skipped += 1;
      else if (outcome === 'written') {
        result.exercises += 1;
        result.written += 1;
      }
    }
  };

  let cursor: string | undefined;
  let total = 0;
  let done = 0;
  let first = true;
  do {
    if (io.signal?.aborted) {
      result.aborted = true;
      return result;
    }
    const page = await fetchPage(cursor, PAGE_LIMIT);
    if (!page) {
      result.unavailable = true;
      return result;
    }
    if (first) {
      first = false;
      for (const exercise of page.customExercises ?? []) custom.set(exercise.id, exercise);
      total = (page.total?.sessions ?? 0) + (page.routines?.length ?? 0);
      // The person's own exercises come over whether or not something uses them.
      for (const exercise of page.customExercises ?? []) {
        ensured.add(exercise.id);
        const outcome = await writeMissing(db, 'exercise', mapCustomExercise(exercise));
        if (outcome === 'skipped') result.skipped += 1;
        else if (outcome === 'written') {
          result.exercises += 1;
          result.written += 1;
        }
      }
      // Newest edit first, like the list on JoyoRogo.
      const routines = [...(page.routines ?? [])].sort((a, b) => (toMs(b.updatedAt) ?? 0) - (toMs(a.updatedAt) ?? 0));
      for (const [index, routine] of routines.entries()) {
        const mapped = mapRoutine(routine, index);
        await ensureExercises(new Set(routine.exercises.map((e) => e.exerciseId)), mapped.updatedAt);
        tally(await writeMissing(db, 'routine', mapped), 'routines');
        done += 1;
        io.onProgress?.(done, total);
      }
    }
    for (const session of page.sessions) {
      if (io.signal?.aborted) {
        result.aborted = true;
        return result;
      }
      const mapped = mapSession(session);
      await ensureExercises(new Set(session.sets.map((s) => s.exerciseId)), mapped.updatedAt);
      tally(await writeMissing(db, 'workout', mapped), 'workouts');
      done += 1;
      io.onProgress?.(done, Math.max(total, done));
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  await setStrengthMeta(
    db,
    ROGO_IMPORT_META,
    JSON.stringify({ doneAt: now(), workouts: result.workouts, routines: result.routines }),
  );
  return result;
}

export interface RogoImportMeta {
  doneAt: number;
  workouts: number;
  routines: number;
}

export interface RogoImportDismissal {
  at: number;
  forever: boolean;
}

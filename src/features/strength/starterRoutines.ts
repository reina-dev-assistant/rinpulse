/**
 * The built-in starter routines. They are data, not stored: ids are `builtin:<slug>`, a person starts one as it is or copies it to
 * "My routines" (`copyRoutine`) to change it. Names and notes are small `{id, en}` records, picked by the language at read time.
 *
 * Every exercise id is a slug of the library (`features/coach/exercises/exercises.json`); `starterRoutines.test.ts` checks that, that
 * timed exercises carry `seconds` and that sets, reps and rest stay sensible. Weights are left empty: they depend on the person.
 */
import { exerciseById } from '@/features/coach/exercises';

import type { Routine, RoutineExercise, RoutineSet } from './types';

type Locale = 'id' | 'en';
type Text = { id: string; en: string };

interface Spec {
  exerciseId: string;
  /** Working sets. */
  sets: number;
  /** Repetitions per set; for a timed exercise the seconds. */
  amount: number;
  restSec: number;
  /** A warm-up set (light, 10 repetitions) before the working sets. */
  warmup?: boolean;
  /** Exercises with the same number follow each other as a superset. */
  superset?: number;
  note?: Text;
}

interface Starter {
  slug: string;
  name: Text;
  note: Text;
  exercises: Spec[];
}

const STARTERS: readonly Starter[] = [
  {
    slug: 'full-body-a',
    name: { id: 'Full body A', en: 'Full body A' },
    note: {
      id: 'Tiga hari seminggu, bergantian dengan Full body B. Dua gerakan besar, satu tarik, satu bahu, lalu inti.',
      en: 'Three days a week, alternating with Full body B. Two big lifts, one pull, one shoulder move, then core.',
    },
    exercises: [
      { exerciseId: 'barbell_back_squat', sets: 3, amount: 8, restSec: 120, warmup: true },
      { exerciseId: 'barbell_bench_press', sets: 3, amount: 8, restSec: 120 },
      { exerciseId: 'seated_cable_row', sets: 3, amount: 10, restSec: 90 },
      { exerciseId: 'db_shoulder_press', sets: 3, amount: 10, restSec: 90 },
      { exerciseId: 'plank', sets: 3, amount: 45, restSec: 60 },
    ],
  },
  {
    slug: 'full-body-b',
    name: { id: 'Full body B', en: 'Full body B' },
    note: {
      id: 'Pasangan Full body A: tarik pinggul, dorong miring, tarik atas, satu kaki, lalu lengan.',
      en: 'Partner of Full body A: a hip hinge, an incline press, a vertical pull, a single-leg move, then arms.',
    },
    exercises: [
      { exerciseId: 'barbell_rdl', sets: 3, amount: 8, restSec: 120, warmup: true },
      { exerciseId: 'incline_db_press', sets: 3, amount: 10, restSec: 90 },
      { exerciseId: 'lat_pulldown', sets: 3, amount: 10, restSec: 90 },
      { exerciseId: 'db_lunge', sets: 3, amount: 10, restSec: 90 },
      { exerciseId: 'db_biceps_curl', sets: 3, amount: 12, restSec: 60, superset: 1 },
      { exerciseId: 'triceps_pushdown', sets: 3, amount: 12, restSec: 60, superset: 1 },
    ],
  },
  {
    slug: 'push',
    name: { id: 'Push (dorong)', en: 'Push' },
    note: {
      id: 'Dada, bahu, dan trisep. Bagian dari pola Push, Pull, Legs.',
      en: 'Chest, shoulders and triceps. Part of a Push, Pull, Legs split.',
    },
    exercises: [
      { exerciseId: 'barbell_bench_press', sets: 3, amount: 8, restSec: 120, warmup: true },
      { exerciseId: 'incline_db_press', sets: 3, amount: 10, restSec: 90 },
      { exerciseId: 'db_shoulder_press', sets: 3, amount: 10, restSec: 90 },
      { exerciseId: 'db_lateral_raise', sets: 3, amount: 12, restSec: 60 },
      { exerciseId: 'triceps_pushdown', sets: 3, amount: 12, restSec: 60 },
    ],
  },
  {
    slug: 'pull',
    name: { id: 'Pull (tarik)', en: 'Pull' },
    note: {
      id: 'Punggung dan bisep. Bagian dari pola Push, Pull, Legs.',
      en: 'Back and biceps. Part of a Push, Pull, Legs split.',
    },
    exercises: [
      { exerciseId: 'lat_pulldown', sets: 3, amount: 10, restSec: 90, warmup: true },
      { exerciseId: 'barbell_bent_over_row', sets: 3, amount: 8, restSec: 120 },
      { exerciseId: 'chest_supported_db_row', sets: 3, amount: 10, restSec: 90 },
      { exerciseId: 'band_pull_apart', sets: 3, amount: 15, restSec: 45 },
      { exerciseId: 'barbell_curl', sets: 3, amount: 10, restSec: 60 },
      { exerciseId: 'hammer_curl', sets: 3, amount: 12, restSec: 60 },
    ],
  },
  {
    slug: 'legs',
    name: { id: 'Legs (kaki)', en: 'Legs' },
    note: {
      id: 'Paha depan, paha belakang, bokong, dan betis. Bagian dari pola Push, Pull, Legs.',
      en: 'Quads, hamstrings, glutes and calves. Part of a Push, Pull, Legs split.',
    },
    exercises: [
      { exerciseId: 'barbell_back_squat', sets: 3, amount: 8, restSec: 150, warmup: true },
      { exerciseId: 'barbell_rdl', sets: 3, amount: 10, restSec: 120 },
      { exerciseId: 'leg_press', sets: 3, amount: 12, restSec: 90 },
      { exerciseId: 'seated_leg_curl', sets: 3, amount: 12, restSec: 60 },
      { exerciseId: 'standing_calf_raise_machine', sets: 3, amount: 15, restSec: 45 },
    ],
  },
  {
    slug: 'home-bodyweight',
    name: { id: 'Di rumah tanpa alat', en: 'Home, no equipment' },
    note: {
      id: 'Cukup lantai dan kursi atau bangku. Naikkan repetisi dulu, baru cari variasi yang lebih berat.',
      en: 'Just a floor and a chair or bench. Add repetitions first, then look for a harder variation.',
    },
    exercises: [
      { exerciseId: 'push_up', sets: 3, amount: 10, restSec: 60 },
      { exerciseId: 'bodyweight_squat', sets: 3, amount: 15, restSec: 60 },
      { exerciseId: 'reverse_lunge', sets: 3, amount: 10, restSec: 60 },
      { exerciseId: 'glute_bridge', sets: 3, amount: 15, restSec: 45 },
      { exerciseId: 'bench_dip', sets: 3, amount: 10, restSec: 60 },
      { exerciseId: 'plank', sets: 3, amount: 30, restSec: 45 },
    ],
  },
  {
    slug: 'home-dumbbell',
    name: { id: 'Di rumah dengan dumbbell', en: 'Home, dumbbells' },
    note: {
      id: 'Satu pasang dumbbell dan sebuah kursi sudah cukup untuk seluruh badan.',
      en: 'One pair of dumbbells and a chair are enough for the whole body.',
    },
    exercises: [
      { exerciseId: 'goblet_squat', sets: 3, amount: 10, restSec: 90, warmup: true },
      { exerciseId: 'db_floor_press', sets: 3, amount: 10, restSec: 90 },
      { exerciseId: 'one_arm_db_row', sets: 3, amount: 10, restSec: 90 },
      { exerciseId: 'db_rdl', sets: 3, amount: 10, restSec: 90 },
      { exerciseId: 'db_shoulder_press', sets: 3, amount: 10, restSec: 90 },
      { exerciseId: 'db_biceps_curl', sets: 3, amount: 12, restSec: 60, superset: 1 },
      { exerciseId: 'db_overhead_triceps_extension', sets: 3, amount: 12, restSec: 60, superset: 1 },
      { exerciseId: 'plank', sets: 3, amount: 30, restSec: 45 },
    ],
  },
];

const setOf = (spec: Spec, type: RoutineSet['type']): RoutineSet =>
  exerciseById(spec.exerciseId)?.timed
    ? { type, weightKg: null, reps: null, seconds: spec.amount }
    : { type, weightKg: null, reps: type === 'warmup' ? 10 : spec.amount, seconds: null };

function exerciseOf(spec: Spec, locale: Locale): RoutineExercise {
  const sets: RoutineSet[] = [];
  if (spec.warmup) sets.push(setOf(spec, 'warmup'));
  for (let i = 0; i < spec.sets; i += 1) sets.push(setOf(spec, 'normal'));
  return { exerciseId: spec.exerciseId, restSec: spec.restSec, note: spec.note?.[locale] ?? '', supersetGroup: spec.superset ?? null, sets };
}

function build(locale: Locale): Routine[] {
  return STARTERS.map((starter, index) => ({
    id: `builtin:${starter.slug}`,
    name: starter.name[locale],
    folderId: null,
    note: starter.note[locale],
    exercises: starter.exercises.map((spec) => exerciseOf(spec, locale)),
    sortOrder: index,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  }));
}

const cache: Partial<Record<Locale, Routine[]>> = {};

/** The built-in routines in list order, named in `locale`. The same array is returned on every call: do not change it. */
export function starterRoutines(locale: Locale): Routine[] {
  return (cache[locale] ??= build(locale));
}

/** One built-in routine by its `builtin:<slug>` id, or null. */
export function getStarterRoutine(id: string, locale: Locale): Routine | null {
  return starterRoutines(locale).find((routine) => routine.id === id) ?? null;
}

export const isStarterId = (id: string): boolean => id.startsWith('builtin:');

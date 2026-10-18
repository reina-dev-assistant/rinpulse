/**
 * The bundled exercise library: `exercises.json` (built by `scripts/build-exercises.ts`), typed, plus pure lookups.
 * Display strings (muscle, equipment, pattern, level) live in the `coach` i18n namespace; exercise names are
 * localized here because they are data.
 */
import type { Locale } from '@/i18n/locale';

import data from './exercises.json';
import {
  EXERCISE_IMAGE_BASE,
  type Equipment,
  type ExerciseDef,
  type ExerciseLevel,
  type ExercisePattern,
  type Muscle,
} from './types';

export const EXERCISES: readonly ExerciseDef[] = data as unknown as ExerciseDef[];

/** Every muscle, in the order a picker shows them (upper body, core, lower body). */
export const muscleList: readonly Muscle[] = [
  'chest', 'lats', 'middle_back', 'traps', 'shoulders', 'biceps', 'triceps', 'forearms', 'neck', 'abs', 'lower_back', 'glutes',
  'quadriceps', 'hamstrings', 'adductors', 'abductors', 'calves',
];

export type ExerciseSetting = 'home' | 'gym';

export interface ExerciseFilters {
  pattern?: ExercisePattern;
  equipment?: Equipment;
  /** Matches primary and secondary muscles. */
  muscle?: Muscle;
  level?: ExerciseLevel;
  setting?: ExerciseSetting;
}

const BY_ID = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));

export function exerciseById(id: string): ExerciseDef | undefined {
  return BY_ID.get(id);
}

export function exerciseName(def: ExerciseDef, locale: Locale): string {
  return def.name[locale];
}

/** `i` is 0-based and below `def.images`; there is no image when `images` is 0. */
export function exerciseImageUrl(id: string, i: number): string {
  return `${EXERCISE_IMAGE_BASE}/${id}/${i}.webp`;
}

/** The exercises of one pattern doable in the setting, the most fundamental first. */
export function exercisesByPattern(pattern: ExercisePattern, setting: ExerciseSetting): ExerciseDef[] {
  return EXERCISES.filter((def) => def.pattern === pattern && def[setting]).sort((a, b) => a.rank - b.rank);
}

/** Lowercase, accents and punctuation folded away: "Push-up" and "push up" meet. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Name search in the given locale and in English (gym talk mixes both), optionally narrowed by filters. Every word of the
 * query must appear in a name. Names that start with the query come first, then by rank, then by id.
 */
export function searchExercises(query: string, locale: Locale, filters: ExerciseFilters = {}): ExerciseDef[] {
  const words = fold(query).split(' ').filter(Boolean);
  const phrase = words.join(' ');
  const hits: { def: ExerciseDef; starts: boolean }[] = [];
  for (const def of EXERCISES) {
    if (filters.pattern && def.pattern !== filters.pattern) continue;
    if (filters.equipment && def.equipment !== filters.equipment) continue;
    if (filters.level && def.level !== filters.level) continue;
    if (filters.setting && !def[filters.setting]) continue;
    if (filters.muscle && !def.primary.includes(filters.muscle) && !def.secondary.includes(filters.muscle)) continue;
    const local = fold(exerciseName(def, locale));
    const english = fold(def.name.en);
    if (!words.every((word) => local.includes(word) || english.includes(word))) continue;
    hits.push({ def, starts: phrase !== '' && (local.startsWith(phrase) || english.startsWith(phrase)) });
  }
  return hits
    .sort((a, b) => Number(b.starts) - Number(a.starts) || a.def.rank - b.def.rank || a.def.id.localeCompare(b.def.id))
    .map((hit) => hit.def);
}

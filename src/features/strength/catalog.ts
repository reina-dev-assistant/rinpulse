/**
 * One lookup over the exercise library (`features/coach/exercises`, ids are stable slugs) and the person's own exercises
 * (`CustomExercise`, ids `custom_...`). Screens build a `Catalog` once per language / custom-exercise change and pass it down.
 */
import { EXERCISES } from '@/features/coach/exercises';
import type { ExerciseDef } from '@/features/coach/exercises/types';

import type { MuscleResolver } from './calc';
import type { CustomExercise, Equipment, Muscle } from './types';

export interface CatalogExercise {
  id: string;
  /** Name in each language; a custom exercise has the same text in both. */
  name: { id: string; en: string };
  primary: readonly Muscle[];
  secondary: readonly Muscle[];
  equipment: Equipment;
  /** Counted in seconds, not repetitions. */
  timed: boolean;
  custom: boolean;
  /** The library entry (steps, mistakes, images); null for a custom exercise. */
  def: ExerciseDef | null;
}

export interface SearchFilter {
  query?: string;
  muscle?: Muscle | null;
  equipment?: Equipment | null;
  /** Only the person's own exercises. */
  customOnly?: boolean;
}

export interface Catalog {
  get(id: string): CatalogExercise | null;
  /** Library exercises plus not deleted custom ones. */
  all(): readonly CatalogExercise[];
  /** The name in `locale`; null for an id nothing knows (an exercise removed from the library or deleted by the person). */
  name(id: string, locale: 'id' | 'en'): string | null;
  muscles: MuscleResolver;
  search(filter: SearchFilter, locale: 'id' | 'en'): CatalogExercise[];
}

const fromDef = (def: ExerciseDef): CatalogExercise => ({
  id: def.id,
  name: { id: def.name.id, en: def.name.en },
  primary: def.primary,
  secondary: def.secondary,
  equipment: def.equipment,
  timed: def.timed,
  custom: false,
  def,
});

const fromCustom = (c: CustomExercise): CatalogExercise => ({
  id: c.id,
  name: { id: c.name, en: c.name },
  primary: c.primary,
  secondary: [],
  equipment: c.equipment,
  timed: c.timed,
  custom: true,
  def: null,
});

/** Lowercase without accents, so "Tarik" and "tarik" and "Pulldown" find each other. */
export const normalize = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * `custom` is every custom exercise the phone knows, deleted ones included: history still shows an exercise the person later deleted, but
 * the picker (`all`, `search`) does not offer it.
 */
export function buildCatalog(custom: readonly CustomExercise[]): Catalog {
  const library = EXERCISES.map(fromDef);
  const mine = custom.map(fromCustom);
  const byId = new Map<string, CatalogExercise>([...library, ...mine].map((e) => [e.id, e]));
  const offered = [...library, ...mine.filter((_, i) => custom[i]!.deletedAt === null)];
  const searchable = offered.map((e) => ({ e, text: { id: normalize(e.name.id), en: normalize(e.name.en) } }));

  return {
    get: (id) => byId.get(id) ?? null,
    all: () => offered,
    name: (id, locale) => byId.get(id)?.name[locale] ?? null,
    muscles: (id) => {
      const e = byId.get(id);
      return e ? { primary: e.primary, secondary: e.secondary } : null;
    },
    search: ({ query, muscle, equipment, customOnly }, locale) => {
      const q = query ? normalize(query) : '';
      const words = q.split(/\s+/).filter(Boolean);
      return searchable
        .filter(({ e, text }) => {
          if (customOnly && !e.custom) return false;
          if (muscle && !e.primary.includes(muscle) && !e.secondary.includes(muscle)) return false;
          if (equipment && e.equipment !== equipment) return false;
          return words.every((w) => text.id.includes(w) || text.en.includes(w));
        })
        .sort((a, b) => Number(b.e.custom) - Number(a.e.custom) || a.e.name[locale].localeCompare(b.e.name[locale], locale))
        .map(({ e }) => e);
    },
  };
}

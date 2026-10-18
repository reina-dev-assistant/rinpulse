import type { Equipment, ExerciseLevel, ExercisePattern, Muscle } from '../../src/features/coach/exercises/types';

/**
 * One hand-picked exercise. The order inside a pattern is the rank (first = rank 1), so the first three
 * entries doable at home and the first three doable in a gym are the safest, most universal movements.
 *
 * Everything the user reads (`en`, `idn`, `se`, `si`, `me`, `mi`) is written for this app, not copied:
 * free-exercise-db only supplies the classification (primary and secondary muscles, level).
 */
export interface Cur {
  /** Slug; also the image folder. Never rename or reuse once shipped. */
  id: string;
  /** free-exercise-db id the classification comes from, or `own` when the movement is not in that dataset. */
  src: string;
  /** English display name. */
  en: string;
  /** Indonesian display name (English term when that is what gym-goers say). */
  idn: string;
  eq: Equipment;
  /** Required for `own` entries and whenever the source level is misleading. */
  lvl?: ExerciseLevel;
  /** Required for `own` entries; overrides the source when given. */
  p?: Muscle[];
  s?: Muscle[];
  /** Overrides the equipment-derived default (bodyweight, band, dumbbell = home). */
  home?: boolean;
  timed?: boolean;
  /** wger exercise-image ids (https://wger.de/api/v2/exerciseimage/<id>/), vetted by eye; none = text only. */
  img?: number[];
  /** Steps, English / Indonesian: one short sentence each. */
  se: string[];
  si: string[];
  /** Common mistakes with the fix, English / Indonesian. */
  me: string[];
  mi: string[];
}

export type Curation = Partial<Record<ExercisePattern, Cur[]>>;

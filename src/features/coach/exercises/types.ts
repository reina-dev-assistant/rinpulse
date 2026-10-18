/**
 * Exercise library types. The data is `exercises.json` (built by `scripts/build-exercises.ts` from free-exercise-db,
 * public domain, see NOTICE); images are not bundled, they load from `EXERCISE_IMAGE_BASE`.
 */

export type Muscle =
  | 'abs'
  | 'abductors'
  | 'adductors'
  | 'biceps'
  | 'calves'
  | 'chest'
  | 'forearms'
  | 'glutes'
  | 'hamstrings'
  | 'lats'
  | 'lower_back'
  | 'middle_back'
  | 'neck'
  | 'quadriceps'
  | 'shoulders'
  | 'traps'
  | 'triceps';

export type Equipment = 'bodyweight' | 'band' | 'dumbbell' | 'kettlebell' | 'barbell' | 'machine' | 'cable' | 'bench' | 'bar' | 'other';

/** Movement pattern: what a strength session picks by, so every session stays balanced. */
export type ExercisePattern =
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'push_h'
  | 'push_v'
  | 'pull_h'
  | 'pull_v'
  | 'core'
  | 'glute'
  | 'calf'
  | 'arms'
  | 'cardio';

export type ExerciseLevel = 'beginner' | 'intermediate' | 'advanced';

export interface Localized<T> {
  id: T;
  en: T;
}

export interface ExerciseDef {
  /** Stable slug (`push_up`); also the image folder. Never reused for another exercise. */
  id: string;
  /** The id in free-exercise-db this entry was built from (provenance, attribution). */
  src: string;
  name: Localized<string>;
  pattern: ExercisePattern;
  equipment: Equipment;
  /** Doable at home with no or very common equipment (bodyweight, band, a pair of dumbbells, a chair). */
  home: boolean;
  /** Doable in a gym. A bodyweight exercise is both. */
  gym: boolean;
  level: ExerciseLevel;
  primary: Muscle[];
  secondary: Muscle[];
  /** 1 = the most fundamental of its pattern and setting. Plans take the lowest ranks first. */
  rank: number;
  /** Counted in seconds (plank, wall sit), not repetitions. */
  timed: boolean;
  steps: Localized<string[]>;
  mistakes: Localized<string[]>;
  /** How many images exist: `<EXERCISE_IMAGE_BASE>/<id>/0.webp` .. `<count - 1>.webp`; 0 = none. */
  images: number;
}

/** Where the images live: static assets of the JoyoFit site (Cloudflare CDN), `site/public/exercises/`. */
export const EXERCISE_IMAGE_BASE = 'https://fit.joyorogo.com/exercises';

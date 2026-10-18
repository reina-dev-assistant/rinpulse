import type { SQLiteDatabase } from 'expo-sqlite';

import type { FitSet } from '@/features/strava/activityFile';
import { getLocale } from '@/i18n';

import { bestsByExercise, findPersonalRecords } from '../calc';
import { buildCatalog } from '../catalog';
import { getStrengthWorkoutByStart, listCustomExercises, listStrengthWorkouts } from '../store';
import { fitSetsOf } from './fitSets';
import { strengthDescription } from './strengthShareStats';

/** What a strength workout adds to its Strava upload: the title, a description and the sets of the FIT file. */
export interface StrengthUploadExtras {
  name: string;
  description: string;
  sets: FitSet[];
}

/** The extras of the strength workout stored as the `workouts` row that started at `workoutStart` (unix seconds); null when there is none. */
export async function strengthUploadExtras(db: SQLiteDatabase, workoutStart: number): Promise<StrengthUploadExtras | null> {
  const workout = await getStrengthWorkoutByStart(db, workoutStart);
  if (!workout) return null;
  const [custom, all] = await Promise.all([listCustomExercises(db), listStrengthWorkouts(db)]);
  const catalog = buildCatalog(custom);
  const records = findPersonalRecords(workout, bestsByExercise(all.filter((w) => w.startedAt < workout.startedAt)));
  const name = workout.name.trim();
  return {
    // An empty name keeps the sport name `buildUploadForm` uses.
    name,
    description: strengthDescription(workout, catalog, getLocale(), records),
    sets: fitSetsOf(workout, catalog),
  };
}

import type { SQLiteDatabase } from 'expo-sqlite';

import { sendWorkoutToStrava } from '@/cloud/strava';
import { getStravaUpload, type StravaUploadRow } from '@/db/strava';

import type { StrengthWorkout } from './types';

/** The id of the `workouts` row a strength workout is stored as (its own or the merged watch row); null when it has none (imported history). */
async function workoutRowId(db: SQLiteDatabase, workout: Pick<StrengthWorkout, 'workoutStart'>): Promise<number | null> {
  if (workout.workoutStart === null) return null;
  const row = await db.getFirstAsync<{ id: number }>('SELECT id FROM workouts WHERE start = ?', workout.workoutStart);
  return row?.id ?? null;
}

/**
 * Sends the workout to Strava as a FIT activity with its sets (`sendWorkoutToStrava`), or null when it has no `workouts` row.
 * Throws `StravaNotConnectedError` when Strava is not connected.
 */
export async function sendStrengthToStrava(db: SQLiteDatabase, workout: StrengthWorkout): Promise<StravaUploadRow | null> {
  const id = await workoutRowId(db, workout);
  return id === null ? null : sendWorkoutToStrava(db, id);
}

/** Where the workout's upload stands; null = never sent (or no `workouts` row). */
export async function strengthStravaStatus(db: SQLiteDatabase, workout: Pick<StrengthWorkout, 'workoutStart'>): Promise<StravaUploadRow | null> {
  return workout.workoutStart === null ? null : getStravaUpload(db, workout.workoutStart);
}

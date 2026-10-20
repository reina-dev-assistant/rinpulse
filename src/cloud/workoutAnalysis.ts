import type { SQLiteDatabase } from 'expo-sqlite';

import { getWorkout, listStepSamplesSince, listWorkoutPoints, type WorkoutPointRow, type WorkoutRow } from '@/db/queries';
import { startOfLocalDay } from '@/features/today/stats';
import { analyzeWorkout } from '@/features/workouts/analysis/analyze';
import { loadAnalysisHistory } from '@/features/workouts/analysis/history';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';
import { parseSummary } from '@/features/workouts/summary';
import { userMaxHr } from '@/features/workouts/useWorkoutStrain';

export interface StoredWorkout {
  workout: WorkoutRow;
  summaryJson: string;
  points: WorkoutPointRow[];
  analysis: WorkoutAnalysis;
}

/**
 * One stored workout with its points and its analysis, computed the way the workout detail screen computes it
 * (`src/app/workouts/[id].tsx`: same history, same maximum heart rate, same options, the day's per-minute samples), so a
 * cloud copy shows the numbers the phone shows. Null when the workout is no longer stored.
 */
export async function loadStoredWorkout(db: SQLiteDatabase, workoutId: number): Promise<StoredWorkout | null> {
  const found = await getWorkout(db, workoutId);
  if (!found) return null;
  const points = await listWorkoutPoints(db, workoutId);
  const day = startOfLocalDay(found.workout.start);
  const daySamples = (await listStepSamplesSince(db, day)).filter((s) => s.timestamp < day + 86400);
  const maxHr = userMaxHr();
  const summary = parseSummary(found.summaryJson);
  const history = await loadAnalysisHistory(db, found.workout, summary, maxHr);
  const analysis = analyzeWorkout(
    { workout: found.workout, summary, points, maxHr, daySamples, history },
    { includeHr: true, includeRoute: true, includeComparison: true },
  );
  return { workout: found.workout, summaryJson: found.summaryJson, points, analysis };
}

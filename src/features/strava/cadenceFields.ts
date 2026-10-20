import type { WorkoutRow } from '@/db/queries';
import { analysisAvgSpeedMs, analysisDistanceM } from '@/features/workouts/analysis/analyze';
import { cadenceFigures } from '@/features/workouts/analysis/cadence';
import { buildGrid, type AnalysisPoint } from '@/features/workouts/analysis/series';
import { sportKind } from '@/features/workouts/analysis/sport';
import type { WorkoutSummary } from '@/features/workouts/summary';

import type { StravaWorkout } from './activityFile';

/**
 * The cadence (steps per minute on foot, rpm on a bike) and the average step length of the workout as the workout screen shows
 * them (`cadenceFigures` on the same time grid), for the Strava FIT file: the samples, else the summary of a FIT import or the
 * watch (its sample averages, its per-km blocks), else the step count over the moving time. A bike's own analysis
 * (`rideUploadFields`) overrides the cadence afterwards.
 */
export function stravaCadenceFields(
  workout: WorkoutRow,
  summary: WorkoutSummary,
  points: readonly AnalysisPoint[],
): Pick<StravaWorkout, 'avgCadence' | 'maxCadence' | 'avgStepLengthM'> {
  const kind = sportKind(workout.sportName, summary.kind);
  const grid = buildGrid({ start: workout.start, end: workout.end, duration: workout.duration, distance: workout.distance, kind, points });
  const avgSpeedMs = analysisAvgSpeedMs(analysisDistanceM(workout, grid), grid.movingSec, summary);
  const { avgCad, maxCad, avgStrideM } = cadenceFigures({ kind, summary, steps: workout.steps, grid, points, avgSpeedMs });
  return { avgCadence: avgCad, maxCadence: maxCad, avgStepLengthM: avgStrideM };
}

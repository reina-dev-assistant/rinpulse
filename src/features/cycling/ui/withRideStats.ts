import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';

import type { RideAnalysis } from '../types';

/**
 * The generic analysis with the ride's own figures in `stats`: normalized power, average power and speed from the 1 Hz series are
 * more accurate than the ones read off the 600-step grid. Average speed is the moving speed. A figure the ride does not have (no power
 * meter, no speed) keeps the generic value. Pure; the input is not changed.
 */
export function withRideStats(analysis: WorkoutAnalysis, ride: RideAnalysis): WorkoutAnalysis {
  const { stats } = analysis;
  return {
    ...analysis,
    stats: {
      ...stats,
      normalizedPower: ride.power?.normalized ?? stats.normalizedPower,
      avgPower: ride.power?.avg ?? stats.avgPower,
      avgSpeedMs: ride.speed.avgMovingMs ?? stats.avgSpeedMs,
      maxSpeedMs: ride.speed.maxMs ?? stats.maxSpeedMs,
    },
  };
}

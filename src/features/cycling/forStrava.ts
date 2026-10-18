import type { StravaWorkout } from '@/features/strava/activityFile';
import type { WorkoutSummary } from '@/features/workouts/summary';

import { analyzeRide, type RideInput } from './analyzeRide';
import { isRide } from './store';
import type { RideProfile } from './types';

/**
 * What a bike workout adds to its Strava FIT file: the figures of `analyzeRide` where they are more exact than the recorder's
 * (normalized power from the 1 Hz samples, the cadence mean without coasting, the 3 s maximum speed, the ascent with the bike's
 * smoothing) and the session fields FIT has for TSS, IF, FTP, work, pedal balance and grade. Empty for every other sport.
 * The Strava activity type (Ride, VirtualRide, EBikeRide) comes from `stravaSport`.
 */
export function rideUploadFields(
  workout: RideInput['workout'],
  summary: WorkoutSummary,
  points: RideInput['points'],
  profile: RideProfile,
): Partial<StravaWorkout> {
  if (!isRide(workout)) return {};
  const ride = analyzeRide({ workout, summary, points, profile });
  const power = ride.power;
  return {
    ...(ride.elevation ? { elevationGain: ride.elevation.gainM, elevationLoss: ride.elevation.lossM } : {}),
    maxSpeed: ride.speed.maxMs ?? summary.maxSpeed,
    ...(power ? { avgPower: power.avg, maxPower: power.max, normalizedPower: power.normalized } : {}),
    ...(ride.cadence?.avg != null ? { avgCadence: ride.cadence.avg, maxCadence: ride.cadence.max } : {}),
    ride: {
      tss: power?.tss ?? null,
      intensityFactor: power?.intensityFactor ?? null,
      ftp: power?.tss != null ? power.ftp : null,
      workKj: power?.workKj ?? null,
      balanceLeftPct: power?.balanceLeftPct ?? null,
      avgGradePct: ride.elevation?.avgGradePct ?? null,
      maxGradePct: ride.elevation?.maxGradePct ?? null,
      minGradePct: ride.elevation?.minGradePct ?? null,
    },
  };
}

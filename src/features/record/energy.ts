// Energy of a phone-recorded session. With a heart rate strap the figure comes from the heart rate (Keytel et al. 2005, the same equation
// the watch link uses for a phone-side session, LiveWorkoutCodec); without one it is MET x body weight, like a manual workout.
// No React Native imports: runs under bun test.

export type Sex = 'male' | 'female' | 'unknown';

export interface EnergyProfile {
  weightKg: number;
  /** Whole years. */
  age: number;
  sex: Sex;
}

/** Below this the equation turns negative for light effort; a body at rest burns about this much anyway. */
export const REST_KCAL_PER_MIN = 1.2;

/**
 * kcal per minute at a heart rate: male (-55.0969 + 0.6309 HR + 0.1988 kg + 0.2017 age) / 4.184, female
 * (-20.4022 + 0.4472 HR - 0.1263 kg + 0.074 age) / 4.184, unknown the mean of the two. Never below `REST_KCAL_PER_MIN`.
 */
export function keytelKcalPerMin(hr: number, p: EnergyProfile): number {
  const male = (-55.0969 + 0.6309 * hr + 0.1988 * p.weightKg + 0.2017 * p.age) / 4.184;
  const female = (-20.4022 + 0.4472 * hr - 0.1263 * p.weightKg + 0.074 * p.age) / 4.184;
  const value = p.sex === 'male' ? male : p.sex === 'female' ? female : (male + female) / 2;
  return Math.max(REST_KCAL_PER_MIN, value);
}

/** kcal per second at a MET value (1 MET = 1 kcal per kg per hour). */
export function metKcalPerSec(met: number, weightKg: number): number {
  return (met * weightKg) / 3600;
}

/** Share of a session that has a heart rate from which the heart rate figure is trusted over the MET estimate. */
export const HR_COVERAGE_MIN = 0.5;

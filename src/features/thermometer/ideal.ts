/**
 * What a bedroom reading means for sleep: the ideal range and a plain status for the temperature and for the humidity. The numbers and
 * where they come from are in docs/thermometer.md ("Ideal ranges"); the status words are `thermometer:ideal.*` in the locale files.
 *
 * A reading is compared at the 0.1 it is shown with, so the figure on screen and its status never disagree (25.0 is ideal, 25.1 is warm).
 */

/** Ideal bedroom temperature, Celsius, both ends inclusive. */
export const IDEAL_TEMP_C = { min: 18, max: 25 } as const;
/** Ideal bedroom relative humidity, percent, both ends inclusive. */
export const IDEAL_RH_PCT = { min: 30, max: 50 } as const;

/** Colder than this is too cold for sleep; from here up to the ideal minimum it is a bit cool. */
const TEMP_TOO_COLD_C = 16;
/** Warmer than this is too hot for sleep; from the ideal maximum up to and including this it is a bit warm. */
const TEMP_TOO_HOT_C = 29;
/** Above this is too humid; from the ideal maximum up to and including this it is a bit humid. Below the ideal minimum is too dry. */
const RH_TOO_HUMID_PCT = 60;

export type TempStatus = 'cold' | 'cool' | 'ideal' | 'warm' | 'hot';
export type HumidityStatus = 'dry' | 'ideal' | 'damp' | 'wet';

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function tempStatus(tempC: number): TempStatus {
  const t = round1(tempC);
  if (t < TEMP_TOO_COLD_C) return 'cold';
  if (t < IDEAL_TEMP_C.min) return 'cool';
  if (t <= IDEAL_TEMP_C.max) return 'ideal';
  if (t <= TEMP_TOO_HOT_C) return 'warm';
  return 'hot';
}

export function humidityStatus(rhPct: number): HumidityStatus {
  const rh = round1(rhPct);
  if (rh < IDEAL_RH_PCT.min) return 'dry';
  if (rh <= IDEAL_RH_PCT.max) return 'ideal';
  if (rh <= RH_TOO_HUMID_PCT) return 'damp';
  return 'wet';
}

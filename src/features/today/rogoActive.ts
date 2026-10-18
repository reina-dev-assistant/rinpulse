import { localDate } from '@/features/meals/mealMap';
import { dayBounds, dayStarts } from '@/features/trends/series';

/** JoyoRogo's ceiling for `activeKcal` of one day in `fitness.upsertScores`. */
export const ROGO_MAX_ACTIVE_KCAL = 20_000;

/** The part of a stored per-minute sample the active-energy total needs: `calories` are small calories (1/1000 kcal). */
export interface CalorieSample {
  timestamp: number;
  calories: number;
}

/**
 * One day's active energy in whole kcal as JoyoRogo accepts it, or null when there is nothing to send: a missing,
 * non-finite or non-positive total is "no data" (JoyoRogo keeps what it stored; a 0 would claim the watch measured none),
 * and a total past the ceiling is pinned to it.
 */
export function cleanActiveKcal(kcal: number | null | undefined): number | null {
  if (typeof kcal !== 'number' || !Number.isFinite(kcal)) return null;
  const rounded = Math.min(ROGO_MAX_ACTIVE_KCAL, Math.round(kcal));
  return rounded > 0 ? rounded : null;
}

/**
 * The watch's all-day active energy per local calendar day: the sum of the samples' small calories divided by 1000, the
 * same arithmetic as `sumTotals` and the amount written to Health Connect as ActiveCaloriesBurned. Keys are `YYYY-MM-DD`,
 * the day key `rogoScoreDays` uses. Covers the `days` days ending with the one that starts at `dayStart` (local midnight, unix
 * seconds); samples outside that span are ignored, and a day with no energy is absent. The caller passes the watch's own
 * samples only (`imported = 0`).
 */
export function activeKcalByDate(samples: readonly CalorieSample[], dayStart: number, days: number): Map<string, number> {
  const starts = dayStarts(dayStart, days);
  const bounds = dayBounds(starts);
  const sums = new Array<number>(starts.length).fill(0);
  for (const s of samples) {
    if (!Number.isFinite(s.timestamp) || !Number.isFinite(s.calories) || s.calories <= 0) continue;
    for (let i = 0; i < starts.length; i++) {
      if (s.timestamp >= bounds[i] && s.timestamp < bounds[i + 1]) {
        sums[i] += s.calories;
        break;
      }
    }
  }
  const out = new Map<string, number>();
  starts.forEach((start, i) => {
    const kcal = cleanActiveKcal(sums[i] / 1000);
    if (kcal !== null) out.set(localDate(start * 1000), kcal);
  });
  return out;
}

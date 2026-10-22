import type { SQLiteDatabase } from 'expo-sqlite';

import { listRestingHeartRateByDay } from '@/db/queries';
import { startOfLocalDay } from '@/features/today/stats';
import { dayBounds, dayStarts } from '@/features/trends/series';

import { MAX_HR_MAX, MAX_HR_MIN, peakHeartRate, suggestZones, typicalResting, type HrZoneSuggestion } from './zones';

/** The resting heart rate is the typical one of this many days: the watch reports one per day, a cold or a bad night moves a single day. */
const RESTING_DAYS = 14;
/** The highest few workout maxima are enough to tell a real peak from one sensor spike. */
const PEAK_CANDIDATES = 5;

/**
 * Looks for numbers in the person's own data: the highest heart rate any workout reached and the typical resting heart rate of the
 * last two weeks. Only ever offered on the zones screen ("Hitung dari data"); nothing here changes a setting.
 */
export async function loadZoneSuggestion(db: SQLiteDatabase, age: number): Promise<HrZoneSuggestion> {
  const maxima = await db.getAllAsync<{ maxHr: number }>(
    'SELECT max_hr AS maxHr FROM workouts WHERE max_hr BETWEEN ? AND ? ORDER BY max_hr DESC LIMIT ?',
    MAX_HR_MIN,
    MAX_HR_MAX,
    PEAK_CANDIDATES,
  );
  const days = dayStarts(startOfLocalDay(Math.floor(Date.now() / 1000)), RESTING_DAYS);
  const resting = await listRestingHeartRateByDay(db, dayBounds(days));
  return suggestZones(peakHeartRate(maxima.map((row) => row.maxHr)), typicalResting([...resting.values()]), age);
}

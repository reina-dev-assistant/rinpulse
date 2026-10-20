import type { SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { loadRunEfforts, recentRuns } from '@/features/fitness/runEfforts';
import type { FitnessWorkout } from '@/features/fitness/useFitnessData';
import { thresholdPaceFromEfforts } from '@/features/workouts/analysis/zones';

/**
 * Your threshold pace (seconds per km): the same figure the workout analysis uses (`thresholdPaceFromEfforts` over the runs
 * of the last `THRESHOLD_WINDOW_DAYS` days, GPS best efforts); null until there are enough runs.
 */
export function useThresholdPace(db: SQLiteDatabase, workouts: readonly FitnessWorkout[] | null, nowSec: number | null): number | null {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    if (!workouts || nowSec === null) return;
    let cancelled = false;
    loadRunEfforts(db, recentRuns(workouts, nowSec)).then(
      (efforts) => {
        if (!cancelled) setValue(thresholdPaceFromEfforts([], efforts));
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [db, workouts, nowSec]);
  return value;
}

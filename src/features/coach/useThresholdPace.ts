import type { SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { loadRunEfforts, recentRuns } from '@/features/fitness/runEfforts';
import type { FitnessWorkout } from '@/features/fitness/useFitnessData';
import { thresholdCandidates, thresholdPace } from '@/features/workouts/analysis/zones';

/** Your threshold pace (seconds per km) from the runs of the last 90 days (GPS best efforts); null until there are enough runs. */
export function useThresholdPace(db: SQLiteDatabase, workouts: readonly FitnessWorkout[] | null, nowSec: number | null): number | null {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    if (!workouts || nowSec === null) return;
    let cancelled = false;
    loadRunEfforts(db, recentRuns(workouts, nowSec)).then(
      (efforts) => {
        if (!cancelled) setValue(thresholdPace(thresholdCandidates([], efforts)));
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [db, workouts, nowSec]);
  return value;
}

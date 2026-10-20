import type { SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { listWorkoutPoints, type WorkoutRow } from '@/db/queries';
import type { EffortSeconds } from '@/features/workouts/analysis/efforts';
import { cachedEfforts, effortsOf, inEffortWindow } from '@/features/workouts/analysis/threshold';
import type { FitnessWorkout } from '@/features/fitness/useFitnessData';

/**
 * Runs of the last `THRESHOLD_WINDOW_DAYS` days (the window the workout analysis takes its threshold pace over as well),
 * from the workouts already loaded.
 */
export function recentRuns(workouts: readonly FitnessWorkout[], nowSec: number): WorkoutRow[] {
  return workouts.filter(({ workout, summary }) => inEffortWindow(workout, summary.kind, 'run', nowSec + 1)).map(({ workout }) => workout);
}

/** One best-effort set per run, using the workout analysis's own `bestEffortsForHistory`; runs with no GPS stretch of 400 m or more are left out. */
export async function loadRunEfforts(db: SQLiteDatabase, runs: readonly WorkoutRow[]): Promise<EffortSeconds[]> {
  const out: EffortSeconds[] = [];
  for (const run of runs) {
    const efforts = cachedEfforts(run) ?? effortsOf(run, await listWorkoutPoints(db, run.id));
    if (Object.keys(efforts).length > 0) out.push(efforts);
  }
  return out;
}

/** Best efforts of `runs`, null while they are being read (they come from GPS points, one query per run). */
export function useRunEfforts(db: SQLiteDatabase, runs: readonly WorkoutRow[] | null): EffortSeconds[] | null {
  const [state, setState] = useState<{ runs: readonly WorkoutRow[]; efforts: EffortSeconds[] } | null>(null);
  useEffect(() => {
    if (runs === null) return;
    let cancelled = false;
    loadRunEfforts(db, runs).then(
      (efforts) => {
        if (!cancelled) setState({ runs, efforts });
      },
      () => {
        if (!cancelled) setState({ runs, efforts: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, runs]);
  return state && state.runs === runs ? state.efforts : null;
}

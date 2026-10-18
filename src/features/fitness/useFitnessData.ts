import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import {
  listDayHeartLoad,
  listHrvReadingsSince,
  listMetricSince,
  listRestingHeartRateByDay,
  listSleepSince,
  listStepSamplesSince,
  listWorkoutsSince,
  type HrvReadingRow,
  type WorkoutRow,
} from '@/db/queries';
import { errorMessage } from '@/format';
import { startOfLocalDay } from '@/features/today/stats';
import { withRideLoad } from '@/features/cycling/load';
import { strainFromLoads, zoneThresholds, type DayStrain } from '@/features/today/strain';
import { addDays, dayBounds, dayStarts } from '@/features/trends/series';
import { parseSummary, type WorkoutSummary } from '@/features/workouts/summary';
import { userMaxHr } from '@/features/workouts/useWorkoutStrain';
import type { SleepSegment, StepSample } from '@/wear';

/** `today` is what the Today cards need; `full` adds the longer history the Kebugaran screen works from. */
export type FitnessScope = 'today' | 'full';

const DEPTH: Record<FitnessScope, { strainDays: number; workoutDays: number; hrvDays: number }> = {
  today: { strainDays: 31, workoutDays: 8, hrvDays: 31 },
  full: { strainDays: 60, workoutDays: 120, hrvDays: 70 },
};
/** Nights of sleep for the debt, plus the one being judged. */
const SLEEP_DAYS = 9;

export interface FitnessWorkout {
  workout: WorkoutRow;
  summary: WorkoutSummary;
}

export interface FitnessData {
  nowSec: number;
  dayStart: number;
  maxHr: number;
  /** Per day with heart rate, oldest first. */
  strain: DayStrain[];
  resting: Map<number, number>;
  /** Newest first. */
  workouts: FitnessWorkout[];
  hrv: HrvReadingRow[];
  sleep: SleepSegment[];
  /** Today's per-minute samples, oldest first. */
  samples: StepSample[];
  /** Stress readings (`emotion`) since yesterday. */
  stress: { ts: number; value: number }[];
}

interface FitnessState {
  data: FitnessData | null;
  error: string | null;
}

/** Reads what the fitness metrics need whenever the screen gains focus or `dataVersion` changes (after a sync). */
export function useFitnessData(dataVersion: number, scope: FitnessScope): FitnessState {
  const db = useSQLiteContext();
  const [state, setState] = useState<FitnessState>({ data: null, error: null });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const nowSec = Math.floor(Date.now() / 1000);
      const dayStart = startOfLocalDay(nowSec);
      const maxHr = userMaxHr();
      const depth = DEPTH[scope];
      const bounds = dayBounds(dayStarts(dayStart, depth.strainDays + 1));
      Promise.all([
        listDayHeartLoad(db, bounds, zoneThresholds(maxHr)),
        listRestingHeartRateByDay(db, bounds),
        listWorkoutsSince(db, nowSec - depth.workoutDays * 86400, nowSec + 1, -1),
        listHrvReadingsSince(db, dayStart - depth.hrvDays * 86400),
        listSleepSince(db, nowSec - SLEEP_DAYS * 86400),
        listStepSamplesSince(db, dayStart),
        listMetricSince(db, 'emotion', addDays(dayStart, -1)),
      ]).then(
        async ([loads, resting, workouts, hrv, sleep, samples, stress]) => {
          const strain = await withRideLoad(db, strainFromLoads(loads), nowSec);
          if (cancelled) return;
          setState({
            data: {
              nowSec,
              dayStart,
              maxHr,
              strain,
              resting,
              workouts: workouts.map(({ workout, summaryJson }) => ({ workout, summary: parseSummary(summaryJson) })),
              hrv,
              sleep,
              samples,
              stress,
            },
            error: null,
          });
        },
        (e: unknown) => {
          if (!cancelled) setState({ data: null, error: errorMessage(e) });
        },
      );
      return () => {
        cancelled = true;
      };
      // dataVersion re-runs the query after each stored sync.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, dataVersion, scope]),
  );

  return state;
}

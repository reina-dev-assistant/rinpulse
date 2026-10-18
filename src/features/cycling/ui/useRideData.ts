import type { SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

import type { WorkoutPointRow, WorkoutRow } from '@/db/queries';
import { errorMessage } from '@/format';
import type { WorkoutSummary } from '@/features/workouts/summary';

import { analyzeRide } from '../analyzeRide';
import { getFtp, rideProfile, setFtp } from '../settings';
import { allTimeCurve, listRideMetrics, recordsOf, saveRideMetrics, syncRideMetrics, type AllTimeBest } from '../store';
import type { RideAnalysis } from '../types';

/** Rides whose figures are filled in per screen visit, newest first: each is read once, then cached in `ride_metrics`. */
const SYNC_LIMIT = 20;

export interface RideInputs {
  workout: WorkoutRow;
  summary: WorkoutSummary;
  points: readonly WorkoutPointRow[];
}

export interface RideData {
  /** Null until the analysis has run (or when it failed, see `error`, or the workout is not a ride). */
  ride: RideAnalysis | null;
  /** The best power of each duration over the stored rides; empty until the background sync is done. */
  allTime: AllTimeBest[];
  /** Key durations this ride holds the all-time best for. */
  records: number[];
  /** The FTP in use, watts; null when none. */
  ftp: number | null;
  /** The body weight W/kg is worked out from, kg. */
  weightKg: number | null;
  error: string | null;
  /** Stores a new FTP (null clears it) and re-runs the analysis with it. */
  setFtpAndRefresh: (watts: number | null) => void;
}

interface Computed {
  /** The workout these figures are for: a state left over from another workout is not shown. */
  source: WorkoutRow | null;
  ride: RideAnalysis | null;
  allTime: AllTimeBest[];
  records: number[];
  weightKg: number | null;
  error: string | null;
}

const EMPTY: Computed = { source: null, ride: null, allTime: [], records: [], weightKg: null, error: null };

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * The cycling analysis of a ride on screen: the ride figures first (so the screen paints with them), then the ride's cached
 * metrics and the figures of the other rides, so the all-time power curve and the records are ready a moment later. Pass null for a
 * workout that is not a ride. Runs again when the FTP changes.
 */
export function useRideData(db: SQLiteDatabase, input: RideInputs | null): RideData {
  const [ftp, setFtpState] = useState<number | null>(getFtp);
  const [state, setState] = useState<Computed>(EMPTY);
  const points = input?.points;
  const workout = input?.workout;
  const summary = input?.summary;

  useEffect(() => {
    if (!workout || !summary || !points) return;
    let cancelled = false;
    (async () => {
      await nextTick();
      if (cancelled) return;
      const profile = { ...rideProfile(), ftp };
      let ride: RideAnalysis;
      try {
        ride = analyzeRide({ workout, summary, points, profile });
      } catch (e) {
        if (!cancelled) setState({ ...EMPTY, source: workout, weightKg: profile.weightKg, error: errorMessage(e) });
        return;
      }
      if (cancelled) return;
      setState({ ...EMPTY, source: workout, ride, weightKg: profile.weightKg });
      // The other figures are an extra: a failure here leaves the ride as it is, without records.
      try {
        await nextTick();
        await saveRideMetrics(db, workout.start, ride);
        await nextTick();
        if (cancelled) return;
        await syncRideMetrics(db, profile, { sinceSec: 0, limit: SYNC_LIMIT });
        const rows = await listRideMetrics(db, 0);
        if (!cancelled) setState({ ...EMPTY, source: workout, ride, allTime: allTimeCurve(rows), records: recordsOf(workout.start, rows), weightKg: profile.weightKg });
      } catch {
        // Curve and records stay empty; the ride above is complete without them.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, workout, summary, points, ftp]);

  const setFtpAndRefresh = useCallback((watts: number | null) => {
    setFtp(watts);
    setFtpState(getFtp());
  }, []);

  const { source: _source, ...figures } = state.source === workout ? state : EMPTY;
  return { ...figures, ftp, setFtpAndRefresh };
}

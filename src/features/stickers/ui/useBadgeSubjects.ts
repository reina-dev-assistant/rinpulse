import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';

import { listWorkouts, type WorkoutRow } from '@/db/queries';
import { localDay } from '@/features/coach/time';
import { listStrengthWorkouts } from '@/features/strength/store';
import type { StrengthWorkout } from '@/features/strength/types';
import { workoutTimes } from '@/features/workouts/times';
import { useLocale } from '@/i18n';

import { buildBadgeSubjects, currentStreakDays, longestStreak, type MilestoneTotals } from '../data/badge';
import type { StickerSubject } from '../subject';

/**
 * All-time totals from the stored rows. A strength workout that is merged with (or stored as) a watch row counts once,
 * through that row; one without a row adds its own count, duration and day.
 */
export function milestoneTotals(workouts: readonly WorkoutRow[], strength: readonly StrengthWorkout[], nowMs: number): MilestoneTotals {
  const rows = workouts.filter((w) => w.complete);
  const watchStarts = new Set(rows.map((w) => w.start));
  const days: string[] = [];
  let totalDistanceM = 0;
  let totalMovingSec = 0;
  let workoutCount = 0;
  for (const w of rows) {
    workoutCount += 1;
    if (w.distance > 0) totalDistanceM += w.distance;
    const { movingSec } = workoutTimes(w);
    if (Number.isFinite(movingSec) && movingSec > 0) totalMovingSec += movingSec;
    days.push(localDay(w.start));
  }
  for (const s of strength) {
    if (s.deletedAt !== null && s.deletedAt !== undefined) continue;
    if (s.workoutStart !== null && watchStarts.has(s.workoutStart)) continue;
    workoutCount += 1;
    if (s.durationSec > 0) totalMovingSec += s.durationSec;
    days.push(localDay(s.startedAt / 1000));
  }
  return {
    totalDistanceM,
    workoutCount,
    totalMovingSec,
    streakDays: currentStreakDays(days, localDay(nowMs / 1000)),
    bestStreakDays: longestStreak(days),
    nowMs,
  };
}

/**
 * The earned badges (best first), empty while loading or when nothing is crossed yet. On focus and after each sync it
 * reads every workout row (no summary JSON) and every strength record, and folds them into totals once.
 */
export function useBadgeSubjects(dataVersion = 0): StickerSubject[] {
  const db = useSQLiteContext();
  const locale = useLocale();
  const [totals, setTotals] = useState<MilestoneTotals | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([listWorkouts(db), listStrengthWorkouts(db)]).then(
        ([rows, strength]) => {
          if (!cancelled) setTotals(milestoneTotals(rows, strength, Date.now()));
        },
        () => {
          if (!cancelled) setTotals(null);
        },
      );
      return () => {
        cancelled = true;
      };
      // dataVersion re-runs the queries after each stored sync.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, dataVersion]),
  );

  return useMemo(() => (totals ? buildBadgeSubjects(totals, locale) : []), [totals, locale]);
}

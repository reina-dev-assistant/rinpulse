import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';

import { listDayHeartLoad, listStepSamplesSince, listWorkouts } from '@/db/queries';
import { mondayOf } from '@/features/fitness/intensityMinutes';
import { listStrengthWorkoutsBetween } from '@/features/strength/store';
import { startOfLocalDay } from '@/features/today/stats';
import { strainFromLoads } from '@/features/today/strain';
import { addDays, dayBounds, dayStarts } from '@/features/trends/series';
import { userHrZones } from '@/features/hrzones/settings';
import { useLocale } from '@/i18n';

import { buildWeekSubject, type WeekSubjectInput } from '../data/week';
import type { StickerSubject } from '../subject';

/** Days of heart-rate load read: the acute week plus the four weeks the chronic average comes from. */
const LOAD_DAYS = 35;
/** The chronic average needs this many days with strain among its 28 days, else it would flatter or scare. */
const MIN_CHRONIC_DAYS = 14;

/**
 * The current week (local Monday start) as a sticker subject, or null while loading and when there is nothing to draw.
 * On focus and after each sync it runs: the workout rows (no summary JSON), the week's strength records, one SQL
 * aggregate of heart-rate load over 35 days, and the week's per-minute step rows (for the step total).
 */
export function useWeekSubject(dataVersion = 0): StickerSubject | null {
  const db = useSQLiteContext();
  const locale = useLocale();
  const [input, setInput] = useState<WeekSubjectInput | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const nowMs = Date.now();
      const todayStart = startOfLocalDay(Math.floor(nowMs / 1000));
      const weekStart = mondayOf(todayStart);
      const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
      const weekEnd = addDays(weekStart, 7);
      const loadDays = dayStarts(todayStart, LOAD_DAYS);
      const zones = userHrZones();
      Promise.all([
        listWorkouts(db),
        listStrengthWorkoutsBetween(db, weekStart * 1000, weekEnd * 1000),
        listDayHeartLoad(db, dayBounds(loadDays), zones.bounds),
        listStepSamplesSince(db, weekStart),
      ]).then(
        ([rows, strength, loads, samples]) => {
          if (cancelled) return;
          const strainByDay = new Map(strainFromLoads(loads).map((d) => [d.day, d.strain]));
          const steps = new Array<number>(7).fill(0);
          for (const s of samples) {
            if (s.timestamp >= weekEnd || !(s.steps > 0)) continue;
            let d = 6;
            while (d > 0 && s.timestamp < weekDays[d]) d--;
            steps[d] += s.steps;
          }
          const trailing = loadDays.slice(-7).map((d) => strainByDay.get(d));
          const earlier = loadDays.slice(0, 28).map((d) => strainByDay.get(d));
          const earlierWithData = earlier.filter((v) => v !== undefined).length;
          const sum = (xs: readonly (number | undefined)[]) => xs.reduce<number>((a, v) => a + (v ?? 0), 0);
          setInput({
            weekStartSec: weekStart,
            workouts: rows.filter((w) => w.complete && w.start >= weekStart && w.start < weekEnd),
            strength,
            dayStrain: weekDays.map((d) => strainByDay.get(d) ?? null),
            steps,
            acute: sum(trailing),
            chronicWeekly: earlierWithData >= MIN_CHRONIC_DAYS ? sum(earlier) / 4 : undefined,
            nowMs,
          });
        },
        () => {
          if (!cancelled) setInput(null);
        },
      );
      return () => {
        cancelled = true;
      };
      // dataVersion re-runs the queries after each stored sync.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, dataVersion]),
  );

  return useMemo(() => (input ? buildWeekSubject(input, locale) : null), [input, locale]);
}

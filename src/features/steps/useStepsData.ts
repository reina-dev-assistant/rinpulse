import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { listDailySteps, listStepSamplesBetween } from '@/db/queries';
import { errorMessage } from '@/format';
import { daysOf, type Period } from '@/features/metric/range';
import { hourlySteps, startOfLocalDay } from '@/features/today/stats';
import { dayBounds } from '@/features/trends/series';

/** Steps per local day for `days` (consecutive local midnights); re-read when the screen gains focus and after each sync. Null until read. */
export function useDailySteps(days: readonly number[], dataVersion: number): ReadonlyMap<number, number> | null {
  const db = useSQLiteContext();
  const [daily, setDaily] = useState<ReadonlyMap<number, number> | null>(null);
  const key = `${days[0]}:${days.length}`;
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listDailySteps(db, dayBounds(days)).then(
        (value) => !cancelled && setDaily(value),
        () => !cancelled && setDaily(new Map()),
      );
      return () => {
        cancelled = true;
      };
      // `key` stands for `days`; `dataVersion` re-runs the query after each stored sync.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, key, dataVersion]),
  );
  return daily;
}

export interface StepsPeriodData {
  period: Period;
  daily: ReadonlyMap<number, number>;
  /** The day's steps per hour for `D`; null for the other ranges. */
  hourly: number[] | null;
  nowSec: number;
  todayStart: number;
}

interface State {
  data: StepsPeriodData | null;
  error: string | null;
}

/**
 * The steps behind one period of the detail screen: per-day sums in SQL for `W` to `Y` (the minutes themselves are never read),
 * and the one day's minutes folded into hours for `D`. The previous period stays on screen until the next one has loaded.
 */
export function useStepsPeriod(period: Period, dataVersion: number): State {
  const db = useSQLiteContext();
  const [state, setState] = useState<State>({ data: null, error: null });
  const { range, from, to } = period;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const nowSec = Math.floor(Date.now() / 1000);
      const todayStart = startOfLocalDay(nowSec);
      const asked: Period = { range, from, to, anchor: from };
      const done = (daily: ReadonlyMap<number, number>, hourly: number[] | null) => {
        if (!cancelled) setState({ data: { period: asked, daily, hourly, nowSec, todayStart }, error: null });
      };
      const fail = (e: unknown) => {
        if (!cancelled) setState((prev) => ({ data: prev.data, error: errorMessage(e) }));
      };
      if (range === 'D') {
        listStepSamplesBetween(db, from, to).then((samples) => done(new Map(), hourlySteps(samples)), fail);
      } else {
        listDailySteps(db, dayBounds(daysOf({ range, from, to, anchor: from }))).then((daily) => done(daily, null), fail);
      }
      return () => {
        cancelled = true;
      };
      // dataVersion re-runs the query after each stored sync.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, range, from, to, dataVersion]),
  );

  return state;
}


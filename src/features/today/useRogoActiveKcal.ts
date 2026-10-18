import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { listWatchCaloriesSince } from '@/db/queries';
import { activeKcalByDate } from '@/features/today/rogoActive';
import { ROGO_SCORE_DAYS } from '@/features/today/rogoScores';
import { startOfLocalDay } from '@/features/today/stats';
import { addDays } from '@/features/trends/series';

/**
 * The watch's all-day active energy per date (`YYYY-MM-DD`, kcal) for today and the earlier days JoyoRogo is sent
 * (`ROGO_SCORE_DAYS`), re-read when the tab gains focus and after each stored sync, like `useTodayData`. Undefined until the
 * first read and when a read fails: the push then simply leaves the field out and JoyoRogo keeps what it stored.
 */
export function useRogoActiveKcal(dataVersion: number): ReadonlyMap<string, number> | undefined {
  const db = useSQLiteContext();
  const [active, setActive] = useState<ReadonlyMap<string, number> | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const dayStart = startOfLocalDay(Math.floor(Date.now() / 1000));
      listWatchCaloriesSince(db, addDays(dayStart, 1 - ROGO_SCORE_DAYS)).then(
        (rows) => {
          if (!cancelled) setActive(activeKcalByDate(rows, dayStart, ROGO_SCORE_DAYS));
        },
        () => {
          if (!cancelled) setActive(undefined);
        },
      );
      return () => {
        cancelled = true;
      };
      // dataVersion re-runs the query after each stored sync.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, dataVersion]),
  );

  return active;
}

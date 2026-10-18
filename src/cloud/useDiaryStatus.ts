import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { useCloud } from '@/state/CloudProvider';

import { readDiaryStatus, type DiaryStatus } from './diaryStatus';

/** The push of workout energy to JoyoRogo's diary, re-read when the screen gets focus and after every sync run. Null until first read. */
export function useDiaryStatus(): DiaryStatus | null {
  const db = useSQLiteContext();
  const { uploading, lastSyncAt } = useCloud();
  const [status, setStatus] = useState<DiaryStatus | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      readDiaryStatus(db).then(
        (value) => !cancelled && setStatus(value),
        () => undefined,
      );
      return () => {
        cancelled = true;
      };
      // `uploading` and `lastSyncAt` only say that a run just ended.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, uploading, lastSyncAt]),
  );

  return status;
}

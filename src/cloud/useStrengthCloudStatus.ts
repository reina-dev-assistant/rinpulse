import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { getStrengthMeta } from '@/features/strength/store';
import { useCloud } from '@/state/CloudProvider';

import { OFFLINE_META } from './strengthSync';
import { META, deriveCloudState, type StrengthCloudState } from './strengthSyncCore';

export interface StrengthCloudStatus {
  state: StrengthCloudState;
  /** Records changed on this phone that the cloud does not have yet. */
  pending: number;
  /** The last sync could not reach JoyoRogo. */
  offline: boolean;
}

interface Stored {
  pending: number;
  locked: boolean;
  offline: boolean;
}

/**
 * Where the strength history stands against JoyoRogo's cloud, for a one-line status: synced, kept on this phone (the account is
 * not Pro), changes waiting, or not signed in. Re-read when the screen gets focus and after every sync run.
 */
export function useStrengthCloudStatus(): StrengthCloudStatus {
  const db = useSQLiteContext();
  const { signedIn, uploading, lastSyncAt } = useCloud();
  const [stored, setStored] = useState<Stored>({ pending: 0, locked: false, offline: false });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM strength_record WHERE dirty = 1');
        const [locked, offline] = await Promise.all([getStrengthMeta(db, META.locked), getStrengthMeta(db, OFFLINE_META)]);
        if (!cancelled) setStored({ pending: row?.n ?? 0, locked: locked === '1', offline: offline === '1' });
      })().catch(() => undefined);
      return () => {
        cancelled = true;
      };
      // `uploading` and `lastSyncAt` only say that a run just ended.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, uploading, lastSyncAt]),
  );

  return { state: deriveCloudState({ signedIn, ...stored }), pending: stored.pending, offline: stored.offline };
}

import type { SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  listWatches,
  removeWatchRow,
  renameWatch,
  setBackgroundSync,
  setPrimaryWatch,
  setTracksHealth,
  type WatchRow,
} from '@/features/device/watches';

/** The edits the Watch tab offers on the stored list; each one writes `device` and reloads the list. */
export interface WatchListActions {
  /** A name of the person's choosing; an empty text goes back to the name the watch reports. */
  rename: (address: string, alias: string) => Promise<void>;
  makePrimary: (address: string) => Promise<void>;
  setBackgroundSync: (address: string, on: boolean) => Promise<void>;
  setTracksHealth: (address: string, on: boolean) => Promise<void>;
  /** Drops the row only; the keys and the link are the caller's (`WatchProvider.removeWatch`). */
  removeRow: (address: string) => Promise<void>;
}

/**
 * The watches this phone has used, reloaded when [reloadKey] changes (a sync stored rows, a watch connected: the native module writes
 * the `device` row on connect and advances `last_sync`). A failed read keeps the last list.
 */
export function useWatchList(db: SQLiteDatabase, reloadKey: string | number): { watches: WatchRow[]; actions: WatchListActions } {
  const [watches, setWatches] = useState<WatchRow[]>([]);

  const reload = useCallback(async () => {
    try {
      setWatches(await listWatches(db));
    } catch {
      // The list is a convenience; the previous one stays on screen.
    }
  }, [db]);

  useEffect(() => {
    let live = true;
    listWatches(db).then(
      (list) => {
        if (live) setWatches(list);
      },
      () => {
        // The list is a convenience; the previous one stays on screen.
      },
    );
    return () => {
      live = false;
    };
  }, [db, reloadKey]);

  const actions = useMemo<WatchListActions>(() => {
    const then = (write: Promise<void>) => write.then(reload);
    return {
      rename: (address, alias) => then(renameWatch(db, address, alias)),
      makePrimary: (address) => then(setPrimaryWatch(db, address)),
      setBackgroundSync: (address, on) => then(setBackgroundSync(db, address, on)),
      setTracksHealth: (address, on) => then(setTracksHealth(db, address, on)),
      removeRow: (address) => then(removeWatchRow(db, address)),
    };
  }, [db, reload]);

  return { watches, actions };
}

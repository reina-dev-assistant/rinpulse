import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { hasStoredWatch, hasWatchData } from '@/db/queries';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear } from '@/wear';

import { presenceOf, type WatchPresence } from './presence';

/** The last answer, so a screen opened later starts with it instead of flashing the wrong layout while the database is read. */
let known: WatchPresence | null = null;

/**
 * Whether this phone has a watch (see `presence.ts`); null for the first moment of the app session, before the database has been read.
 * It re-reads when a watch links or unlinks and after every stored sync or import, so pairing from the Watch tab changes Today at once.
 */
export function useWatchPresence(): WatchPresence | null {
  const db = useSQLiteContext();
  const { device, dataVersion } = useWatch();
  const [presence, setPresence] = useState<WatchPresence | null>(known);
  const linked = device !== null;

  useEffect(() => {
    let live = true;
    void (async () => {
      const remembered = HuaweiWear.getBackgroundStatus().address !== null;
      const stored = linked || remembered ? true : await hasStoredWatch(db).catch(() => false);
      const hasData = stored ? true : await hasWatchData(db).catch(() => false);
      const next = presenceOf({ linked, remembered, stored, hasData });
      known = next;
      if (live) setPresence(next);
    })();
    return () => {
      live = false;
    };
  }, [db, linked, dataVersion]);

  return presence;
}

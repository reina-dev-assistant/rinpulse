import type { SQLiteDatabase } from 'expo-sqlite';

import { cloudLog as log } from '@/cloud/log';
import { rogoCall } from '@/cloud/rogo';
import { getDetachedAt } from '@/db/cloud';
import { mergeCoachDocs, sameCoachDoc } from './merge';
import { readCoachDoc, updateCoachDoc } from './store';
import { syncCoachDoc, type PutResult, type RemoteCoach } from './syncDoc';

/** `syncCoachDoc` against the app's database and JoyoRogo. */
export async function syncCoach(db: SQLiteDatabase): Promise<void> {
  const result = await syncCoachDoc({
    detachedAt: () => getDetachedAt(db),
    fetchRemote: () => rogoCall<RemoteCoach>('coach/getDoc', {}),
    putRemote: (baseRev, doc) => rogoCall<PutResult>('coach/putDoc', { baseRev, doc }),
    readLocal: () => readCoachDoc(db),
    writeLocal: async (doc) => {
      // Merged into whatever is stored now: a tap made while the request was in flight is kept.
      await updateCoachDoc(db, (stored) => {
        const merged = mergeCoachDocs(stored, doc);
        return sameCoachDoc(merged, stored) ? null : merged;
      });
    },
  });
  if (result !== 'unchanged') log(`coach ${result}`);
}

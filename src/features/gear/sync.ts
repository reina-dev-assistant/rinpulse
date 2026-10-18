import type { SQLiteDatabase } from 'expo-sqlite';

import { CloudHttpError, CloudLockedError, cloudRequest } from '@/cloud/api';
import { cloudLog as log } from '@/cloud/log';
import { getDetachedAt } from '@/db/cloud';
import { readGearDoc, reconcileDefaults, writeGearDoc } from './store';
import { syncGearDoc, type RemoteGear } from './syncDoc';

/** `syncGearDoc` against the app's database and the JoyoFit Worker; then the defaults are applied to workouts the pull brought in. */
export async function syncGear(db: SQLiteDatabase): Promise<void> {
  const result = await syncGearDoc({
    detachedAt: () => getDetachedAt(db),
    fetchRemote: () => cloudRequest<RemoteGear>('GET', '/v1/gear'),
    putRemote: async (baseRev, doc) => {
      try {
        await cloudRequest('PUT', '/v1/gear', { baseRev, doc });
        return 'ok';
      } catch (error) {
        if (error instanceof CloudLockedError) return 'locked';
        if (error instanceof CloudHttpError && error.status === 409) return 'conflict';
        throw error;
      }
    },
    readLocal: () => readGearDoc(db),
    writeLocal: (doc) => writeGearDoc(db, doc),
  });
  if (result !== 'unchanged') log(`gear ${result}`);
  await reconcileDefaults(db);
}

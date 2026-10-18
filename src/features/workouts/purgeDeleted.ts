import type { SQLiteDatabase } from 'expo-sqlite';

import { cloudLog } from '@/cloud/log';
import { errorMessage } from '@/format';

import { purgeDeletedWatchRows } from './deleteCore';

/**
 * Removes the watch's copies of deleted workouts (`purgeDeletedWatchRows`): after every watch sync, at start, when the app returns, and
 * ahead of every push to the account, so a workout the person deleted is never read, uploaded or sent again. Returns how many went; never throws.
 */
export async function purgeDeletedWorkouts(db: SQLiteDatabase): Promise<number> {
  try {
    return await purgeDeletedWatchRows(db);
  } catch (error) {
    cloudLog(`deleted workouts not purged: ${errorMessage(error)}`, 'error');
    return 0;
  }
}

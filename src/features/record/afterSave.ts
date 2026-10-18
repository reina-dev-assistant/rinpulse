import type { SQLiteDatabase } from 'expo-sqlite';

import { cloudLog as log } from '@/cloud/log';
import { pushPhoneKcal } from '@/cloud/phoneKcal';
import { sendWorkoutToStrava } from '@/cloud/strava';
import { onUnmeteredNetwork, readSyncSettings } from '@/cloud/syncSettings';
import { getStravaSettings } from '@/db/strava';
import { errorMessage } from '@/format';

/**
 * What follows a phone recording being saved, fire and forget (`void afterRecordingSaved(...)`); never throws.
 * - JoyoRogo diary: the workout's energy (`pushPhoneKcal`), under the cloud settings of the app like the strength logger's: nothing is
 *   sent with "Automatic sync" off, or on mobile data with "Wi-Fi only" on (the next sync catches up).
 * - Strava: the workout is sent when `strava` is true and an account is connected, the way the watch's workouts are.
 * The Pro cloud copy of the workout follows from the data change the caller reports.
 */
export async function afterRecordingSaved(db: SQLiteDatabase, workoutId: number, options: { strava: boolean }): Promise<void> {
  try {
    const { autoSync, wifiOnly } = readSyncSettings();
    if (autoSync && (!wifiOnly || (await onUnmeteredNetwork()))) await pushPhoneKcal(db, workoutId);
  } catch (error) {
    log(`after recording: ${errorMessage(error)}`, 'error');
  }
  if (!options.strava) return;
  try {
    if ((await getStravaSettings(db)).connectedAt !== null) await sendWorkoutToStrava(db, workoutId);
  } catch (error) {
    log(`recording to Strava: ${errorMessage(error)}`, 'error');
  }
}

import type { SQLiteDatabase } from 'expo-sqlite';

import { cloudLog as log } from '@/cloud/log';
import { pushStrengthKcal } from '@/cloud/strengthKcal';
import { syncStrength } from '@/cloud/strengthSync';
import { onUnmeteredNetwork, readSyncSettings } from '@/cloud/syncSettings';
import { getStravaSettings, getStravaUpload } from '@/db/strava';
import { errorMessage } from '@/format';

import { autoStravaWanted } from './autoStrava';
import { sendStrengthToStrava } from './strava';
import { loadSettings } from './store';
import type { StrengthWorkout } from './types';

/** Saves are batched: a workout edited a few times in a row is one sync. */
const SYNC_DEBOUNCE_MS = 2_000;
let timer: ReturnType<typeof setTimeout> | undefined;

function scheduleSync(db: SQLiteDatabase): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    syncStrength(db).catch((e) => log(`strength sync failed: ${errorMessage(e)}`, 'error'));
  }, SYNC_DEBOUNCE_MS);
}

/** `autoStravaWanted` with the facts read from the database. A workout recorded by a watch is also sent by the automatic watch upload; both end in one `strava_upload` row per workout, so Strava gets it once. */
export async function strengthAutoStravaWanted(db: SQLiteDatabase, workout: StrengthWorkout, now = Date.now()): Promise<boolean> {
  if (workout.workoutStart === null) return false;
  return autoStravaWanted(
    workout,
    {
      setting: (await loadSettings(db)).autoStrava,
      connected: (await getStravaSettings(db)).connectedAt !== null,
      alreadySent: (await getStravaUpload(db, workout.workoutStart)) !== null,
    },
    now,
  );
}

/**
 * Everything that follows a strength workout being saved or deleted, fire and forget (`void afterStrengthSaved(...)`); never throws.
 * - JoyoRogo cloud: a debounced `syncStrength`, and the workout's energy to JoyoRogo's diary (`pushStrengthKcal`). Both follow the
 *   cloud settings of the app: nothing is sent when "Automatic sync" is off, or on mobile data with "Wi-Fi only" on (the next
 *   manual or automatic sync catches up).
 * - Strava: the workout is sent when `strengthAutoStravaWanted`.
 * Deleting also removes the workout's `workouts` row, which the caller (`detachWorkoutRow`) has already done.
 */
export async function afterStrengthSaved(db: SQLiteDatabase, workout: StrengthWorkout, change: 'saved' | 'deleted'): Promise<void> {
  try {
    const { autoSync, wifiOnly } = readSyncSettings();
    if (autoSync && (!wifiOnly || (await onUnmeteredNetwork()))) {
      scheduleSync(db);
      await pushStrengthKcal(db, workout, change);
    }
  } catch (error) {
    log(`after strength save: ${errorMessage(error)}`, 'error');
  }
  if (change !== 'saved') return;
  try {
    if (await strengthAutoStravaWanted(db, workout)) await sendStrengthToStrava(db, workout);
  } catch (error) {
    log(`strength to Strava: ${errorMessage(error)}`, 'error');
  }
}

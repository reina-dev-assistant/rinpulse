import type { SQLiteDatabase } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';

import { cloudRequest, NotSignedInError } from '@/cloud/api';
import { createHealthAdapters, countDirtyHealth, scanHealth, setCycleGate, type HealthOptions } from '@/cloud/healthRecords';
import { restoreWindow, type RestorePage, type RestoreTable } from '@/cloud/healthRestore';
import { notePrefChanged } from '@/cloud/prefsSync';
import { rogoCall } from '@/cloud/rogo';
import type { RecordAdapter } from '@/cloud/syncEngine';
import { getCloudState } from '@/db/cloud';

export { baselineHealthSync } from '@/cloud/healthRecords';
export { forgetHealthRestore } from '@/cloud/healthRestore';

/**
 * Health data across phones (ns `fit`). What travels, and what never does:
 *
 *  - Steps and sleep segments: the existing uploader (`uploader.ts`) sends what this phone's watch measured; a new phone
 *    restores the last 90 days with `restoreHealthWindow` (`healthRestore.ts` says what happens to those rows).
 *  - hrv, sleepscore, cycleperiod, cycleday, metric: record kinds, see `healthRecords.ts`.
 *  - Stays on the phone: `rri_samples` (raw beat intervals, one row per beat: far too many, and only the derived HRV matters),
 *    `health_metric_status` (what this watch supports), Health Connect / Apple Health connection and export state.
 */

/** KV key of the switch; absent = on. Same key the synced preference `sync.cycle` reads and writes. */
const CYCLE_KEY = 'cloud.syncCycle';
const DEFAULT_RESTORE_DAYS = 90;

/** The menstrual log is sent to the cloud unless the person turned that off (default on). */
export function cycleSyncEnabled(): boolean {
  return Storage.getItemSync(CYCLE_KEY) !== '0';
}

const options: HealthOptions = {
  cycleEnabled: cycleSyncEnabled,
  wipeCycle: async () => {
    await rogoCall('sync/wipe', { ns: 'fit', kinds: ['cycleperiod', 'cycleday'] });
  },
};

/**
 * Switches the cycle log sync. Off: nothing of it is pushed or applied from now on and the cloud copies are hard-deleted
 * (retried by every later run until it went through). On: the phone forgets what it knew of the cycle log, so every row is
 * uploaded again. The change is a synced preference (`sync.cycle`): other phones follow the switch but do not wipe.
 */
export async function setCycleSync(db: SQLiteDatabase, on: boolean): Promise<void> {
  Storage.setItemSync(CYCLE_KEY, on ? '1' : '0');
  await notePrefChanged('sync.cycle');
  await setCycleGate(db, on, options);
}

export function healthAdapters(db: SQLiteDatabase): RecordAdapter[] {
  return createHealthAdapters(db, options);
}

/** Health records changed here and not on the server yet (the cycle kinds only count while their switch is on). */
export async function healthPendingCount(db: SQLiteDatabase): Promise<number> {
  await scanHealth(db, options);
  return countDirtyHealth(db, options);
}

async function fetchPage(table: RestoreTable, from: number, after: string | number | null, limit: number): Promise<RestorePage> {
  const query = new URLSearchParams({ table, from: String(from), limit: String(limit) });
  if (after !== null) query.set('after', String(after));
  return cloudRequest<RestorePage>('GET', `/v1/restore?${query}`);
}

/**
 * Pulls the last `days` (90) of steps and sleep of the signed-in account onto this phone. Resumes after an interruption,
 * does nothing when the phone already holds the window; returns the rows written. The caller decides when it may run
 * (Wi-Fi only, signed in).
 */
export async function restoreHealthWindow(
  db: SQLiteDatabase,
  opts: { days?: number; onProgress?: (done: number, total: number | null) => void } = {},
): Promise<{ steps: number; sleep: number }> {
  const { userId } = await getCloudState(db);
  if (userId === null) throw new NotSignedInError();
  return restoreWindow(db, { days: opts.days ?? DEFAULT_RESTORE_DAYS, onProgress: opts.onProgress, userId, fetchPage });
}

import Storage from 'expo-sqlite/kv-store';
import { File } from 'expo-file-system';
import { defaultDatabaseDirectory, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { buildAppSchema, DATABASE_NAME } from '@/db/appSchema';
import { isDisconnectedByUser, setDisconnectedByUser } from '@/state/disconnectedByUser';
import { HuaweiWear, hasNative, nativeDatabaseControl, onNativeCallError } from '@/wear';

import { isCorruptionError } from './corruption';
import { createForegroundScheduler } from './foreground';
import { holdQueries } from './gate';
import { createDbHealth, type DbHealthState } from './health';
import { watchNativeErrors } from './nativeErrors';
import { applyPendingSwap, quickCheck, recoverDatabase } from './recover';
import { recoveryEnv } from './env';
import { recordRepairLine, startRepairLog } from './repairLog';

/** How long a start waits for the quick check before it opens the app anyway; a check that is still running reports when it ends. */
const QUICK_CHECK_BUDGET_MS = 2000;

/**
 * The start check, the repair and the swap of a prepared file run in the foreground only (see `foreground.ts`): a background
 * launch of the app, with the phone locked, must not scan, copy or replace the database.
 */
const foreground = createForegroundScheduler({
  current: () => AppState.currentState,
  onChange: (listener) => {
    const subscription = AppState.addEventListener('change', listener);
    return () => subscription.remove();
  },
});

/** How long a step of stopping the native writers may take. */
const STEP_TIMEOUT_MS = 10_000;

const RESTORE_KEY = 'dbRecovery.restore';

/** What the repair stopped and a restart has to start again. */
function saveRestore(restore: { service: string | null; hold: boolean }): void {
  // A later pause that found nothing left to stop must not erase what an earlier one stopped.
  if (restore.service === null && !restore.hold) return;
  try {
    Storage.setItemSync(RESTORE_KEY, JSON.stringify(restore));
  } catch {
    // The person can start the background mode and the link again by hand.
  }
}

/** After the prepared database went in at a start: starts what the repair stopped before the restart. */
async function restoreStoppedWriters(): Promise<void> {
  let restore: unknown = null;
  try {
    const raw = Storage.getItemSync(RESTORE_KEY);
    restore = raw === null ? null : JSON.parse(raw);
  } catch {
    restore = null;
  }
  if (typeof restore !== 'object' || restore === null) return;
  const service: unknown = 'service' in restore ? Reflect.get(restore, 'service') : null;
  if ('hold' in restore && Reflect.get(restore, 'hold') === true) await setDisconnectedByUser(false);
  if (typeof service === 'string' && hasNative('setBackgroundEnabled')) {
    await HuaweiWear.setBackgroundEnabled(service).catch((e: unknown) => recordRepairLine(`background mode not restored: ${e instanceof Error ? e.message : String(e)}`));
  }
  Storage.removeItemSync(RESTORE_KEY);
}

/** The sizes of the database files at the start of a repair: a full phone is one way the repair fails. */
function logFileSizes(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      const file = new File(`file://${defaultDatabaseDirectory}/${DATABASE_NAME}${suffix}`);
      recordRepairLine(`${DATABASE_NAME}${suffix}: ${file.exists ? `${file.size} bytes` : 'absent'}`);
    } catch (e) {
      recordRepairLine(`${DATABASE_NAME}${suffix}: size unknown (${e instanceof Error ? e.message : String(e)})`);
    }
  }
}

/**
 * Gets every native writer off `joyofit.db` for the time of a repair, and returns what lets them back. The Kotlin side opens the
 * file with a SQLite library of its own that does not wait for the app's locks, so anything it writes while the file is replaced
 * lands in the new file too: the foreground service is stopped, the watch link is closed (the sync, the Healthy Living data and
 * the Health Connect export all run on the link) and the app's own reconnect is held off, then the native connection itself is
 * closed on binaries that can (`releaseDatabase`). Each step is independent; a step that fails is logged and the next one runs.
 */
async function pauseNativeWriter(): Promise<() => Promise<void>> {
  startRepairLog();
  const resumes: (() => Promise<void>)[] = [];
  const step = async (what: string, run: () => Promise<void>): Promise<boolean> => {
    try {
      // A native call that never answers must not hold the repair (and its spinner) forever.
      await Promise.race([run(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer after ${STEP_TIMEOUT_MS} ms`)), STEP_TIMEOUT_MS))]);
      recordRepairLine(`native writers: ${what}`);
      return true;
    } catch (e) {
      recordRepairLine(`native writers: ${what} failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };

  const heldBefore = await isDisconnectedByUser();
  let holdSetHere = false;
  let stoppedService: string | null = null;
  if (await step('app reconnect held off', () => setDisconnectedByUser(true))) {
    if (!heldBefore) {
      holdSetHere = true;
      resumes.unshift(() => setDisconnectedByUser(false));
    }
  }
  let backgroundOwnsLink = false;
  try {
    if (hasNative('getBackgroundStatus') && hasNative('setBackgroundEnabled')) {
      const { enabled, address } = HuaweiWear.getBackgroundStatus();
      if (enabled && address !== null) {
        if (await step('background service stopped', () => HuaweiWear.setBackgroundEnabled(null))) {
          backgroundOwnsLink = true;
          resumes.unshift(() => HuaweiWear.setBackgroundEnabled(address));
        }
      }
    }
  } catch (e) {
    recordRepairLine(`native writers: background status unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    if (hasNative('getState') && hasNative('disconnect') && HuaweiWear.getState() !== 'disconnected') {
      const connected = hasNative('getDevice') ? HuaweiWear.getDevice() : null;
      if (await step('watch link closed', () => HuaweiWear.disconnect()) && connected !== null && !backgroundOwnsLink) {
        // Without the service nothing else brings the link back after the repair.
        resumes.unshift(async () => {
          void HuaweiWear.connect(connected.address).catch(() => undefined);
        });
      }
    }
  } catch (e) {
    recordRepairLine(`native writers: link state unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }
  const control = nativeDatabaseControl();
  if (control !== null && (await step('native connection closed', control.release))) resumes.unshift(control.resume);
  return async () => {
    if (dbHealth.pendingSwap() !== null) {
      // A repaired copy waits for the next start and this process still has the old file open: the writers stay off (they would
      // keep writing into it) and come back after the swap at the next start.
      recordRepairLine('native writers stay off until the prepared database is swapped in at the next start');
      if (control !== null) await control.resume().catch(() => undefined);
      saveRestore({ service: stoppedService, hold: holdSetHere });
      return;
    }
    for (const resume of resumes) await resume().catch((e: unknown) => recordRepairLine(`native writers: resume failed: ${e instanceof Error ? e.message : String(e)}`));
  };
}

export { isCorruptionError } from './corruption';
export type { DbHealthState, RepairNotice } from './health';

/**
 * The one repair coordinator of the app. Notes are kept in the key-value store (its own small database file, so a damaged
 * `joyofit.db` cannot take them with it).
 */
export const dbHealth = createDbHealth({
  recover: (options) => {
    logFileSizes();
    // Without a way to release the native connection, nothing is written into the file it may hold open.
    return recoverDatabase(recoveryEnv, DATABASE_NAME, { ...options, inPlace: nativeDatabaseControl() !== null });
  },
  hold: holdQueries,
  quiesce: pauseNativeWriter,
  storage: {
    get: (key) => Storage.getItemSync(key),
    set: (key, value) => (value === null ? Storage.removeItemSync(key) : Storage.setItemSync(key, value)),
  },
  now: () => Date.now(),
});

/** Hands the status of the repair (running, or the notice to show) to a component. */
export function useDbHealth(): DbHealthState {
  return useSyncExternalStore(dbHealth.subscribe, dbHealth.getState);
}

/** Tells the repair about an error from a query or from the native writer; only corruption starts anything. */
export const reportDatabaseError = (error: unknown): void => {
  if (!isCorruptionError(error)) return;
  foreground.run('report', () => dbHealth.report(error));
};

/**
 * At a start, before anything opens `joyofit.db`: puts in the database a repair prepared but could not swap in. Nothing here
 * throws; when it cannot, the marker stays and the next start tries again.
 */
async function applyPendingDatabaseSwap(): Promise<void> {
  const prepared = dbHealth.pendingSwap();
  if (prepared === null) return;
  // The foreground service may already be running with its connection open: the file must not be replaced under it.
  const resume = await pauseNativeWriter().catch(() => null);
  try {
    recordRepairLine(`applying the prepared database ${prepared}`);
    await applyPendingSwap(recoveryEnv, DATABASE_NAME, prepared);
    recordRepairLine('prepared database swapped in');
    dbHealth.clearPendingSwap();
    await restoreStoppedWriters();
  } catch (e) {
    recordRepairLine(`swapping in the prepared database failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await resume?.().catch(() => undefined);
  }
}

/**
 * The schema, on a connection of its own that is closed again: what opening the database used to do on the app's handle. With
 * `check` it then runs `PRAGMA quick_check`, because building the schema reads only a few pages and a file whose damage is
 * elsewhere opens fine (the native writer meets it later, on its own reads). True when nothing is wrong or the check could not
 * say; false when the file is damaged. A check that outlasts `QUICK_CHECK_BUDGET_MS` lets the app open and starts the repair
 * itself when it ends damaged (no file swap then: the app's handle is open by that time).
 */
async function buildSchemaOnce(check: boolean): Promise<boolean> {
  const db = await openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
  let closeNow = true;
  try {
    await buildAppSchema(db);
    if (!check) return true;
    await db.execAsync('PRAGMA busy_timeout = 5000');
    const verdict = quickCheck(db);
    const budget = new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), QUICK_CHECK_BUDGET_MS));
    const first = await Promise.race([verdict, budget]);
    if (first === 'late') {
      closeNow = false;
      void verdict
        .then(async (late) => {
          await db.closeAsync().catch(() => undefined);
          if (late === 'damaged') {
            recordRepairLine('late quick_check says the file is damaged');
            foreground.run('repair', () => void dbHealth.repair());
          }
        })
        .catch(() => undefined);
      return true;
    }
    return first !== 'damaged';
  } finally {
    if (closeNow) await db.closeAsync().catch(() => undefined);
  }
}

/**
 * Gets `joyofit.db` ready before the app's handle opens it: finishes a swap a repair left for this start, builds the schema,
 * and when that or the quick check says the file is damaged runs the repair once and builds again. `SQLiteProvider` cannot do
 * this itself: after a failed open it keeps the failed promise and every remount gets the same error. False when the file is
 * still unusable after the repair (the notice says what happened); any other error is thrown as it was.
 */
export async function prepareDatabase(onRepairing: () => void): Promise<boolean> {
  // A background launch builds the schema as it always did and leaves everything else for when the app is in front.
  if (foreground.isActive()) await applyPendingDatabaseSwap();
  for (let attempt = 0; attempt < 2; attempt++) {
    const active = foreground.isActive();
    try {
      // After a repair the second pass only builds the schema: the repair ran the full integrity check already.
      if (await buildSchemaOnce(attempt === 0 && active)) {
        if (attempt === 0 && !active) foreground.run('startCheck', () => void checkInForeground());
        return true;
      }
      recordRepairLine('start check: quick_check says the file is damaged');
    } catch (e) {
      if (!isCorruptionError(e)) throw e;
      recordRepairLine(`start check: building the schema met corruption: ${e instanceof Error ? e.message : String(e)}`);
      if (!active) {
        recordRepairLine('the app is not in the foreground: the repair waits until it is');
        foreground.run('repair', () => void dbHealth.repair());
        return true;
      }
    }
    onRepairing();
    const result = await dbHealth.repair({ canSwap: true });
    recordRepairLine(`repair finished: ${result.kind}${result.kind === 'failed' ? ` (${result.reason})` : ''}`);
    if (result.kind === 'failed') return false;
  }
  return false;
}

/** The start check of a launch that was not in the foreground, run when the app comes forward (no file swap: the app's handle is open). */
async function checkInForeground(): Promise<void> {
  let db: SQLiteDatabase | null = null;
  try {
    db = await openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
    await db.execAsync('PRAGMA busy_timeout = 5000');
    if ((await quickCheck(db)) === 'damaged') {
      recordRepairLine('quick_check after coming to the foreground says the file is damaged');
      void dbHealth.repair();
    }
  } catch (e) {
    reportDatabaseError(e);
  } finally {
    await db?.closeAsync().catch(() => undefined);
  }
}

/**
 * Sends every corruption error of the native writer to the repair, from the calls that fail and from the events it emits;
 * returns the function that stops it. The Kotlin side meets a damaged file before JS does (JS opens fine while the damage is in
 * pages it does not read), so this is the other half of the start check.
 */
export function startNativeErrorWatch(): () => void {
  return watchNativeErrors({ addListener: (event, listener) => HuaweiWear.addListener(event, listener), onCallError: onNativeCallError }, reportDatabaseError);
}

import Storage from 'expo-sqlite/kv-store';
import { openDatabaseAsync } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

import { buildAppSchema, DATABASE_NAME } from '@/db/appSchema';

import { isCorruptionError } from './corruption';
import { holdQueries } from './gate';
import { createDbHealth, type DbHealthState } from './health';
import { applyPendingSwap, recoverDatabase } from './recover';
import { recoveryEnv } from './env';

export { isCorruptionError } from './corruption';
export type { DbHealthState, RepairNotice } from './health';

/**
 * The one repair coordinator of the app. Notes are kept in the key-value store (its own small database file, so a damaged
 * `joyofit.db` cannot take them with it).
 */
export const dbHealth = createDbHealth({
  recover: (options) => recoverDatabase(recoveryEnv, DATABASE_NAME, options),
  hold: holdQueries,
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
export const reportDatabaseError = (error: unknown): void => dbHealth.report(error);

/**
 * At a start, before anything opens `joyofit.db`: puts in the database a repair prepared but could not swap in. Nothing here
 * throws; when it cannot, the marker stays and the next start tries again.
 */
async function applyPendingDatabaseSwap(): Promise<void> {
  const prepared = dbHealth.pendingSwap();
  if (prepared === null) return;
  try {
    await applyPendingSwap(recoveryEnv, DATABASE_NAME, prepared);
    dbHealth.clearPendingSwap();
  } catch {
    // Kept for the next start.
  }
}

/** The schema, on a connection of its own that is closed again: what opening the database used to do on the app's handle. */
async function buildSchemaOnce(): Promise<void> {
  const db = await openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
  try {
    await buildAppSchema(db);
  } finally {
    await db.closeAsync().catch(() => undefined);
  }
}

/**
 * Gets `joyofit.db` ready before the app's handle opens it: finishes a swap a repair left for this start, builds the schema,
 * and when that says the file is damaged runs the repair once and builds again. `SQLiteProvider` cannot do this itself: after
 * a failed open it keeps the failed promise and every remount gets the same error. False when the file is still unusable after
 * the repair (the notice says what happened); any other error is thrown as it was.
 */
export async function prepareDatabase(onRepairing: () => void): Promise<boolean> {
  await applyPendingDatabaseSwap();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await buildSchemaOnce();
      return true;
    } catch (e) {
      if (!isCorruptionError(e)) throw e;
      onRepairing();
      const result = await dbHealth.repair({ canSwap: true });
      if (result.kind === 'failed') return false;
    }
  }
  return false;
}

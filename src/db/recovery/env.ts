import { File } from 'expo-file-system';
import { backupDatabaseAsync, defaultDatabaseDirectory, openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';

import { RECORDS_CURSOR_KEY, RECORDS_CURSOR_USER_KEY } from '@/cloud/recordSyncCore';
import { META as STRENGTH_META } from '@/cloud/strengthSyncCore';
import { buildAppSchema } from '@/db/appSchema';
import { WORKOUT_PULL_CURSOR_KEY } from '@/db/cloud';

import type { RecoveryDb, RecoveryEnv } from './recover';
import { recordRepairLine } from './repairLog';

/** Longer than the native writer's 10 s would be pointless; the same wait, so a sync that is mid-write finishes first. */
const BUSY_TIMEOUT_MS = 10_000;

const pathOf = (name: string): string => `${defaultDatabaseDirectory}/${name}`;
const fileOf = (name: string): File => new File(`file://${pathOf(name)}`);

function expoDb(db: RecoveryDb): SQLiteDatabase {
  if (!(db instanceof SQLiteDatabase)) throw new Error('the repair only works on expo-sqlite connections');
  return db;
}

/**
 * After rows could not be saved: make the cloud give them back. Every pull in the app resumes from a cursor stored in the
 * database, so a cursor that is ahead of what the repaired database holds would never fetch the missing rows. Removing the
 * cursors makes the next sync start from the beginning; what the phone already has is matched by key and not duplicated.
 * The watch needs nothing: it syncs from `device.last_sync`, and the rows it re-sends are upserts.
 */
async function resetPullCursors(db: RecoveryDb): Promise<void> {
  await db.runAsync(`DELETE FROM cloud_state WHERE key IN (?, ?, ?) OR key LIKE 'health_restore:%'`, [
    WORKOUT_PULL_CURSOR_KEY,
    RECORDS_CURSOR_KEY,
    RECORDS_CURSOR_USER_KEY,
  ]);
  await db.runAsync(`DELETE FROM strength_meta WHERE key = ?`, [STRENGTH_META.cursor]);
}

/** The repair wired to expo-sqlite and expo-file-system: every connection it opens is its own, never the app's shared one. */
export const recoveryEnv: RecoveryEnv = {
  async open(name) {
    const db = await openDatabaseAsync(name, { useNewConnection: true });
    await db.execAsync(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    return db;
  },
  backup: (from, to) => backupDatabaseAsync({ sourceDatabase: expoDb(from), destDatabase: expoDb(to) }),
  pathOf,
  files: {
    exists: async (name) => fileOf(name).exists,
    copy: (from, to) => fileOf(from).copy(fileOf(to)),
    move: (from, to) => fileOf(from).move(fileOf(to)),
    remove: async (name) => {
      fileOf(name).delete();
    },
  },
  now: () => Date.now(),
  buildSchema: (db) => buildAppSchema(expoDb(db)),
  afterLoss: resetPullCursors,
  log: recordRepairLine,
};

import type { SQLiteDatabase } from 'expo-sqlite';

import { cloudLog as log } from '@/cloud/log';
import { isSyncPaused } from '@/cloud/syncGate';
import { runSync, type PullAnswer, type PushAnswer, type RecordAdapter, type SyncIo, type SyncReport } from '@/cloud/syncEngine';
import { clearSyncItems } from '@/cloud/syncItems';
import { syncItemTable } from '@/cloud/syncSnapshot';
import { getCloudState, getCloudValue, setCloudState } from '@/db/cloud';
import { errorMessage } from '@/format';

/**
 * Preferences, user-made documents and the small health kinds, synced as records of namespace `fit` through JoyoRogo's
 * `sync/pull` and `sync/push` (the contract: docs/multi-device.md). This file holds what does not need the native modules, so
 * the whole run is unit-tested against `FakeSyncServer`; `recordSync.ts` wires the app's adapters and HTTP client.
 */

/** `cloud_state` keys: where the pull stood, and the account that position belongs to (another account starts at 0). */
export const RECORDS_CURSOR_KEY = 'records_cursor';
export const RECORDS_CURSOR_USER_KEY = 'records_cursor_user';

export type RecordCall = <T>(path: string, input: unknown) => Promise<T>;

export interface RecordSyncDeps {
  call: RecordCall;
  /** Not worth an error: nobody is signed in, the build has no cloud, or the server has no sync endpoint yet (404). */
  isQuiet(error: unknown): boolean;
  adapters(): RecordAdapter[];
  /** Records local edits that already have a stored version, before the pull. A failure here never stops the sync. */
  stamp(): Promise<void>;
  now?: () => number;
}

async function readCursor(db: SQLiteDatabase, userId: string): Promise<number> {
  if ((await getCloudValue(db, RECORDS_CURSOR_USER_KEY)) !== userId) return 0;
  const cursor = Number(await getCloudValue(db, RECORDS_CURSOR_KEY));
  return Number.isFinite(cursor) && cursor > 0 ? cursor : 0;
}

function ioFor(db: SQLiteDatabase, userId: string, deps: RecordSyncDeps): SyncIo {
  return {
    now: deps.now ?? Date.now,
    pull: (since) => deps.call<PullAnswer>('sync/pull', { ns: 'fit', since }),
    push: (clientNow, records) =>
      deps.call<PushAnswer>('sync/push', {
        ns: 'fit',
        clientNow,
        records: records.map(({ kind, id, json, updatedAt, deletedAt, rank }) => ({ kind, id, json, updatedAt, deletedAt, rank })),
      }),
    getCursor: () => readCursor(db, userId),
    setCursor: (cursor) => setCloudState(db, { [RECORDS_CURSOR_KEY]: String(cursor), [RECORDS_CURSOR_USER_KEY]: userId }),
  };
}

let running: Promise<SyncReport | 'local-only'> | null = null;

/**
 * Pulls what other phones changed and pushes what changed here. `'local-only'` when nothing could happen: the phone is not
 * bound to an account, the sync is paused for an account decision, nobody is signed in, or the server has no endpoint yet.
 * Other failures throw. Overlapping calls share one run.
 */
export function runRecordSync(db: SQLiteDatabase, deps: RecordSyncDeps): Promise<SyncReport | 'local-only'> {
  running ??= (async () => {
    if (isSyncPaused()) return 'local-only';
    try {
      const { userId } = await getCloudState(db);
      if (userId === null) return 'local-only';
      await syncItemTable(db);
      await deps.stamp().catch((error: unknown) => log(`record sync: edits not stamped: ${errorMessage(error)}`, 'error'));
      return await runSync(ioFor(db, userId, deps), deps.adapters());
    } catch (error) {
      if (deps.isQuiet(error)) return 'local-only';
      throw error;
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Forgets the sync state of every record and the pull position: a different account, or this phone's data was deleted. */
export async function forgetRecords(db: SQLiteDatabase): Promise<void> {
  await syncItemTable(db);
  await clearSyncItems(db);
  await setCloudState(db, { [RECORDS_CURSOR_KEY]: null, [RECORDS_CURSOR_USER_KEY]: null });
}

/** Records changed here and not on the server yet, not counting `excludedKinds` (a package that counts its own). */
export async function countDirtyRecords(db: SQLiteDatabase, excludedKinds: readonly string[]): Promise<number> {
  await syncItemTable(db);
  const marks = excludedKinds.map(() => '?').join(', ');
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sync_item WHERE dirty = 1${excludedKinds.length > 0 ? ` AND kind NOT IN (${marks})` : ''}`,
    ...excludedKinds,
  );
  return row?.n ?? 0;
}

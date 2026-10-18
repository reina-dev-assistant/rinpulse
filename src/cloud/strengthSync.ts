import type { SQLiteDatabase } from 'expo-sqlite';

import { CloudHttpError, CloudNotConfiguredError, NotSignedInError } from '@/cloud/api';
import { cloudLog as log } from '@/cloud/log';
import { isSyncPaused } from '@/cloud/syncGate';
import { getCloudState } from '@/db/cloud';
import { errorMessage } from '@/format';
import { ensureRows, reconcileLinks } from '@/features/strength/link';
import { userWeightKg } from '@/features/strength/profile';
import { applyRemote, getStrengthMeta, listDirty, markAllDirty, markUploaded, setStrengthMeta } from '@/features/strength/store';

import { strengthCall } from './strengthHttp';
import { forgetPhoneKcal, retryPhoneKcal } from './phoneKcal';
import { forgetStrengthKcal, retryStrengthKcal } from './strengthKcal';
import {
  META,
  runStrengthSync,
  type PullPage,
  type PushAnswer,
  type StrengthSyncIo,
  type StrengthSyncResult,
} from './strengthSyncCore';

export type { StrengthSyncResult };

const KINDS = new Set<string>(['workout', 'routine', 'folder', 'exercise', 'pref']);
const PAGE = 200;

/** `strength_meta` key: the last sync could not reach JoyoRogo (the phone is offline). */
export const OFFLINE_META = 'strengthOffline';

function ioFor(db: SQLiteDatabase): StrengthSyncIo {
  return {
    accountId: async () => (await getCloudState(db)).userId,
    getMeta: (key) => getStrengthMeta(db, key),
    setMeta: (key, value) => setStrengthMeta(db, key, value),
    markAllDirty: () => markAllDirty(db),
    onAccountChanged: async () => {
      await forgetStrengthKcal(db);
      await forgetPhoneKcal(db);
    },
    pull: async (since): Promise<PullPage> => {
      const page = await strengthCall<{ records: PullPage['records']; cursor: number; hasMore: boolean }>('strength/pull', { since, limit: PAGE });
      // A record of a kind this app does not know (a newer app wrote it) is left alone.
      return { records: page.records.filter((r) => KINDS.has(r.kind)), cursor: page.cursor, hasMore: page.hasMore };
    },
    applyRemote: (records) => applyRemote(db, records),
    afterApply: async (workouts) => {
      const weight = userWeightKg();
      await ensureRows(db, workouts, weight);
      await reconcileLinks(db, weight);
    },
    listDirty: (limit) => listDirty(db, limit),
    push: (records) =>
      strengthCall<PushAnswer>('strength/push', {
        records: records.map(({ kind, id, json, updatedAt, deletedAt }) => ({ kind, id, json, updatedAt, deletedAt })),
      }),
    markUploaded: (records) => markUploaded(db, records),
  };
}

let running: Promise<StrengthSyncResult> | null = null;

async function run(db: SQLiteDatabase): Promise<StrengthSyncResult> {
  if (isSyncPaused()) return 'local-only';
  try {
    const result = await runStrengthSync(ioFor(db));
    await setStrengthMeta(db, OFFLINE_META, null);
    if (result !== 'unchanged') log(`strength ${result}`);
    // Workouts the pull brought in or linked to a watch workout may need their energy sent, or taken back.
    await retryStrengthKcal(db).catch((e) => log(`strength energy retry failed: ${errorMessage(e)}`, 'error'));
    await retryPhoneKcal(db).catch((e) => log(`phone workout energy retry failed: ${errorMessage(e)}`, 'error'));
    return result;
  } catch (error) {
    if (error instanceof NotSignedInError || error instanceof CloudNotConfiguredError) return 'local-only';
    if (error instanceof CloudHttpError && error.status === 404) {
      log('strength sync: JoyoRogo has no strength endpoint yet, data stays on this phone');
      return 'local-only';
    }
    if (!(error instanceof CloudHttpError)) await setStrengthMeta(db, OFFLINE_META, '1').catch(() => {});
    throw error;
  }
}

/**
 * Brings the phone's strength records and JoyoRogo's to one state: pulls what the cloud stored since the last sync, applies it
 * (newest `updatedAt` per record wins), gives pulled workouts their `workouts` rows, then pushes the phone's changes. Pushing is
 * a Pro feature: for another account the push is refused (`strengthLocked` in `strength_meta`) and the data stays on the phone
 * without an error. Not signed in, or a JoyoRogo without the endpoint, is `local-only` too. Other failures throw (the caller
 * logs them). Overlapping calls share one run.
 */
export function syncStrength(db: SQLiteDatabase): Promise<StrengthSyncResult> {
  running ??= run(db).finally(() => {
    running = null;
  });
  return running;
}

/**
 * "Delete cloud data": removes the account's strength records from JoyoRogo, then forgets what the phone knew of the cloud: nothing
 * is marked as waiting to upload and the pull starts over, so the wiped data does not come straight back. New changes sync as before.
 * A JoyoRogo without the endpoint has nothing to wipe.
 */
export async function wipeStrengthCloud(db: SQLiteDatabase): Promise<void> {
  try {
    await strengthCall<unknown>('strength/wipe', {});
  } catch (error) {
    if (!(error instanceof CloudHttpError && error.status === 404)) throw error;
  }
  await db.runAsync('UPDATE strength_record SET dirty = 0');
  for (const key of [META.cursor, META.locked, META.full, META.rejected, OFFLINE_META]) await setStrengthMeta(db, key, null);
}

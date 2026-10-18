import type { SQLiteDatabase } from 'expo-sqlite';

import { baselineContent, contentAdapters, stampContentEdits } from '@/cloud/contentSync';
import { baselineHealthSync, healthAdapters, healthPendingCount } from '@/cloud/healthSync';
import { HEALTH_KINDS } from '@/cloud/healthRecords';
import { baselinePrefs, prefsAdapter, stampPrefEdits } from '@/cloud/prefsSync';
import { countDirtyRecords, forgetRecords, runRecordSync } from '@/cloud/recordSyncCore';
import { strengthCall, isQuietCloudError } from '@/cloud/strengthHttp';
import type { SyncReport } from '@/cloud/syncEngine';
// Registers the preferences that follow the account; nothing is synced without it.
import '@/cloud/syncInventory';

/**
 * One sync of the record kinds of namespace `fit`: preferences (`prefsSync.ts`), Sticker Studio templates and routes
 * (`contentSync.ts`) and the small health kinds (`healthSync.ts`). Pull first, then push. Network failures and 5xx are retried
 * like the other cloud calls (`strengthCall`, which is `withRetry` over JoyoRogo's RPC). Pushing needs JoyoRogo Pro: for a free
 * account the report says `locked`, pulling still ran and everything stays waiting. Not signed in, no cloud, or a server
 * without the endpoint is `'local-only'`.
 */
export function syncRecords(db: SQLiteDatabase): Promise<SyncReport | 'local-only'> {
  return runRecordSync(db, {
    call: strengthCall,
    isQuiet: isQuietCloudError,
    adapters: () => [prefsAdapter(db), ...contentAdapters(db), ...healthAdapters(db)],
    stamp: async () => {
      await stampPrefEdits(db);
      await stampContentEdits(db);
    },
  });
}

/** Forgets every record's sync state and the pull position (the next sign-in starts from the account's copy). The things themselves stay. */
export function forgetRecordSync(db: SQLiteDatabase): Promise<void> {
  return forgetRecords(db);
}

/** Records changed on this phone that the cloud does not have yet. */
export async function recordSyncPending(db: SQLiteDatabase): Promise<number> {
  // The health count already includes its own kinds' dirty rows: leave them out here.
  return (await countDirtyRecords(db, HEALTH_KINDS)) + (await healthPendingCount(db));
}

/**
 * Marks everything this phone holds as already synced so none of it is uploaded into the account that signs in next
 * (`detachLocalData`): preferences, templates, routes and the health records. The account's own copy still wins on a pull.
 */
export async function baselineRecordSync(db: SQLiteDatabase): Promise<void> {
  await baselinePrefs(db);
  await baselineContent(db);
  await baselineHealthSync(db);
}

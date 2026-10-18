import type { DirtyRecord } from '@/features/strength/store';
import type { StrengthKind, StrengthWorkout } from '@/features/strength/types';

/**
 * The strength sync loop with everything outside it injected, so it runs under `bun test` without a database or a server
 * (same idea as `features/gear/syncDoc.ts`). `strengthSync.ts` wires it to the app.
 *
 * Protocol (JoyoRogo `strength/pull` and `strength/push`, docs/strength-cloud.md): pull the records the server stored after our
 * cursor (one millisecond of overlap, which last-write-wins absorbs), apply them, then push our dirty records in small batches.
 * A push is Pro only: the server answers `locked` and the phone keeps working on its own copy.
 */

export interface RemoteRecord {
  kind: StrengthKind;
  id: string;
  json: string;
  updatedAt: number;
  deletedAt: number | null;
}

export interface PullPage {
  records: RemoteRecord[];
  /** `server_at` of the last record, the `since` asked for when the page is empty. */
  cursor: number;
  hasMore: boolean;
}

export interface PushRejected {
  kind: string;
  id: string;
  /** `full`: the account is at its record cap (retry after something is deleted); anything else: the document can never be stored as sent. */
  reason: string;
}

export type PushAnswer = { status: 'locked' } | { status: 'ok'; stored: number; skipped: number; rejected: PushRejected[] };

export type StrengthSyncResult = 'unchanged' | 'uploaded' | 'downloaded' | 'both' | 'local-only';

export interface StrengthSyncIo {
  /** The JoyoRogo account this phone's cloud bookkeeping is bound to; null while unknown. */
  accountId: () => Promise<string | null>;
  getMeta: (key: string) => Promise<string | null>;
  setMeta: (key: string, value: string | null) => Promise<void>;
  /** A new account has none of the records: everything is sent again. */
  markAllDirty: () => Promise<void>;
  /** Anything else that remembered what the previous account was told (the kcal rows). */
  onAccountChanged: () => Promise<void>;
  pull: (since: number) => Promise<PullPage>;
  /** Stores what is newer than the local copy; returns the workouts among them (to get their `workouts` rows). */
  applyRemote: (records: readonly RemoteRecord[]) => Promise<{ applied: number; workouts: StrengthWorkout[] }>;
  afterApply: (workouts: readonly StrengthWorkout[]) => Promise<void>;
  listDirty: (limit: number) => Promise<DirtyRecord[]>;
  push: (records: readonly DirtyRecord[]) => Promise<PushAnswer>;
  markUploaded: (records: readonly Pick<DirtyRecord, 'kind' | 'id' | 'updatedAt'>[]) => Promise<void>;
}

/** `strength_meta` keys of the sync. */
export const META = {
  cursor: 'cloudCursor',
  user: 'cloudUser',
  locked: 'strengthLocked',
  full: 'strengthFull',
  rejected: 'strengthRejected',
} as const;

/** What the strength cloud line shows. */
export type StrengthCloudState = 'synced' | 'local-only' | 'pending' | 'not-signed-in';

/** `locked`: the last push was refused (not Pro). A locked account is local-only whatever is waiting: waiting is its normal state. */
export function deriveCloudState(input: { signedIn: boolean; locked: boolean; pending: number }): StrengthCloudState {
  if (!input.signedIn) return 'not-signed-in';
  if (input.locked) return 'local-only';
  return input.pending > 0 ? 'pending' : 'synced';
}

export const BATCH_RECORDS = 100;
/** Serialized size of one push, so a batch of big workouts stays a small request. At least one record always goes. */
export const BATCH_BYTES = 400_000;
const MAX_PULL_PAGES = 500;
const MAX_PUSH_BATCHES = 500;

/** The records of `dirty` that go in one request: at most `BATCH_RECORDS`, at most `BATCH_BYTES` of documents (never fewer than one). */
export function takeBatch<T extends { json: string }>(dirty: readonly T[]): T[] {
  const batch: T[] = [];
  let bytes = 0;
  for (const record of dirty) {
    if (batch.length >= BATCH_RECORDS) break;
    if (batch.length > 0 && bytes + record.json.length > BATCH_BYTES) break;
    bytes += record.json.length;
    batch.push(record);
  }
  return batch;
}

/** Where to ask from: one millisecond before the stored cursor (0 when there is none). */
export function sinceFor(cursor: number): number {
  return cursor > 0 ? cursor - 1 : 0;
}

async function readCursor(io: StrengthSyncIo): Promise<number> {
  const value = Number(await io.getMeta(META.cursor));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Pull, then push. Errors from `io` propagate (the caller maps "not signed in" and "server not deployed" to `local-only`);
 * what was applied or marked uploaded before the error stays so.
 */
export async function runStrengthSync(io: StrengthSyncIo): Promise<StrengthSyncResult> {
  // A different account has none of these records, and its cursor means nothing here.
  const account = await io.accountId();
  if (account !== null) {
    const known = await io.getMeta(META.user);
    if (known !== account) {
      if (known !== null) {
        await io.markAllDirty();
        await io.setMeta(META.cursor, null);
        await io.setMeta(META.locked, null);
        await io.setMeta(META.full, null);
        await io.onAccountChanged();
      }
      await io.setMeta(META.user, account);
    }
  }

  let downloaded = false;
  let cursor = await readCursor(io);
  let since = sinceFor(cursor);
  for (let pages = 0; pages < MAX_PULL_PAGES; pages++) {
    const page = await io.pull(since);
    if (page.records.length > 0) {
      const { applied, workouts } = await io.applyRemote(page.records);
      if (applied > 0) downloaded = true;
      if (workouts.length > 0) await io.afterApply(workouts);
      if (page.cursor > cursor) {
        cursor = page.cursor;
        await io.setMeta(META.cursor, String(cursor));
      }
    }
    if (!page.hasMore || page.cursor <= since) break;
    since = page.cursor;
  }

  let uploaded = false;
  let locked = false;
  let previous = '';
  for (let batches = 0; batches < MAX_PUSH_BATCHES; batches++) {
    const batch = takeBatch(await io.listDirty(BATCH_RECORDS));
    if (batch.length === 0) break;
    // The same records again means nothing was cleared (they changed while the request was in flight): stop, the next sync sends them.
    const signature = batch.map((r) => `${r.kind}:${r.id}:${r.updatedAt}`).join('|');
    if (signature === previous) break;
    previous = signature;
    const answer = await io.push(batch);
    if (answer.status === 'locked') {
      locked = true;
      await io.setMeta(META.locked, '1');
      break;
    }
    await io.setMeta(META.locked, null);
    if (answer.stored > 0) uploaded = true;
    const full = new Set(answer.rejected.filter((r) => r.reason === 'full').map((r) => `${r.kind}:${r.id}`));
    const settled = batch.filter((r) => !full.has(`${r.kind}:${r.id}`));
    if (settled.length > 0) await io.markUploaded(settled);
    const invalid = answer.rejected.length - full.size;
    if (invalid > 0) await io.setMeta(META.rejected, String(Number(await io.getMeta(META.rejected)) + invalid));
    if (full.size > 0) {
      await io.setMeta(META.full, '1');
      break;
    }
    await io.setMeta(META.full, null);
  }

  if (downloaded && uploaded) return 'both';
  if (downloaded) return 'downloaded';
  if (uploaded) return 'uploaded';
  return locked ? 'local-only' : 'unchanged';
}

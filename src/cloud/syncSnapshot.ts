import type { SQLiteDatabase } from 'expo-sqlite';

import type { LocalState } from '@/cloud/syncEngine';
import { ensureSyncItemSchema } from '@/cloud/syncItems';

/**
 * Helpers the preference and content adapters share around `sync_item`. A snapshot is the document an adapter last
 * saw in sync with the server; comparing the app's current state with it is how local edits are found.
 */

const schemaReady = new WeakMap<SQLiteDatabase, Promise<void>>();

/** Creates `sync_item` once per database handle; every adapter and hook awaits it before touching the table. */
export function syncItemTable(db: SQLiteDatabase): Promise<void> {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = ensureSyncItemSchema(db);
    schemaReady.set(db, ready);
    // A failed attempt must not stick: the next caller tries again.
    ready.catch(() => schemaReady.delete(db));
  }
  return ready;
}

/** JSON with object keys sorted, so the same value always serializes to the same text (a native module may list keys in any order). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return inner;
    return Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Rewrites the stored document of a record that is in sync (not dirty), without touching its times: after a pulled
 * record was written into the app, what the app reads back may differ in form (key order, trimmed text), and that
 * difference is not an edit.
 */
export async function setCleanJson(db: SQLiteDatabase, kind: string, id: string, json: string): Promise<void> {
  await db.runAsync('UPDATE sync_item SET json = ? WHERE kind = ? AND id = ? AND dirty = 0', json, kind, id);
}

/** Puts a record back as it was before `applyRemoteItem` stored a pulled version that could not be written into the app. */
export async function restoreItem(db: SQLiteDatabase, kind: string, id: string, previous: LocalState | null): Promise<void> {
  if (previous === null) {
    await db.runAsync('DELETE FROM sync_item WHERE kind = ? AND id = ?', kind, id);
    return;
  }
  await db.runAsync(
    `INSERT INTO sync_item (kind, id, json, updated_at, deleted_at, rank, dirty) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (kind, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at, rank = excluded.rank, dirty = excluded.dirty`,
    kind,
    id,
    previous.json,
    previous.updatedAt,
    previous.deletedAt,
    previous.rank,
    previous.dirty ? 1 : 0,
  );
}

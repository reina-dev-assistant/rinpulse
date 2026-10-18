import type { SQLiteDatabase } from 'expo-sqlite';

import { remoteWins, type LocalState, type ServerTimes, type WireRecord } from '@/cloud/syncEngine';

/**
 * What the phone knows about each synced record (`kind`, `id`): the document as last synced or edited, its times, and
 * whether it still has to go up. Preferences, Sticker Studio templates, routes, sensors and the small health kinds all
 * keep their sync state here; the thing itself (a setting, a route file) lives where the app keeps it, and an adapter
 * moves documents between the two. Like the gear and coach tables it is created from JS, not by the native migrations.
 *
 * Times follow `syncEngine.ts`: a `dirty` row has the phone's clock in `updated_at`, a clean row the server's.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS sync_item (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  rank INTEGER NOT NULL DEFAULT 0,
  dirty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, id)
) WITHOUT ROWID`;

const DIRTY_INDEX = 'CREATE INDEX IF NOT EXISTS sync_item_dirty ON sync_item (kind) WHERE dirty = 1';

interface Row {
  kind: string;
  id: string;
  json: string;
  updated_at: number;
  deleted_at: number | null;
  rank: number;
  dirty: number;
}

function toState(row: Row): LocalState {
  return {
    kind: row.kind,
    id: row.id,
    json: row.json,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    rank: row.rank,
    dirty: row.dirty === 1,
  };
}

export async function ensureSyncItemSchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`${SCHEMA};\n${DIRTY_INDEX}`);
}

export async function getItem(db: SQLiteDatabase, kind: string, id: string): Promise<LocalState | null> {
  const row = await db.getFirstAsync<Row>('SELECT * FROM sync_item WHERE kind = ? AND id = ?', kind, id);
  return row ? toState(row) : null;
}

export async function listItems(db: SQLiteDatabase, kind: string): Promise<LocalState[]> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM sync_item WHERE kind = ? ORDER BY id', kind);
  return rows.map(toState);
}

/** A local edit: stores the document (or a tombstone when `json` is null) as dirty at the phone's `now`. */
export async function putLocalItem(
  db: SQLiteDatabase,
  kind: string,
  id: string,
  json: string | null,
  now: number,
  rank = 0,
): Promise<void> {
  const previous = await getItem(db, kind, id);
  const document = json ?? previous?.json ?? '{}';
  await db.runAsync(
    `INSERT INTO sync_item (kind, id, json, updated_at, deleted_at, rank, dirty) VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT (kind, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at, rank = excluded.rank, dirty = 1`,
    kind,
    id,
    document,
    now,
    json === null ? now : null,
    rank,
  );
}

export async function listDirtyItems(db: SQLiteDatabase, kind: string, limit: number): Promise<WireRecord[]> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM sync_item WHERE kind = ? AND dirty = 1 ORDER BY updated_at LIMIT ?', kind, limit);
  return rows.map((row) => {
    const { dirty: _dirty, ...wire } = toState(row);
    return wire;
  });
}

/** Clears `dirty` and stores the server-time versions, for every sent record that is still exactly as sent. */
export async function markItemsPushed(
  db: SQLiteDatabase,
  sent: readonly WireRecord[],
  serverTimes: (record: WireRecord) => ServerTimes,
): Promise<void> {
  for (const record of sent) {
    const times = serverTimes(record);
    await db.runAsync(
      `UPDATE sync_item SET dirty = 0, updated_at = ?, deleted_at = ?
       WHERE kind = ? AND id = ? AND dirty = 1 AND updated_at = ? AND json = ?`,
      times.updatedAt,
      times.deletedAt,
      record.kind,
      record.id,
      record.updatedAt,
      record.json,
    );
  }
}

/** Stores a pulled record as clean when it wins over the local one (`remoteWins`). True when it was stored. */
export async function applyRemoteItem(db: SQLiteDatabase, remote: WireRecord, skew: number): Promise<boolean> {
  if (!remoteWins(await getItem(db, remote.kind, remote.id), remote, skew)) return false;
  await db.runAsync(
    `INSERT INTO sync_item (kind, id, json, updated_at, deleted_at, rank, dirty) VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT (kind, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at, rank = excluded.rank, dirty = 0`,
    remote.kind,
    remote.id,
    remote.json,
    remote.updatedAt,
    remote.deletedAt,
    remote.rank,
  );
  return true;
}

/** Forgets the sync state of every record (a different account, or this phone's data was deleted). */
export async function clearSyncItems(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM sync_item');
}

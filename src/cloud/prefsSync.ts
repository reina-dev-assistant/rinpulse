import type { SQLiteDatabase } from 'expo-sqlite';

import { cloudLog as log } from '@/cloud/log';
import type { RecordAdapter, WireRecord } from '@/cloud/syncEngine';
import { applyRemoteItem, getItem, listDirtyItems, listItems, markItemsPushed, putLocalItem } from '@/cloud/syncItems';
import { restoreItem, setCleanJson, stableStringify, syncItemTable, utf8Bytes } from '@/cloud/syncSnapshot';
import { errorMessage } from '@/format';

/**
 * Preferences that follow the account (kind `pref`, namespace `fit`; id = the key, document `{"value": ...}`). A setting
 * stays where the app keeps it (a kv-store entry, the native module); this file only knows how to read it, write it
 * and clear it, and keeps what the server last agreed on in `sync_item`.
 *
 * Local edits are found by comparing what `read()` returns now with the stored document, at sync time and when a setter
 * calls `notePrefChanged`, so a setting needs no change hook to sync. A value pulled from the account is written
 * with `write`/`clear` and the stored document is then rewritten from what `read()` returns, so applying a pulled
 * value is never mistaken for an edit.
 *
 * Which settings are synced, and which are not and why: docs/multi-device.md, and the list in `syncInventory.ts`.
 */

/** The cap of kind `pref` on the server. */
export const MAX_PREF_BYTES = 8 * 1024;

const KIND = 'pref';
const KEY_PATTERN = /^[a-z0-9._-]{1,64}$/;

export interface SyncedPref {
  /** Lowercase letters, digits, `.`, `_`, `-`; at most 64 characters. Never renamed once released: it is the record id. */
  key: string;
  /**
   * The setting as a JSON value, or `undefined` while it is at its default or was never chosen (defaults are never
   * uploaded). The same setting must always read as the same value, whichever order a native module lists fields in.
   */
  read(): Promise<unknown | undefined>;
  /** Stores a value that came from another phone. Throws for a value this build cannot use: the pulled record is then left alone. */
  write(value: unknown): Promise<void>;
  /** Back to the default (another phone reset it). */
  clear(): Promise<void>;
  /** Keys of other synced settings that `write` may change as a side effect, so applying this one is not read as an edit of those. */
  moves?: readonly string[];
  /** True for settings that describe how this phone looks and behaves (theme, language): "delete this phone's data" leaves them. */
  keepOnReset?: boolean;
}

const registry = new Map<string, SyncedPref>();
const appliedListeners = new Map<string, Set<() => void>>();
let bound: SQLiteDatabase | null = null;

/**
 * Makes a setting follow the account: `registerSyncedPref({ key: 'ftp', read, write, clear })`, once at module load.
 * `read` returns `undefined` for the default, `write` stores a pulled value, `clear` restores the default. Call
 * `notePrefChanged(key)` from the setter to stamp an edit at once (without it the edit is found at the next sync and
 * dated then). The list a build registers is in `syncInventory.ts`.
 */
export function registerSyncedPref(spec: SyncedPref): void {
  if (!KEY_PATTERN.test(spec.key)) throw new Error(`bad synced preference key: ${spec.key}`);
  registry.set(spec.key, spec);
}

/** Keys of every registered preference, sorted: a change of this list is what makes the next sync pull everything again. */
export function syncedPrefKeys(): string[] {
  return [...registry.keys()].sort();
}

/**
 * Calls `listener` after a pulled value for `key` was written, for settings the UI holds in memory (the theme). A setter's
 * own change does not call it.
 */
export function subscribePrefApplied(key: string, listener: () => void): () => void {
  let set = appliedListeners.get(key);
  if (!set) {
    set = new Set();
    appliedListeners.set(key, set);
  }
  set.add(listener);
  return () => void set.delete(listener);
}

function valueOf(json: string): { value: unknown } | null {
  try {
    const doc: unknown = JSON.parse(json);
    if (typeof doc !== 'object' || doc === null || !('value' in doc)) return null;
    return { value: doc.value };
  } catch {
    return null;
  }
}

/** Stamps a local change of one preference as dirty: a value that differs from the stored one, or the default after a value. */
async function scanPref(db: SQLiteDatabase, spec: SyncedPref, now: number, knownOnly: boolean): Promise<void> {
  let current: unknown;
  try {
    current = await spec.read();
  } catch (error) {
    // Not readable right now: that says nothing about the setting, so it is neither an edit nor a reset.
    log(`pref ${spec.key} not read: ${errorMessage(error)}`, 'error');
    return;
  }
  const row = await getItem(db, KIND, spec.key);
  if (current === undefined) {
    if (row && row.deletedAt === null) await putLocalItem(db, KIND, spec.key, null, now);
    return;
  }
  if (!row && knownOnly) return;
  const json = stableStringify({ value: current });
  if (utf8Bytes(json) > MAX_PREF_BYTES) {
    log(`pref ${spec.key} is over ${MAX_PREF_BYTES} bytes and stays on this phone`, 'error');
    return;
  }
  const stored = row && row.deletedAt === null ? valueOf(row.json) : null;
  if (stored && stableStringify({ value: stored.value }) === json) return;
  await putLocalItem(db, KIND, spec.key, json, now);
}

/**
 * Records the edits made since the last sync of preferences that already have a stored version. Runs before a pull, so a
 * pulled value never replaces a local edit nobody had noticed yet; a preference with no stored version is left to
 * `listDirty`, after the pull, so on a first sign-in the account's value wins over this phone's.
 */
export async function stampPrefEdits(db: SQLiteDatabase): Promise<void> {
  await syncItemTable(db);
  const now = Date.now();
  for (const spec of registry.values()) await scanPref(db, spec, now, true);
}

/** A setter changed `key`: stamp the edit now. Never rejects, and does nothing before the first sync has given the module a database. */
export async function notePrefChanged(key: string): Promise<void> {
  const spec = registry.get(key);
  if (!spec || !bound) return;
  try {
    await syncItemTable(bound);
    await scanPref(bound, spec, Date.now(), false);
  } catch (error) {
    log(`pref ${key} not recorded: ${errorMessage(error)}`, 'error');
  }
}

/** Every registered preference back to its default (this phone's data was deleted), except the ones that stay with the phone. */
export async function resetSyncedPrefs(): Promise<void> {
  for (const spec of registry.values()) {
    if (spec.keepOnReset) continue;
    try {
      await spec.clear();
    } catch (error) {
      log(`pref ${spec.key} not reset: ${errorMessage(error)}`, 'error');
    }
  }
}

/**
 * Marks what this phone holds now as already synced, without ever uploading it: a stored version per non-default preference,
 * clean and older than any real edit, so the account's value wins on a pull and only a later change goes up. For "keep
 * this phone's data but do not send it to the account that signs in" (`detachLocalData`).
 */
export async function baselinePrefs(db: SQLiteDatabase): Promise<void> {
  await syncItemTable(db);
  for (const spec of registry.values()) {
    let current: unknown;
    try {
      current = await spec.read();
    } catch (error) {
      log(`pref ${spec.key} not baselined: ${errorMessage(error)}`, 'error');
      continue;
    }
    if (current === undefined) {
      await db.runAsync('DELETE FROM sync_item WHERE kind = ? AND id = ?', KIND, spec.key);
      continue;
    }
    const json = stableStringify({ value: current });
    if (utf8Bytes(json) > MAX_PREF_BYTES) continue;
    await db.runAsync(
      `INSERT INTO sync_item (kind, id, json, updated_at, deleted_at, rank, dirty) VALUES (?, ?, ?, 0, NULL, 0, 0)
       ON CONFLICT (kind, id) DO UPDATE SET json = excluded.json, updated_at = 0, deleted_at = NULL, rank = 0, dirty = 0`,
      KIND,
      spec.key,
      json,
    );
  }
}

async function applyPulled(db: SQLiteDatabase, spec: SyncedPref, remote: WireRecord, skew: number): Promise<boolean> {
  const tombstone = remote.deletedAt !== null;
  const pulled = tombstone ? null : valueOf(remote.json);
  if (!tombstone && pulled === null) return false;
  const previous = await getItem(db, KIND, spec.key);
  if (!(await applyRemoteItem(db, remote, skew))) return false;
  try {
    if (pulled) await spec.write(pulled.value);
    else await spec.clear();
    // Only a live value is read back: after a reset a setting that cannot be cleared (a weather city) still reads as set,
    // and that is a local value to push later, not what the tombstone says.
    const now = pulled ? await spec.read() : undefined;
    if (now !== undefined) await setCleanJson(db, KIND, spec.key, stableStringify({ value: now }));
    for (const key of spec.moves ?? []) {
      const other = registry.get(key);
      const row = other ? await getItem(db, KIND, key) : null;
      if (!other || !row || row.dirty || row.deletedAt !== null) continue;
      const moved = await other.read();
      if (moved !== undefined) await setCleanJson(db, KIND, key, stableStringify({ value: moved }));
    }
  } catch (error) {
    await restoreItem(db, KIND, spec.key, previous);
    log(`pref ${spec.key} not applied: ${errorMessage(error)}`, 'error');
    return false;
  }
  for (const listener of appliedListeners.get(spec.key) ?? []) listener();
  return true;
}

/** The adapter for `runSync`. Binds `db` for `notePrefChanged`. */
export function prefsAdapter(db: SQLiteDatabase): RecordAdapter {
  bound = db;
  return {
    kind: KIND,
    async listDirty(limit) {
      await syncItemTable(db);
      const now = Date.now();
      for (const spec of registry.values()) await scanPref(db, spec, now, false);
      return listDirtyItems(db, KIND, limit);
    },
    async markPushed(sent, serverTimes) {
      await markItemsPushed(db, sent, serverTimes);
    },
    async applyRemote(remote, skew) {
      await syncItemTable(db);
      const spec = registry.get(remote.id);
      // A key this build does not know came from a newer app: not stored either, so it is not mistaken for a reset later.
      return spec ? applyPulled(db, spec, remote, skew) : false;
    },
  };
}

/** The stored versions of every preference, for tests and diagnostics. */
export function listPrefItems(db: SQLiteDatabase) {
  return listItems(db, KIND);
}

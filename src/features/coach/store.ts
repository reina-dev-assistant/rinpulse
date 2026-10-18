import type { SQLiteDatabase } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

import { EMPTY_COACH_DOC, type CoachDoc } from './doc';

/**
 * The coach document on the phone, one row of `coach_doc`. Like the gear tables, it is created here, from JS, not
 * through `joyofit-db-migrations.json` (shipped inside the native module, so a new entry needs a new binary); the native
 * side never touches it. Fold it into the list at the next native build.
 *
 * Every change goes through `updateCoachDoc`, which serialises read-modify-write so the matcher, the weekly adaptation
 * and the person's own taps never overwrite each other, and tells the screens (`useCoachDoc`) about the new document.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS coach_doc (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), doc TEXT NOT NULL, updated_at INTEGER NOT NULL)`;

export async function ensureCoachSchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(SCHEMA);
}

function parseDoc(json: string | undefined): CoachDoc {
  if (!json) return EMPTY_COACH_DOC;
  try {
    const value = JSON.parse(json) as Partial<CoachDoc> | null;
    if (!value || value.version !== 1) return EMPTY_COACH_DOC;
    return {
      version: 1,
      plan: value.plan ?? null,
      planUpdatedAt: value.planUpdatedAt ?? 0,
      done: value.done ?? {},
      logs: value.logs ?? {},
    };
  } catch {
    return EMPTY_COACH_DOC;
  }
}

export async function readCoachDoc(db: SQLiteDatabase): Promise<CoachDoc> {
  const row = await db.getFirstAsync<{ doc: string }>('SELECT doc FROM coach_doc WHERE id = 1');
  return parseDoc(row?.doc);
}

let current: CoachDoc | null = null;
const listeners = new Set<() => void>();
let queue: Promise<unknown> = Promise.resolve();

function publish(doc: CoachDoc): void {
  current = doc;
  for (const listener of listeners) listener();
}

export async function writeCoachDoc(db: SQLiteDatabase, doc: CoachDoc): Promise<void> {
  await db.runAsync(
    `INSERT INTO coach_doc (id, doc, updated_at) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at`,
    JSON.stringify(doc),
    Date.now(),
  );
  publish(doc);
}

/** Loads the document into memory (once per app run; later calls re-read it). */
export function loadCoachDoc(db: SQLiteDatabase): Promise<CoachDoc> {
  const run = queue.then(async () => {
    const doc = await readCoachDoc(db);
    publish(doc);
    return doc;
  });
  queue = run.catch(() => {});
  return run;
}

/** Changes the document: `change` gets the stored one and returns the new one, or null to leave it as it is. */
export function updateCoachDoc(db: SQLiteDatabase, change: (doc: CoachDoc) => CoachDoc | null): Promise<CoachDoc> {
  const run = queue.then(async () => {
    const doc = await readCoachDoc(db);
    const next = change(doc);
    if (next === null) {
      if (current !== doc) publish(doc);
      return doc;
    }
    await writeCoachDoc(db, next);
    return next;
  });
  queue = run.catch(() => {});
  return run;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The document in memory; `null` until `loadCoachDoc` has run. */
export function useCoachDoc(): CoachDoc | null {
  return useSyncExternalStore(subscribe, () => current);
}

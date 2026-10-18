import type { SQLiteDatabase } from 'expo-sqlite';

import { getCloudValue, setCloudState } from '@/db/cloud';

/**
 * Brings the recent steps and sleep of the JoyoRogo account onto a phone that does not have them (a new phone, or one
 * that was wiped), from the JoyoFit Worker's `GET /v1/restore`. What the watch itself syncs later is not affected:
 *
 *  - Rows go in with `INSERT OR IGNORE` and `imported = 1`. A row this phone measured is never overwritten, and an
 *    `imported` row is never uploaded again (`listStepSamplesAfter` / `listSleepAfter`), exported to Health Connect or
 *    Apple Health (the exporters read `imported = 0`) or counted in a family summary (`FamilyStoreSource`,
 *    `SleepStore.load(importedOnly = true)`).
 *  - When the watch later syncs the same minute, the native writer (`SyncStore.kt` / `SyncStore.swift`) runs
 *    `ON CONFLICT(timestamp) DO UPDATE ... imported = 0` (sleep: `ON CONFLICT(start, type)`): the primary key keeps it one
 *    row, and the row becomes this phone's own data (exported, uploaded again as the same key). Nothing is counted twice.
 *  - Native sync windows come from `device.last_sync`, not from the newest stored row, so restored rows never move them.
 *    Both tables are read by every screen without an `imported` filter, so restored rows are shown like any other.
 *
 * Resume: the window start and one keyset cursor per table are kept in `cloud_state` for the account after every page; an
 * interrupted restore continues where it stopped, a finished one is not repeated.
 */

/** The Worker refuses a window older than 400 days. */
export const RESTORE_MAX_DAYS = 399;
export const RESTORE_PAGE = 2_000;
const DAY_S = 86_400;

export type RestoreTable = 'steps' | 'sleep';

export interface RestorePage {
  rows: unknown[];
  cursor: string | number | null;
  hasMore: boolean;
}

export type FetchRestorePage = (table: RestoreTable, from: number, after: string | number | null, limit: number) => Promise<RestorePage>;

export interface RestoreOptions {
  days: number;
  /** Rows written so far; the total is not known beforehand. */
  onProgress?: (done: number, total: number | null) => void;
  userId: string;
  fetchPage: FetchRestorePage;
  now?: () => number;
}

interface Progress {
  /** Unix seconds: the window the restore covers. */
  from: number;
  /** Cursor of the next page; null: not started; 'done': finished (or the phone already had the window). */
  steps: string | number | null;
  sleep: string | number | null;
  writtenSteps: number;
  writtenSleep: number;
}

const DONE = 'done';
const stateKey = (userId: string) => `health_restore:${userId}`;

async function loadProgress(db: SQLiteDatabase, userId: string): Promise<Progress | null> {
  const raw = await getCloudValue(db, stateKey(userId));
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<Progress>;
    if (typeof value.from !== 'number') return null;
    return {
      from: value.from,
      steps: value.steps ?? null,
      sleep: value.sleep ?? null,
      writtenSteps: value.writtenSteps ?? 0,
      writtenSleep: value.writtenSleep ?? 0,
    };
  } catch {
    return null;
  }
}

/** The restore of every account is forgotten (this phone's data was deleted, so the next restore has to run again). */
export async function forgetHealthRestore(db: SQLiteDatabase): Promise<void> {
  await db.runAsync("DELETE FROM cloud_state WHERE key LIKE 'health_restore:%'");
}

const saveProgress = (db: SQLiteDatabase, userId: string, progress: Progress) => setCloudState(db, { [stateKey(userId)]: JSON.stringify(progress) });

const asInt = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) ? value : null);
const asOptionalInt = (value: unknown): number | null => (value === null || value === undefined ? null : asInt(value));

async function insertSteps(db: SQLiteDatabase, rows: unknown[]): Promise<number> {
  let written = 0;
  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      const r = (row ?? {}) as Record<string, unknown>;
      const timestamp = asInt(r.timestamp);
      const steps = asInt(r.steps);
      if (timestamp === null || steps === null) continue;
      const result = await db.runAsync(
        `INSERT OR IGNORE INTO step_samples (timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate, imported)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        timestamp,
        steps,
        asInt(r.calories) ?? 0,
        asInt(r.distance) ?? 0,
        asOptionalInt(r.heartRate),
        asOptionalInt(r.spo2),
        asOptionalInt(r.restingHeartRate),
      );
      // `changes` also counts what the rev triggers touched, so it only tells inserted from ignored.
      if (result.changes > 0) written += 1;
    }
  });
  return written;
}

async function insertSleep(db: SQLiteDatabase, rows: unknown[]): Promise<number> {
  let written = 0;
  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      const r = (row ?? {}) as Record<string, unknown>;
      const start = asInt(r.start);
      const end = asInt(r.end);
      const type = asInt(r.type);
      if (start === null || end === null || type === null) continue;
      const stage = typeof r.stage === 'string' ? r.stage : null;
      const result = await db.runAsync(
        'INSERT OR IGNORE INTO sleep_segments (start, end, type, stage, imported) VALUES (?, ?, ?, ?, 1)',
        start,
        end,
        type,
        stage,
      );
      // `changes` also counts what the rev triggers touched, so it only tells inserted from ignored.
      if (result.changes > 0) written += 1;
    }
  });
  return written;
}

/** True when the phone already stores rows from `from` (plus a day of slack for the first partial day) or earlier. */
async function holdsWindow(db: SQLiteDatabase, table: 'step_samples' | 'sleep_segments', from: number): Promise<boolean> {
  const column = table === 'step_samples' ? 'timestamp' : 'start';
  const row = await db.getFirstAsync<{ first: number | null }>(`SELECT MIN(${column}) AS first FROM ${table}`);
  return row?.first !== null && row?.first !== undefined && row.first <= from + DAY_S;
}

/** Rows written into `step_samples` and `sleep_segments`. */
export async function restoreWindow(db: SQLiteDatabase, options: RestoreOptions): Promise<{ steps: number; sleep: number }> {
  const now = Math.floor((options.now ?? Date.now)() / 1000);
  const days = Math.min(RESTORE_MAX_DAYS, Math.max(1, Math.floor(options.days)));
  const wanted = Math.floor((now - days * DAY_S) / DAY_S) * DAY_S;

  let progress = await loadProgress(db, options.userId);
  // A finished restore covers every later request of the same size; a larger one starts a new window.
  if (progress !== null && progress.steps === DONE && progress.sleep === DONE && progress.from <= wanted) return { steps: 0, sleep: 0 };
  if (progress === null || (progress.steps === DONE && progress.sleep === DONE)) {
    progress = {
      from: wanted,
      steps: (await holdsWindow(db, 'step_samples', wanted)) ? DONE : null,
      sleep: (await holdsWindow(db, 'sleep_segments', wanted)) ? DONE : null,
      writtenSteps: 0,
      writtenSleep: 0,
    };
    await saveProgress(db, options.userId, progress);
  }

  const report = (done: number) => options.onProgress?.(done, null);
  report(progress.writtenSteps + progress.writtenSleep);
  for (const table of ['steps', 'sleep'] as const) {
    while (progress[table] !== DONE) {
      const after = progress[table];
      const page = await options.fetchPage(table, progress.from, after, RESTORE_PAGE);
      const written = table === 'steps' ? await insertSteps(db, page.rows) : await insertSleep(db, page.rows);
      if (table === 'steps') progress.writtenSteps += written;
      else progress.writtenSleep += written;
      // A page that claims more but gives no new cursor would loop for ever.
      if (page.hasMore && (page.cursor === null || page.cursor === after)) throw new Error(`restore ${table}: the server sent no next cursor`);
      progress[table] = page.hasMore ? page.cursor : DONE;
      await saveProgress(db, options.userId, progress);
      report(progress.writtenSteps + progress.writtenSleep);
    }
  }
  return { steps: progress.writtenSteps, sleep: progress.writtenSleep };
}

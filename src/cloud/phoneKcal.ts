import type { SQLiteDatabase } from 'expo-sqlite';

import { isSyncPaused } from '@/cloud/syncGate';
import { parseSummary } from '@/features/workouts/summary';
import { sportLabel } from '@/features/workouts/sportLabel';

import { noteDiaryError, noteDiarySent } from './diaryNotes';
import { needsPhoneKcalSend, phoneKcalPayload, type PhoneKcalSent } from './phoneKcalPlan';
import { isQuietCloudError, strengthCall } from './strengthHttp';

/**
 * The energy of phone-recorded workouts in JoyoRogo's diary (rules in `phoneKcalPlan.ts`). What was sent is remembered in
 * `phone_kcal_sent`, created from JS like `strength_kcal_sent`, so each workout is sent once, again when its energy changes, and
 * retried at the next sync when the phone was offline or signed out.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS phone_kcal_sent (
  workout_start INTEGER PRIMARY KEY NOT NULL, external_id TEXT NOT NULL, date TEXT NOT NULL, kcal INTEGER NOT NULL, sent_at INTEGER NOT NULL)`;

const ready = new WeakSet<SQLiteDatabase>();

export async function ensurePhoneKcalSchema(db: SQLiteDatabase): Promise<void> {
  if (ready.has(db)) return;
  await db.execAsync(SCHEMA);
  ready.add(db);
}

/** One request at a time, like the strength energy push. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

interface Row {
  start: number;
  duration: number;
  calories: number;
  sportType: number;
  sportName: string;
  summaryJson: string;
}

const COLUMNS = `start, duration, calories, sport_type AS sportType, sport_name AS sportName, summary_json AS summaryJson`;

/** Sends one workout's energy if it is a phone recording and JoyoRogo does not have it yet. True when a request was made. */
async function sendOne(db: SQLiteDatabase, row: Row): Promise<boolean> {
  if (parseSummary(row.summaryJson).source !== 'phone') return false;
  const payload = phoneKcalPayload({ ...row, name: sportLabel(row.sportName) });
  if (!payload) return false;
  const sent = await db.getFirstAsync<PhoneKcalSent>(
    'SELECT external_id AS externalId, date, kcal FROM phone_kcal_sent WHERE workout_start = ?',
    row.start,
  );
  if (!needsPhoneKcalSend(payload, sent)) return false;
  await strengthCall('exercise/upsertJoyofit', payload);
  await db.runAsync(
    `INSERT INTO phone_kcal_sent (workout_start, external_id, date, kcal, sent_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (workout_start) DO UPDATE SET external_id = excluded.external_id, date = excluded.date, kcal = excluded.kcal, sent_at = excluded.sent_at`,
    row.start,
    payload.externalId,
    payload.date,
    payload.kcal,
    Date.now(),
  );
  await noteDiarySent(db);
  return true;
}

/** Right after a phone recording was saved. Quiet when nobody is signed in; any other failure is logged and left for the retry. Never throws. */
export function pushPhoneKcal(db: SQLiteDatabase, workoutId: number): Promise<void> {
  return serial(async () => {
    if (isSyncPaused()) return;
    try {
      await ensurePhoneKcalSchema(db);
      const row = await db.getFirstAsync<Row>(`SELECT ${COLUMNS} FROM workouts WHERE id = ?`, workoutId);
      if (row) await sendOne(db, row);
    } catch (error) {
      if (!isQuietCloudError(error)) await noteDiaryError(db, `phone workout energy of ${workoutId}`, error);
    }
  });
}

const RETRY_WINDOW_S = 30 * 86_400;
const MAX_PER_PASS = 20;

/** The catch-up pass of the sync: phone recordings of the last 30 days that JoyoRogo has not got. Never throws. */
export function retryPhoneKcal(db: SQLiteDatabase): Promise<void> {
  return serial(async () => {
    if (isSyncPaused()) return;
    try {
      await ensurePhoneKcalSchema(db);
      const rows = await db.getAllAsync<Row>(
        `SELECT ${COLUMNS} FROM workouts WHERE imported = 1 AND complete = 1 AND start >= ? AND summary_json LIKE '%"source":"phone"%' ORDER BY start DESC`,
        Math.floor(Date.now() / 1000) - RETRY_WINDOW_S,
      );
      let requests = 0;
      for (const row of rows) {
        if (requests >= MAX_PER_PASS) break;
        try {
          if (await sendOne(db, row)) requests += 1;
        } catch (error) {
          if (!isQuietCloudError(error)) await noteDiaryError(db, `phone workout energy of ${row.start}`, error);
          return;
        }
      }
    } catch (error) {
      if (!isQuietCloudError(error)) await noteDiaryError(db, 'phone workout energy retry', error);
    }
  });
}

/** A different JoyoRogo account: it was told nothing, so every phone recording is sent to it again. */
export async function forgetPhoneKcal(db: SQLiteDatabase): Promise<void> {
  await ensurePhoneKcalSchema(db);
  await db.runAsync('DELETE FROM phone_kcal_sent');
}

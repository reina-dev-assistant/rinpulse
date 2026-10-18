import type { SQLiteDatabase } from 'expo-sqlite';

import { CloudHttpError } from '@/cloud/api';
import { isSyncPaused } from '@/cloud/syncGate';
import { DETACHED_HASH, getCloudState } from '@/db/cloud';
import { purgeDeletedWorkouts } from '@/features/workouts/purgeDeleted';
import { sportLabel } from '@/features/workouts/sportLabel';

import { noteDiaryError, noteDiarySent } from './diaryNotes';
import { isQuietCloudError, strengthCall } from './strengthHttp';
import { pendingWatchSends, runWatchKcalPass, type SendFailure, type WatchKcalIo, type WatchKcalPass } from './watchKcalPass';
import type { WatchKcalPayload, WatchKcalSent, WatchWorkoutRow } from './watchKcalPlan';
import { WATCH_KCAL_WINDOW_S } from './watchKcalPlan';

export type { WatchKcalPass };

/**
 * The energy of the workouts the watch recorded in JoyoRogo's diary (rules in `watchKcalPlan.ts`, the pass in `watchKcalPass.ts`). What
 * JoyoRogo was told is remembered in `watch_kcal_sent`, created from JS like `phone_kcal_sent`, with the account it was told to: a workout
 * is sent once per account, sent again when its energy or day changes, and picked up by the next pass when the phone was offline or
 * signed out. Every sync runs the pass, so a workout that was missed (a JoyoRogo that could not read Health Connect, a phone without
 * network) arrives by itself, and a repeat is harmless: the row is keyed by `watch:<start>`. A workout deleted on the phone is taken out of the
 * diary by `features/workouts/deleteWorkout.ts` (`exercise.removeJoyofit`); its deleted-start tombstone keeps this pass from sending it again.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS watch_kcal_sent (
  workout_start INTEGER PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, external_id TEXT NOT NULL, date TEXT NOT NULL, kcal INTEGER NOT NULL, sent_at INTEGER NOT NULL)`;

const ready = new WeakSet<SQLiteDatabase>();

export async function ensureWatchKcalSchema(db: SQLiteDatabase): Promise<void> {
  if (ready.has(db)) return;
  await db.execAsync(SCHEMA);
  ready.add(db);
}

/** One request at a time, like the other diary pushes. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

const SELECT_WORKOUTS = `SELECT w.start, w."end" AS "end", w.duration, w.calories, w.sport_type AS sportType, w.sport_name AS sportName,
    w.imported, w.complete, c.hash AS cloudHash
  FROM workouts w LEFT JOIN cloud_workout c ON c.start = w.start
  WHERE w.start >= ? ORDER BY w.start DESC`;

function classify(error: unknown): SendFailure {
  if (isQuietCloudError(error)) return 'quiet';
  // The server answered about this workout (a refusal): the next one may still go. No usable answer: the pass ends.
  if (error instanceof CloudHttpError && error.status < 500 && error.status !== 401 && error.status !== 429) return 'refused';
  return 'stop';
}

function ioFor(db: SQLiteDatabase): WatchKcalIo {
  return {
    paused: isSyncPaused,
    boundAccount: async () => (await getCloudState(db)).userId,
    workouts: () => db.getAllAsync<WatchWorkoutRow>(SELECT_WORKOUTS, Math.floor(Date.now() / 1000) - WATCH_KCAL_WINDOW_S),
    sentFor: (start) =>
      db.getFirstAsync<WatchKcalSent>(
        'SELECT account_id AS accountId, external_id AS externalId, date, kcal FROM watch_kcal_sent WHERE workout_start = ?',
        start,
      ),
    label: sportLabel,
    send: async (payload: WatchKcalPayload) => {
      await strengthCall('exercise/upsertJoyofit', payload);
    },
    markSent: async (start, accountId, payload) => {
      await db.runAsync(
        `INSERT INTO watch_kcal_sent (workout_start, account_id, external_id, date, kcal, sent_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (workout_start) DO UPDATE SET account_id = excluded.account_id, external_id = excluded.external_id,
           date = excluded.date, kcal = excluded.kcal, sent_at = excluded.sent_at`,
        start,
        accountId,
        payload.externalId,
        payload.date,
        payload.kcal,
        Date.now(),
      );
    },
    classify,
    onSent: () => noteDiarySent(db),
    onError: (start, error) => noteDiaryError(db, start > 0 ? `workout energy of ${start}` : 'workout energy', error),
    detachedHash: DETACHED_HASH,
    nowSec: () => Math.floor(Date.now() / 1000),
  };
}

/** Workouts the next pass would send to the account the phone is bound to; 0 when none. Read by the status in Settings. */
export async function countWatchKcalPending(db: SQLiteDatabase): Promise<number> {
  const { userId } = await getCloudState(db);
  if (userId === null) return 0;
  await ensureWatchKcalSchema(db);
  return (await pendingWatchSends(ioFor(db), userId)).length;
}

/** Workouts this pass told the account the phone is bound to about. */
export async function countWatchKcalSent(db: SQLiteDatabase): Promise<number> {
  const { userId } = await getCloudState(db);
  if (userId === null) return 0;
  await ensureWatchKcalSchema(db);
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM watch_kcal_sent WHERE account_id = ?', userId);
  return row?.n ?? 0;
}

/**
 * Runs the pass for the signed-in account `accountId` (rules in `watchKcalPass.ts`). Failures are logged, remembered for the status and left
 * for the next pass; nobody signed in, a JoyoRogo without the procedure and an open account question are quiet. Never throws.
 */
export function pushWatchKcal(db: SQLiteDatabase, accountId: string): Promise<WatchKcalPass> {
  return serial(async () => {
    try {
      await ensureWatchKcalSchema(db);
    } catch (error) {
      await noteDiaryError(db, 'workout energy', error);
      return { sent: 0, stopped: true };
    }
    await purgeDeletedWorkouts(db);
    return runWatchKcalPass(ioFor(db), accountId);
  });
}

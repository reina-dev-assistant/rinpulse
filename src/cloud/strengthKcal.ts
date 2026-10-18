import type { SQLiteDatabase } from 'expo-sqlite';

import { CloudHttpError } from '@/cloud/api';
import { isSyncPaused } from '@/cloud/syncGate';
import { getDetachedAt } from '@/db/cloud';
import { t } from '@/i18n';
import { getStrengthWorkout } from '@/features/strength/store';
import type { StrengthWorkout } from '@/features/strength/types';

import { noteDiaryError, noteDiarySent } from './diaryNotes';
import { isQuietCloudError, strengthCall } from './strengthHttp';
import { desiredKcal, planKcal, type KcalAction, type KcalSentRow } from './strengthKcalPlan';

/**
 * A strength workout's burned energy in JoyoRogo's diary (`exercise/upsertJoyofit`, `exercise/removeJoyofit`; rules in
 * `strengthKcalPlan.ts`). What JoyoRogo was told is remembered in `strength_kcal_sent`, a small table created from JS like the
 * strength tables, so each workout is sent once, sent again when its energy or day changes, taken back when it is deleted or
 * later merged with a watch workout, and retried at the next sync when the phone was offline or signed out.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS strength_kcal_sent (
  workout_id TEXT PRIMARY KEY NOT NULL, external_id TEXT NOT NULL, date TEXT NOT NULL, kcal INTEGER NOT NULL, sent_at INTEGER NOT NULL)`;

const ready = new WeakSet<SQLiteDatabase>();

export async function ensureKcalSchema(db: SQLiteDatabase): Promise<void> {
  if (ready.has(db)) return;
  await db.execAsync(SCHEMA);
  ready.add(db);
}

/** Workouts last changed within this window are looked at by the retry pass even when nothing was sent for them yet. */
const RETRY_WINDOW_MS = 30 * 86_400_000;
/** Requests per retry pass: a long backlog (a new phone) does not hold a sync up. */
const MAX_ACTIONS_PER_PASS = 40;

/** One request at a time: a save and a sync that both want the same workout cannot race each other into two rows or a stale state. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

const label = (name: string): string =>
  name === '' ? t('strengthcloud:kcal.nameEmpty') : t('strengthcloud:kcal.name', { name });

async function sentRow(db: SQLiteDatabase, workoutId: string): Promise<KcalSentRow | null> {
  return db.getFirstAsync<KcalSentRow>(
    'SELECT workout_id AS workoutId, external_id AS externalId, date, kcal, sent_at AS sentAt FROM strength_kcal_sent WHERE workout_id = ?',
    workoutId,
  );
}

async function ownRow(db: SQLiteDatabase, workout: StrengthWorkout): Promise<boolean> {
  if (workout.workoutStart === null) return false;
  const row = await db.getFirstAsync<{ imported: number }>('SELECT imported FROM workouts WHERE start = ?', workout.workoutStart);
  return row?.imported === 1;
}

async function perform(db: SQLiteDatabase, workoutId: string, action: KcalAction): Promise<void> {
  if (action.type === 'send') {
    await strengthCall('exercise/upsertJoyofit', action.payload);
    await db.runAsync(
      `INSERT INTO strength_kcal_sent (workout_id, external_id, date, kcal, sent_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (workout_id) DO UPDATE SET external_id = excluded.external_id, date = excluded.date, kcal = excluded.kcal, sent_at = excluded.sent_at`,
      workoutId,
      action.payload.externalId,
      action.payload.date,
      action.payload.kcal,
      Date.now(),
    );
    await noteDiarySent(db);
  } else if (action.type === 'remove') {
    await strengthCall('exercise/removeJoyofit', { externalId: action.externalId });
    await db.runAsync('DELETE FROM strength_kcal_sent WHERE workout_id = ?', workoutId);
  }
}

/** Brings JoyoRogo's row of one workout to what it should be (`workout` null or `gone`: it should have none). True when a request was made. */
async function reconcile(db: SQLiteDatabase, workoutId: string, workout: StrengthWorkout | null, gone: boolean): Promise<boolean> {
  const desired = workout && !gone ? desiredKcal(workout, await ownRow(db, workout), label) : null;
  const action = planKcal(desired, await sentRow(db, workoutId));
  await perform(db, workoutId, action);
  return action.type !== 'none';
}

/**
 * Sends (or takes back) the energy of a workout that was just saved or deleted. Quiet when nobody is signed in or the server does
 * not have the procedure; any other failure is logged and left for `retryStrengthKcal`. Never throws.
 */
export function pushStrengthKcal(db: SQLiteDatabase, workout: StrengthWorkout, change: 'saved' | 'deleted'): Promise<void> {
  return serial(async () => {
    if (isSyncPaused()) return;
    try {
      await ensureKcalSchema(db);
      await reconcile(db, workout.id, workout, change === 'deleted');
    } catch (error) {
      if (!isQuietCloudError(error)) await noteDiaryError(db, `strength energy of ${workout.id}`, error);
    }
  });
}

/**
 * The catch-up pass `syncStrength` runs: every workout JoyoRogo was told about is checked against the workout as it is now
 * (deleted, merged with a watch workout, energy or day changed), and recently changed workouts that were never sent get their
 * turn. Stops at the first connection problem (the next sync tries again). Never throws.
 */
export function retryStrengthKcal(db: SQLiteDatabase): Promise<void> {
  return serial(async () => {
    if (isSyncPaused()) return;
    try {
      await ensureKcalSchema(db);
      const sent = await db.getAllAsync<{ workoutId: string }>('SELECT workout_id AS workoutId FROM strength_kcal_sent');
      const todo = new Set(sent.map((row) => row.workoutId));
      const recent = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM strength_record WHERE kind = 'workout' AND deleted_at IS NULL AND workout_start IS NOT NULL AND updated_at >= ?`,
        // After "keep separate" the workouts of the earlier account are not sent to the new one's diary: only newer changes.
        Math.max(Date.now() - RETRY_WINDOW_MS, (await getDetachedAt(db)) ?? 0),
      );
      for (const row of recent) todo.add(row.id);

      let requests = 0;
      for (const workoutId of todo) {
        if (requests >= MAX_ACTIONS_PER_PASS) break;
        try {
          if (await reconcile(db, workoutId, await getStrengthWorkout(db, workoutId), false)) requests += 1;
        } catch (error) {
          if (isQuietCloudError(error)) return;
          await noteDiaryError(db, `strength energy of ${workoutId}`, error);
          // The server answered about this workout (a refusal): the next one may still go. No answer at all: stop.
          if (!(error instanceof CloudHttpError) || error.status >= 500) return;
          requests += 1;
        }
      }
    } catch (error) {
      if (!isQuietCloudError(error)) await noteDiaryError(db, 'strength energy retry', error);
    }
  });
}

/** A different JoyoRogo account: it was told nothing, so every workout is sent to it again. */
export async function forgetStrengthKcal(db: SQLiteDatabase): Promise<void> {
  await ensureKcalSchema(db);
  await db.runAsync('DELETE FROM strength_kcal_sent');
}

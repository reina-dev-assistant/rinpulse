import type { SQLiteDatabase } from 'expo-sqlite';

import { CloudHttpError } from '@/cloud/api';
import { cloudLog } from '@/cloud/log';
import { externalIdForPhone } from '@/cloud/phoneKcalPlan';
import { rogo } from '@/cloud/rogo';
import { externalIdFor } from '@/cloud/strengthKcalPlan';
import { isQuietCloudError, strengthCall } from '@/cloud/strengthHttp';
import { isSyncPaused } from '@/cloud/syncGate';
import { externalIdForWatch } from '@/cloud/watchKcalPlan';
import { getCloudState } from '@/db/cloud';
import { ensureCoachSchema, updateCoachDoc } from '@/features/coach/store';
import { afterStrengthSaved } from '@/features/strength/afterSave';
import { setEbike } from '@/features/cycling/settings';
import { deleteStrengthWorkout, ensureStrengthSchema, getStrengthWorkoutByStart } from '@/features/strength/store';
import { watchStats } from '@/features/social/postStats';
import { parseSummary } from '@/features/workouts/summary';
import { errorMessage } from '@/format';

import { clearReplayVideos } from '../replay/exportVideo';
import {
  flushDeleteTombstones,
  removeWorkoutRows,
  type DeleteIo,
  type DeleteOps,
} from './deleteCore';

/**
 * Deleting a workout from JoyoFit, everything it leaves behind included:
 * - the `workouts` row with its points, sensors, Gear link, ride metrics and the sent-to-JoyoRogo bookkeeping (`deleteCore.ts`);
 * - the strength record stored as it (a tombstone: strength sync tells the cloud), its link in the Coach plan, the e-bike mark and the replay video cache;
 * - the account's side, remembered in `workout_deleted` and retried until it is told (`flushDeleteTombstones`): the workout's cloud copy
 *   (`watchWorkout/remove`, the tombstone other phones pull and answer with a delete), the JoyoRogo diary rows (`exercise/removeJoyofit`
 *   for `watch:<start>`, `phone:<start>`, `strength:<id>`) and, when the person agreed, its feed posts (`social/deletePost`);
 * - the tombstone itself, which keeps the watch's history from bringing the workout back.
 * Strava is left alone: its activity stays, and so does the local `strava_upload` row, so the workout is never uploaded twice.
 */

/** `statsJson.startedAt` is in milliseconds. Newest 8 pages (200 posts) of the person's own posts are searched. */
const POST_PAGES = 8;

/** The feed posts the person made of the workout that started at `start`. Empty when nobody is signed in or the feed cannot be reached. */
export async function findWorkoutPosts(start: number): Promise<string[]> {
  const ids: string[] = [];
  try {
    let cursor: number | undefined;
    for (let page = 0; page < POST_PAGES; page += 1) {
      const answer = await rogo.social.myPosts(cursor);
      for (const post of answer.items) {
        if (post.kind === 'latihan' && watchStats(post)?.startedAt === start * 1000) ids.push(post.id);
      }
      if (answer.nextCursor === null) break;
      cursor = answer.nextCursor;
    }
  } catch (error) {
    if (!isQuietCloudError(error)) cloudLog(`feed posts of workout ${start} not looked up: ${errorMessage(error)}`, 'error');
  }
  return ids;
}

/** The diary rows JoyoRogo may hold for a workout: the watch's, the phone recording's and the strength logger's. */
export function diaryIdsOf(start: number, row: { imported: number; summaryJson: string }, strengthId: string | null): string[] {
  const ids: string[] = [];
  if (row.imported === 0) ids.push(externalIdForWatch(start));
  if (parseSummary(row.summaryJson).source === 'phone') ids.push(externalIdForPhone(start));
  if (strengthId !== null) ids.push(externalIdFor(strengthId));
  return ids;
}

/** 4xx answers (except an expired session and rate limiting) are final; no network, 5xx, 401 and 429 are tried again at the next sync. */
function classify(error: unknown): 'quiet' | 'refused' | 'stop' {
  if (isQuietCloudError(error)) return 'quiet';
  if (error instanceof CloudHttpError && error.status < 500 && error.status !== 401 && error.status !== 429) return 'refused';
  return 'stop';
}

function ioFor(db: SQLiteDatabase): DeleteIo {
  return {
    boundAccount: async () => (await getCloudState(db)).userId,
    paused: isSyncPaused,
    removeCloudWorkout: async (start) => {
      await strengthCall('watchWorkout/remove', { start });
    },
    removeDiaryRow: async (externalId) => {
      await strengthCall('exercise/removeJoyofit', { externalId });
    },
    deletePost: async (id) => {
      await strengthCall('social/deletePost', { id });
    },
    classify,
    onError: (what, error) => cloudLog(`${what} not sent: ${errorMessage(error)}`, 'error'),
  };
}

/** One request at a time, like the diary pushes: a delete and a sync that both flush must not send the same call twice. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

/** Tells the account about the workouts deleted here (cloud tombstone, diary rows, feed posts). Quiet when nobody is signed in. Never throws. */
export function flushWorkoutDeletes(db: SQLiteDatabase): Promise<void> {
  return serial(async () => {
    await flushDeleteTombstones(db, ioFor(db));
  });
}

/** The Coach plan sessions that this workout finished are open again. */
async function releaseCoachSessions(db: SQLiteDatabase, start: number, nowMs: number): Promise<void> {
  await ensureCoachSchema(db);
  await updateCoachDoc(db, (doc) => {
    const linked = Object.entries(doc.done).filter(([, entry]) => entry.workoutStart === start && !entry.cleared);
    if (linked.length === 0) return null;
    const done = { ...doc.done };
    for (const [key, entry] of linked) done[key] = { ...entry, at: nowMs, cleared: true };
    return { ...doc, done };
  });
}

/**
 * Deletes the workout now. `postIds` are the feed posts to take down with it (empty keeps them). Returns false when the phone has no such
 * workout. The account's side is sent right away when it can be and retried at the next sync when it cannot.
 */
export async function deleteWorkout(db: SQLiteDatabase, start: number, postIds: readonly string[], nowMs = Date.now()): Promise<boolean> {
  const row = await db.getFirstAsync<{ imported: number; summaryJson: string }>('SELECT imported, summary_json AS summaryJson FROM workouts WHERE start = ?', start);
  if (!row) return false;
  await ensureStrengthSchema(db);
  const strength = await getStrengthWorkoutByStart(db, start);
  const accountId = (await getCloudState(db)).userId;
  const ops: DeleteOps = {
    accountId,
    cloud: accountId !== null,
    diary: accountId !== null ? diaryIdsOf(start, row, strength?.id ?? null) : [],
    posts: accountId !== null ? postIds : [],
  };
  // The record goes first: once its row is gone nothing else would find it.
  if (strength) await deleteStrengthWorkout(db, strength, nowMs);
  const removed = await removeWorkoutRows(db, start, ops, nowMs);
  await releaseCoachSessions(db, start, nowMs).catch((error) => cloudLog(`coach link of workout ${start} not released: ${errorMessage(error)}`, 'error'));
  setEbike(start, false);
  clearReplayVideos();
  if (strength) void afterStrengthSaved(db, strength, 'deleted');
  await flushWorkoutDeletes(db);
  return removed;
}

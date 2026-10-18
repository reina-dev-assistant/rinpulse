import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { CloudHttpError, CloudLockedError, cloudRequest } from '@/cloud/api';
import { APP_BUILD } from '@/cloud/build';
import { cloudLog } from '@/cloud/log';
import { rogoCall } from '@/cloud/rogo';
import { getWorkoutBlob, putWorkout } from '@/cloud/workoutHttp';
import { buildWorkoutDoc, gzipDoc, readWorkoutDoc } from '@/cloud/workoutDoc';
import { loadStoredWorkout } from '@/cloud/workoutAnalysis';
import { clearFailure, parseFailures, partitionPending, recordFailure, type WorkoutFailures } from '@/cloud/workoutFailures';
import { deleteLocalWorkout, restoreWorkout } from '@/cloud/workoutStore';
import { wipeStrengthCloud } from '@/cloud/strengthSync';
import {
  adoptAccount,
  forgetCloudWorkouts,
  getCloudValue,
  getWorkoutIdentity,
  listPendingWorkouts,
  resetCloudCursors,
  setCloudState,
  upsertCloudWorkout,
  WORKOUT_FAILED_KEY,
  WORKOUT_PULL_CURSOR_KEY,
} from '@/db/cloud';
import { errorMessage } from '@/format';
import { ANALYSIS_ENGINE_REV } from '@/features/workouts/analysis/engineRev';
import { isWorkoutDeleted, recordRemoteDeletion } from '@/features/workouts/deleteCore';
import { purgeDeletedWorkouts } from '@/features/workouts/purgeDeleted';

/**
 * JoyoRogo cloud workouts (Pro): one gzip document per workout, uploaded one at a time with progress kept per
 * workout in `cloud_workout`, and pulled back onto a phone that does not have them. The contract is
 * `docs/watch-workout-cloud.md` in the joyorogo repo.
 */

/** The cursor of `watchWorkout.changes`: where the last pulled page ended. */
interface PullCursor {
  updatedAt: number;
  start: number;
}

/** One entry of `watchWorkout.changes` (the fields the phone reads of a `WatchWorkoutListItem`). */
interface ChangeItem {
  start: number;
  version: number;
  /** Epoch ms of the delete; null for a live workout. */
  deletedAt: number | null;
}

interface ChangesPage {
  items: ChangeItem[];
  cursor: PullCursor | null;
  hasMore: boolean;
}

/** `watchWorkout.status`: the account's Pro state and what its cloud copy holds. */
export interface CloudWorkoutStatus {
  unlocked: boolean;
  count: number;
  bytes: number;
  quotaBytes: number;
  lastChangeAt: number | null;
}

export interface UploadProgress {
  done: number;
  total: number;
}

export interface PullReport {
  restored: number;
  deleted: number;
  /** Documents that could not be read (missing, corrupt); the pull moved past them. */
  skipped: number;
}

export interface PushReport {
  uploaded: number;
  /** Workouts the server refused as a document, this run. */
  refused: number;
  /** Workouts deleted from the phone because they were deleted from the cloud. */
  deleted: number;
  /** The account's cloud storage is full: the run stopped, this says why. */
  quota: string | null;
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const fetchCloudWorkoutStatus = () => rogoCall<CloudWorkoutStatus>('watchWorkout/status', {});

function parseCursor(raw: string | null): PullCursor | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PullCursor> | null;
    return typeof value?.updatedAt === 'number' && typeof value.start === 'number' ? { updatedAt: value.updatedAt, start: value.start } : null;
  } catch {
    return null;
  }
}

// --- Restore ---------------------------------------------------------------------------------------------------------

async function applyChange(db: SQLiteDatabase, item: ChangeItem, report: PullReport): Promise<void> {
  const local = await getWorkoutIdentity(db, item.start);
  if (item.deletedAt !== null) {
    // The tombstone is authoritative: a delete made on the web or on another phone.
    await deleteLocalWorkout(db, item.start);
    // The watch's history must not bring it back on this phone either.
    await recordRemoteDeletion(db, item.start);
    if (local) report.deleted += 1;
    return;
  }
  // Deleted on this phone, and the cloud has not heard yet (offline, or the retry is still waiting): never restore it.
  if (await isWorkoutDeleted(db, item.start)) return;
  // The phone is the source of its own data: a workout it has is never overwritten, whatever version the cloud holds.
  if (local) return;
  const bytes = await getWorkoutBlob(item.start);
  if (!bytes) {
    cloudLog(`workout ${item.start} is in the list but has no document; skipped`, 'error');
    report.skipped += 1;
    return;
  }
  try {
    const doc = readWorkoutDoc(bytes);
    if (doc.workout.start !== item.start) throw new Error('document is of another workout');
    const hash = await sha256Hex(bytes);
    if (await restoreWorkout(db, doc, { version: item.version, hash, bytes: bytes.byteLength })) report.restored += 1;
  } catch (error) {
    if (error instanceof CloudHttpError) throw error;
    cloudLog(`workout ${item.start} could not be restored: ${errorMessage(error)}`, 'error');
    report.skipped += 1;
  }
}

/**
 * Brings the phone up to date with the cloud: every change after the stored cursor, page by page. A workout the phone does
 * not have is downloaded and written locally (and recorded in `cloud_workout`, so it is not uploaded again); a tombstone
 * deletes the local copy. The cursor moves after each page, so an interrupted pull resumes. Reading is never locked: this
 * works for accounts without Pro too.
 */
export async function pullWorkouts(db: SQLiteDatabase): Promise<PullReport> {
  const report: PullReport = { restored: 0, deleted: 0, skipped: 0 };
  let cursor = parseCursor(await getCloudValue(db, WORKOUT_PULL_CURSOR_KEY));
  for (;;) {
    const page = await rogoCall<ChangesPage>('watchWorkout/changes', { since: cursor });
    for (const item of page.items) {
      await applyChange(db, item, report);
      await yieldToUi();
    }
    if (page.cursor) {
      cursor = page.cursor;
      await setCloudState(db, { [WORKOUT_PULL_CURSOR_KEY]: JSON.stringify(cursor) });
    }
    if (!page.hasMore) break;
  }
  if (report.restored > 0 || report.deleted > 0 || report.skipped > 0) {
    cloudLog(`pulled workouts: ${report.restored} restored, ${report.deleted} deleted, ${report.skipped} skipped`);
  }
  return report;
}

// --- Upload ----------------------------------------------------------------------------------------------------------

async function saveFailures(db: SQLiteDatabase, failures: WorkoutFailures): Promise<void> {
  await setCloudState(db, { [WORKOUT_FAILED_KEY]: Object.keys(failures.items).length > 0 ? JSON.stringify(failures) : null });
}

/**
 * Uploads every workout the cloud does not have in its current form (see `listPendingWorkouts`), newest first and one at a
 * time: read its `rev`, build and gzip the document, PUT it, and record it in `cloud_workout` before the next, so the
 * backfill of a long history resumes after any interruption. Returns when nothing is left or the account's storage is full.
 *
 * - Not Pro (`status.unlocked` false, or a 402): throws `CloudLockedError`; nothing is uploaded.
 * - 410 `deleted`: the workout was deleted from the cloud; the tombstone is authoritative, so it is deleted here.
 * - 400, or a document too big even alone: counted as refused, logged, remembered until the workout changes or the app
 *   is updated, and the run goes on.
 * - 413 `quota`: stops, and says so in `quota`.
 * Anything else (network, 401, 5xx after retries) throws; what was uploaded stays recorded.
 */
export async function pushWorkouts(db: SQLiteDatabase, onProgress: (progress: UploadProgress) => void): Promise<PushReport> {
  const report: PushReport = { uploaded: 0, refused: 0, deleted: 0, quota: null };
  await purgeDeletedWorkouts(db);
  let failures = parseFailures(await getCloudValue(db, WORKOUT_FAILED_KEY), APP_BUILD);
  const { todo } = partitionPending(await listPendingWorkouts(db, ANALYSIS_ENGINE_REV), failures);
  if (todo.length === 0) return report;
  if (!(await fetchCloudWorkoutStatus()).unlocked) throw new CloudLockedError();

  const total = todo.length;
  for (const [index, pending] of todo.entries()) {
    onProgress({ done: index, total });
    await yieldToUi();
    // The id and `rev` as they are now: the workout may have been rewritten since the list was read.
    const identity = await getWorkoutIdentity(db, pending.start);
    if (!identity) continue;
    let gzip: Uint8Array<ArrayBuffer>;
    let hash: string;
    try {
      const stored = await loadStoredWorkout(db, identity.id);
      if (!stored) continue;
      gzip = gzipDoc(buildWorkoutDoc({ ...stored, engineRev: ANALYSIS_ENGINE_REV }));
      hash = await sha256Hex(gzip);
    } catch (error) {
      // The document could not be built: the same for every run of this build until the workout changes.
      failures = recordFailure(failures, pending.start, identity.rev, errorMessage(error));
      await saveFailures(db, failures);
      report.refused += 1;
      cloudLog(`workout ${pending.start} could not be prepared: ${errorMessage(error)}`, 'error');
      continue;
    }
    try {
      const sent = await putWorkout(pending.start, gzip);
      await upsertCloudWorkout(db, {
        start: pending.start,
        rev: identity.rev,
        engineRev: ANALYSIS_ENGINE_REV,
        version: sent.version,
        hash,
        bytes: sent.bytes,
        uploadedAt: Math.floor(Date.now() / 1000),
      });
      report.uploaded += 1;
      if (pending.start in failures.items) {
        failures = clearFailure(failures, pending.start);
        await saveFailures(db, failures);
      }
    } catch (error) {
      if (!(error instanceof CloudHttpError) || error instanceof CloudLockedError) throw error;
      if (error.status === 410) {
        await deleteLocalWorkout(db, pending.start);
        await recordRemoteDeletion(db, pending.start);
        report.deleted += 1;
        cloudLog(`workout ${pending.start} was deleted from the cloud; deleted here too`);
      } else if (error.status === 413 && error.code === 'quota') {
        report.quota = error.message;
        break;
      } else if (error.status === 400 || error.status === 413) {
        failures = recordFailure(failures, pending.start, identity.rev, `${error.code ?? error.status}: ${error.message}`);
        await saveFailures(db, failures);
        report.refused += 1;
        cloudLog(`cloud refused workout ${pending.start} (${error.status} ${error.code ?? ''}): ${error.message}`, 'error');
      } else {
        throw error;
      }
    }
  }
  onProgress({ done: total, total });
  if (report.uploaded > 0 || report.refused > 0 || report.deleted > 0) {
    cloudLog(`uploaded ${report.uploaded} workouts, ${report.refused} refused, ${report.deleted} deleted`);
  }
  return report;
}

// --- Account and wipe ------------------------------------------------------------------------------------------------

/** Ties the bookkeeping to the signed-in account before anything is pulled or sent; another account starts from nothing. */
export async function bindAccount(db: SQLiteDatabase, userId: string, email: string): Promise<void> {
  if (await adoptAccount(db, userId, email)) cloudLog(`account changed to ${userId}; uploading everything again`);
}

/**
 * "Delete cloud data": removes the account's workouts and strength records from JoyoRogo and its steps, sleep, devices and
 * imports from the JoyoFit cloud. The account and this phone's data stay. What the phone remembered of the cloud is cleared
 * after each step that succeeded, so a failure half way never leaves it claiming workouts the cloud no longer has.
 */
export async function wipeCloudData(db: SQLiteDatabase): Promise<void> {
  await rogoCall<unknown>('watchWorkout/wipe', {});
  await forgetCloudWorkouts(db);
  await wipeStrengthCloud(db);
  await cloudRequest<{ deleted: boolean }>('DELETE', '/v1/data');
  await resetCloudCursors(db);
  cloudLog('deleted the cloud data of this account');
}

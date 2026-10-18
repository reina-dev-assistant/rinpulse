import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Cloud upload bookkeeping. Migration 4 gives `step_samples` and `sleep_segments` a `rev` column that triggers set to the
 * table's next `cloud_cursor.seq` on every insert and update (JS and native writers alike), so "everything not uploaded
 * yet" is `rev > cloud_cursor.uploaded`. Workouts go to JoyoRogo one document each (`src/cloud/workoutSync.ts`) and are
 * tracked per workout in `cloud_workout` (migration 13); `workouts.rev` still moves on every write and is compared with
 * the `rev` recorded there.
 */
export type CloudTable = 'step_samples' | 'sleep_segments';

export const CLOUD_TABLES: readonly CloudTable[] = ['step_samples', 'sleep_segments'];

export interface CloudState {
  userId: string | null;
  email: string | null;
  /** Unix seconds of the last upload run that finished without error. */
  lastSyncAt: number | null;
  lastError: string | null;
}

export async function getCloudState(db: SQLiteDatabase): Promise<CloudState> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM cloud_state');
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const last = Number(map.get('last_sync_at'));
  return {
    userId: map.get('user_id') ?? null,
    email: map.get('email') ?? null,
    lastSyncAt: Number.isFinite(last) && last > 0 ? last : null,
    lastError: map.get('last_error') ?? null,
  };
}

/** Sets the given keys; a `null` value deletes the key. */
export async function setCloudState(db: SQLiteDatabase, entries: Record<string, string | null>): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === null) await db.runAsync('DELETE FROM cloud_state WHERE key = ?', key);
      else
        await db.runAsync(
          'INSERT INTO cloud_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          key,
          value,
        );
    }
  });
}

export async function getUploaded(db: SQLiteDatabase, table: CloudTable): Promise<number> {
  const row = await db.getFirstAsync<{ uploaded: number }>('SELECT uploaded FROM cloud_cursor WHERE tbl = ?', table);
  return row?.uploaded ?? 0;
}

export async function setUploaded(db: SQLiteDatabase, table: CloudTable, rev: number): Promise<void> {
  await db.runAsync('UPDATE cloud_cursor SET uploaded = MAX(uploaded, ?) WHERE tbl = ?', rev, table);
}

/** A different JoyoRogo account signed in: everything has to go to the new account. */
export async function resetCloudCursors(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('UPDATE cloud_cursor SET uploaded = 0');
}

/** `cloud_state` keys of the workout sync (`src/cloud/workoutSync.ts`). */
export const WORKOUT_PULL_CURSOR_KEY = 'workout_pull_cursor';
export const WORKOUT_FAILED_KEY = 'workout_failed';

export async function getCloudValue(db: Pick<SQLiteDatabase, 'getFirstAsync'>, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM cloud_state WHERE key = ?', key);
  return row?.value ?? null;
}

/** The cloud has none of the workouts any more (wiped, or the account is gone): forget what was uploaded and where the pull stood. */
export async function forgetCloudWorkouts(db: SQLiteDatabase): Promise<void> {
  await clearCloudWorkouts(db);
  await setCloudState(db, { [WORKOUT_PULL_CURSOR_KEY]: null, [WORKOUT_FAILED_KEY]: null });
}

/** `cloud_state` key: ms of the moment this phone's existing data was kept apart from the account that signed in afterwards (`detachLocalData`). */
export const DETACHED_AT_KEY = 'detached_at';

/** The detach time, or null when this phone's data was never kept apart. Gear and the coach plan hold back what is not newer than it. */
export async function getDetachedAt(db: Pick<SQLiteDatabase, 'getFirstAsync'>): Promise<number | null> {
  const value = Number(await getCloudValue(db, DETACHED_AT_KEY));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** `cloud_workout.hash` of a workout that was only marked as uploaded so the next account never receives it; it has no cloud copy, so it must not count in the size estimates. */
export const DETACHED_HASH = 'detached';

/**
 * Remembers which JoyoRogo account the cloud bookkeeping belongs to. A different account has none of the rows and none of
 * the workouts, so everything is sent to it again and its changes are pulled from the start. True when the account changed.
 */
export async function adoptAccount(db: SQLiteDatabase, userId: string, email: string): Promise<boolean> {
  const state = await getCloudState(db);
  if (state.userId === userId) {
    if (state.email !== email) await setCloudState(db, { email });
    return false;
  }
  await resetCloudCursors(db);
  await forgetCloudWorkouts(db);
  await setCloudState(db, { user_id: userId, email });
  return state.userId !== null;
}

/** Step samples and sleep segments written locally that the cloud does not have yet. Rows imported from a Huawei export (`imported = 1`) stay on the phone and are never pending. */
export async function countPendingRows(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT
       (SELECT COUNT(*) FROM step_samples WHERE imported = 0 AND rev > (SELECT uploaded FROM cloud_cursor WHERE tbl = 'step_samples')) +
       (SELECT COUNT(*) FROM sleep_segments WHERE imported = 0 AND rev > (SELECT uploaded FROM cloud_cursor WHERE tbl = 'sleep_segments')) AS n`,
  );
  return row?.n ?? 0;
}

export interface PendingStepSample {
  rev: number;
  timestamp: number;
  steps: number;
  calories: number;
  distance: number;
  heartRate: number | null;
  spo2: number | null;
  restingHeartRate: number | null;
}

export function listStepSamplesAfter(db: SQLiteDatabase, rev: number, limit: number): Promise<PendingStepSample[]> {
  return db.getAllAsync<PendingStepSample>(
    `SELECT rev, timestamp, steps, calories, distance, heart_rate AS heartRate, spo2,
            resting_heart_rate AS restingHeartRate
     FROM step_samples WHERE imported = 0 AND rev > ? ORDER BY rev LIMIT ?`,
    rev,
    limit,
  );
}

export interface PendingSleepSegment {
  rev: number;
  start: number;
  end: number;
  type: number;
  stage: string | null;
}

export function listSleepAfter(db: SQLiteDatabase, rev: number, limit: number): Promise<PendingSleepSegment[]> {
  return db.getAllAsync<PendingSleepSegment>(
    'SELECT rev, start, end, type, stage FROM sleep_segments WHERE imported = 0 AND rev > ? ORDER BY rev LIMIT ?',
    rev,
    limit,
  );
}

/** A workout that was uploaded to JoyoRogo, or restored from it: what the cloud copy was made from (migration 13). */
export interface CloudWorkoutRow {
  start: number;
  /** `workouts.rev` the document was built from. A higher local `rev` means the workout changed since. */
  rev: number;
  /** `ANALYSIS_ENGINE_REV` of the analysis inside the document. */
  engineRev: number;
  /** The server's version of the document. */
  version: number;
  /** SHA-256 of the gzip bytes. */
  hash: string;
  /** Gzip bytes stored in the cloud. */
  bytes: number;
  /** Unix seconds. */
  uploadedAt: number;
}

const CLOUD_WORKOUT_COLUMNS = 'start, rev, engine_rev AS engineRev, version, hash, bytes, uploaded_at AS uploadedAt';

export function getCloudWorkout(db: Pick<SQLiteDatabase, 'getFirstAsync'>, start: number): Promise<CloudWorkoutRow | null> {
  return db.getFirstAsync<CloudWorkoutRow>(`SELECT ${CLOUD_WORKOUT_COLUMNS} FROM cloud_workout WHERE start = ?`, start);
}

export async function upsertCloudWorkout(db: Pick<SQLiteDatabase, 'runAsync'>, row: CloudWorkoutRow): Promise<void> {
  await db.runAsync(
    `INSERT INTO cloud_workout (start, rev, engine_rev, version, hash, bytes, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(start) DO UPDATE SET rev = excluded.rev, engine_rev = excluded.engine_rev, version = excluded.version,
       hash = excluded.hash, bytes = excluded.bytes, uploaded_at = excluded.uploaded_at`,
    row.start,
    row.rev,
    row.engineRev,
    row.version,
    row.hash,
    row.bytes,
    row.uploadedAt,
  );
}

/** A different account signed in, or the cloud copy was wiped: nothing is in the cloud any more. */
export async function clearCloudWorkouts(db: Pick<SQLiteDatabase, 'runAsync'>): Promise<void> {
  await db.runAsync('DELETE FROM cloud_workout');
}

/** Every stored workout with its current `rev`: what `detachLocalData` records as already uploaded. */
export function listWorkoutsForBaseline(db: Pick<SQLiteDatabase, 'getAllAsync'>): Promise<{ start: number; rev: number }[]> {
  return db.getAllAsync<{ start: number; rev: number }>('SELECT start, rev FROM workouts');
}

/** A workout still to send. `points` is its stored point count, for the size estimate. */
export interface PendingWorkout {
  id: number;
  start: number;
  rev: number;
  points: number;
}

/**
 * Workouts the cloud does not have in their current form, newest first: no `cloud_workout` row, a `rev` that moved
 * since the upload, or an analysis made by an older engine than `engineRev`. Every workout counts: recorded by the watch,
 * imported from a FIT file or a Huawei export, complete or not.
 */
export function listPendingWorkouts(db: Pick<SQLiteDatabase, 'getAllAsync'>, engineRev: number): Promise<PendingWorkout[]> {
  return db.getAllAsync<PendingWorkout>(
    `SELECT w.id, w.start, w.rev, (SELECT COUNT(*) FROM workout_points p WHERE p.workout_id = w.id) AS points
     FROM workouts w LEFT JOIN cloud_workout c ON c.start = w.start
     WHERE c.start IS NULL OR w.rev > c.rev OR c.engine_rev < ?
     ORDER BY w.start DESC`,
    engineRev,
  );
}

/** The id and current `rev` of the workout that started at `start`; null when it is no longer stored. */
export function getWorkoutIdentity(
  db: Pick<SQLiteDatabase, 'getFirstAsync'>,
  start: number,
): Promise<{ id: number; rev: number } | null> {
  return db.getFirstAsync<{ id: number; rev: number }>('SELECT id, rev FROM workouts WHERE start = ?', start);
}

/** One workout against the cloud copy of it: the stored point count, its `rev`, and the `cloud_workout` row (null: not uploaded). */
export async function getWorkoutCloudInfo(
  db: Pick<SQLiteDatabase, 'getFirstAsync'>,
  start: number,
): Promise<{ rev: number; points: number; cloud: CloudWorkoutRow | null } | null> {
  const local = await db.getFirstAsync<{ id: number; rev: number }>('SELECT id, rev FROM workouts WHERE start = ?', start);
  if (!local) return null;
  const points = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM workout_points WHERE workout_id = ?', local.id);
  return { rev: local.rev, points: points?.n ?? 0, cloud: await getCloudWorkout(db, start) };
}

/** What the cloud copies already weigh, to estimate what the rest will. */
export interface UploadedStats {
  workouts: number;
  /** Gzip bytes of their documents. */
  bytes: number;
  /** Stored points of the same workouts. */
  points: number;
}

export async function getUploadedStats(db: Pick<SQLiteDatabase, 'getFirstAsync'>): Promise<UploadedStats> {
  const sums = await db.getFirstAsync<{ workouts: number; bytes: number }>(
    'SELECT COUNT(*) AS workouts, COALESCE(SUM(bytes), 0) AS bytes FROM cloud_workout WHERE hash != ?',
    DETACHED_HASH,
  );
  const points = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM workout_points
     WHERE workout_id IN (SELECT w.id FROM workouts w JOIN cloud_workout c ON c.start = w.start WHERE c.hash != ?)`,
    DETACHED_HASH,
  );
  return { workouts: sums?.workouts ?? 0, bytes: sums?.bytes ?? 0, points: points?.n ?? 0 };
}

export interface DeviceRow {
  address: string;
  name: string;
  productModel: string | null;
  softwareVersion: string | null;
  lastSync: number | null;
}

export function listDevices(db: SQLiteDatabase): Promise<DeviceRow[]> {
  return db.getAllAsync<DeviceRow>(
    `SELECT address, name, product_model AS productModel, software_version AS softwareVersion,
            last_sync AS lastSync FROM device`,
  );
}

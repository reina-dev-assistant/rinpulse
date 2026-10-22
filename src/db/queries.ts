import type { SQLiteDatabase } from 'expo-sqlite';

import { ACTIVE_STEPS_PER_MIN, cleanUnstagedSleep, workoutSpan, type SleepEvidence } from '@/features/sleep/cleanSleep';
import type { SleepSpan } from '@/features/today/stats';
import type { DayHeartLoad } from '@/features/today/strain';
import type { SleepSegment, StepSample } from '@/wear';

export async function getLastSync(db: SQLiteDatabase, address: string): Promise<number | null> {
  const row = await db.getFirstAsync<{ last_sync: number | null }>(
    'SELECT last_sync FROM device WHERE address = ?',
    address,
  );
  return row?.last_sync ?? null;
}

/** A watch has been connected on this phone before (a `device` row exists). */
export async function hasStoredWatch(db: SQLiteDatabase): Promise<boolean> {
  return (await db.getFirstAsync<{ address: string }>('SELECT address FROM device LIMIT 1')) !== null;
}

/** The database holds anything a watch (or a Huawei Health, FIT or Health export) produced: steps, sleep, or a workout that was not logged here. */
export async function hasWatchData(db: SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ present: number }>(
    `SELECT (EXISTS (SELECT 1 FROM step_samples) OR EXISTS (SELECT 1 FROM sleep_segments) OR EXISTS (SELECT 1 FROM workouts WHERE imported = 0)) AS present`,
  );
  return (row?.present ?? 0) === 1;
}

export function listStepSamplesSince(db: SQLiteDatabase, sinceSec: number): Promise<StepSample[]> {
  return db.getAllAsync<StepSample>(
    `SELECT timestamp, steps, calories, distance,
            heart_rate AS heartRate, spo2, resting_heart_rate AS restingHeartRate
     FROM step_samples WHERE timestamp >= ? ORDER BY timestamp`,
    sinceSec,
  );
}

/**
 * The watch's own minutes that carry energy since `sinceSec` (`imported = 0`: restored, FIT and strap minutes are not the
 * watch's all-day energy), `calories` in small calories (1/1000 kcal). What JoyoRogo's day active-energy total sums.
 */
export function listWatchCaloriesSince(db: SQLiteDatabase, sinceSec: number): Promise<{ timestamp: number; calories: number }[]> {
  return db.getAllAsync<{ timestamp: number; calories: number }>(
    'SELECT timestamp, calories FROM step_samples WHERE timestamp >= ? AND imported = 0 AND calories > 0 ORDER BY timestamp',
    sinceSec,
  );
}

/**
 * Steps per local day, summed in SQL (every stored minute, whichever watch or import it came from: the merged timeline Today adds up).
 * `bounds` are consecutive local midnights; day `i` spans `bounds[i]` up to `bounds[i + 1]`. Days without a stored minute are absent.
 */
export async function listDailySteps(db: SQLiteDatabase, bounds: readonly number[]): Promise<Map<number, number>> {
  const days: number[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) days.push(bounds[i], bounds[i + 1]);
  if (days.length === 0) return new Map();
  const rows = await db.getAllAsync<{ day: number; steps: number }>(
    `WITH days(d0, d1) AS (VALUES ${Array.from({ length: days.length / 2 }, () => '(?, ?)').join(', ')})
     SELECT d0 AS day, SUM(s.steps) AS steps
     FROM days JOIN step_samples s ON s.timestamp >= d0 AND s.timestamp < d1
     GROUP BY d0`,
    days,
  );
  return new Map(rows.map((r) => [r.day, r.steps]));
}

/** Per-minute rows of `[fromSec, toSec)`, oldest first: one past day's steps by hour. */
export function listStepSamplesBetween(db: SQLiteDatabase, fromSec: number, toSec: number): Promise<StepSample[]> {
  return db.getAllAsync<StepSample>(
    `SELECT timestamp, steps, calories, distance,
            heart_rate AS heartRate, spo2, resting_heart_rate AS restingHeartRate
     FROM step_samples WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp`,
    fromSec,
    toSec,
  );
}

/** The newest stored heart-rate reading of any day, or null when the watch never recorded one. */
export function getLatestHeartRate(db: SQLiteDatabase): Promise<{ bpm: number; timestamp: number } | null> {
  return db.getFirstAsync<{ bpm: number; timestamp: number }>(
    'SELECT heart_rate AS bpm, timestamp FROM step_samples WHERE heart_rate > 0 ORDER BY timestamp DESC LIMIT 1',
  );
}

/**
 * What the stored workouts, spot HRV measurements and per-minute steps say about `[from, to]`, for
 * `cleanUnstagedSleep`. Only minutes with real walking are read, never the whole step history.
 */
async function sleepEvidence(db: SQLiteDatabase, from: number, to: number): Promise<SleepEvidence> {
  const [workouts, spots, active] = await Promise.all([
    db.getAllAsync<{ start: number; end: number; duration: number }>(
      // `complete != 0` matches the native rule (SleepStore.evidence): an incomplete workout is a download the watch
      // never finished, so it is not evidence that the wearer was awake and must not subtract sleep.
      'SELECT start, end, duration FROM workouts WHERE complete != 0 AND end >= ? AND start <= ?',
      from,
      to,
    ),
    db.getAllAsync<{ start: number; end: number }>(
      "SELECT start, end FROM hrv_readings WHERE source = 'spot' AND end >= ? AND start <= ?",
      from,
      to,
    ),
    db.getAllAsync<{ timestamp: number }>(
      'SELECT timestamp FROM step_samples WHERE timestamp >= ? AND timestamp <= ? AND steps >= ?',
      from - 60,
      to,
      ACTIVE_STEPS_PER_MIN,
    ),
  ]);
  return {
    workouts: workouts.map((w) => workoutSpan(w.start, w.end, w.duration)),
    spots,
    activeMinutes: active.map((a) => a.timestamp),
  };
}

/**
 * Stored segments, with the stage-less ones cleaned of what was not sleep (`cleanUnstagedSleep`): workouts, spot HRV
 * measurements, minutes of walking, fragments too short to be sleep. The raw rows stay as the watch sent them, so a
 * rule change re-derives every stored night the next time it is read. Staged segments come back as stored, marked
 * when their stage came from the phone's own estimate rather than the watch's analysis.
 */
async function cleanedSleep(db: SQLiteDatabase, rows: SleepSegment[]): Promise<SleepSpan[]> {
  const marked = rows.map((r) => (r.type === RAW_ESTIMATED_STAGE ? { ...r, estimated: true } : r));
  let from = Infinity;
  let to = -Infinity;
  for (const r of marked) {
    if (r.stage) continue;
    from = Math.min(from, r.start);
    to = Math.max(to, r.end);
  }
  if (from > to) return marked;
  return cleanUnstagedSleep(marked, await sleepEvidence(db, from, to));
}

/** The raw kind the phone's own stage estimate stores (`EstimatedSleepStages.RAW_ESTIMATED`). */
export const RAW_ESTIMATED_STAGE = 0x5657;

/** Segments that end at or after `sinceSec`, oldest first. */
export async function listSleepSince(db: SQLiteDatabase, sinceSec: number): Promise<SleepSpan[]> {
  return cleanedSleep(
    db,
    await db.getAllAsync<SleepSegment>(
      'SELECT start, end, type, stage FROM sleep_segments WHERE end >= ? ORDER BY start',
      sinceSec,
    ),
  );
}

/** Every stored segment, oldest first. A night is tens of rows, so the whole history stays small. */
export async function listAllSleep(db: SQLiteDatabase): Promise<SleepSpan[]> {
  return cleanedSleep(
    db,
    await db.getAllAsync<SleepSegment>('SELECT start, end, type, stage FROM sleep_segments ORDER BY start, end'),
  );
}

/** The watch's own score for one night (`sleep_scores`); `start` / `end` span the night it scored. */
export interface SleepScoreRow {
  start: number;
  end: number;
  score: number;
  /** Percent of the time in bed spent asleep, as the watch reports it. */
  efficiency: number | null;
}

export function listSleepScores(db: SQLiteDatabase): Promise<SleepScoreRow[]> {
  return db.getAllAsync<SleepScoreRow>('SELECT start, end, score, efficiency FROM sleep_scores ORDER BY start');
}

/** One HRV value (`hrv_readings`): `night` from the watch's own RMSSD records during sleep, `spot` from a 1-minute measurement. */
export interface HrvReadingRow {
  start: number;
  end: number;
  source: 'night' | 'spot';
  /** Milliseconds. */
  rmssd: number;
  beats: number;
}

export function listHrvReadingsSince(db: SQLiteDatabase, sinceSec: number): Promise<HrvReadingRow[]> {
  return db.getAllAsync<HrvReadingRow>(
    'SELECT start, end, source, rmssd, beats FROM hrv_readings WHERE end >= ? ORDER BY end',
    sinceSec,
  );
}

/** Night HRV rows (`source = 'night'`) that ended at or after `sinceSec`. */
export async function countNightHrvSince(db: SQLiteDatabase, sinceSec: number): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM hrv_readings WHERE source = 'night' AND end >= ?",
    sinceSec,
  );
  return row?.n ?? 0;
}

/** A `workouts` row. `complete` is false while a part of its download failed; the next sync retries. `imported` marks a row that came from a Huawei export or a FIT file instead of the watch. */
export interface WorkoutRow {
  id: number;
  workoutNumber: number;
  /** Unix seconds. */
  start: number;
  end: number;
  /** The raw Huawei sport type byte. */
  sportType: number;
  sportName: string;
  /** Active seconds. */
  duration: number;
  /** Metres. */
  distance: number;
  calories: number;
  avgHr: number | null;
  maxHr: number | null;
  steps: number;
  complete: boolean;
  imported: boolean;
}

/**
 * One `workout_points` row. Every source stores only the fields it had: GPS points have lat/lon, data samples have
 * hr and altitude, and the per-sample motion fields come from the watch (all four), a FIT file (cadence, power,
 * speed, stride) or a Huawei export (cadence only). `speed` is metres per second, `cadence` steps per minute
 * (revolutions per minute when cycling), `stride` metres per step, `power` watts.
 */
export interface WorkoutPointRow {
  ts: number;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  hr: number | null;
  speed: number | null;
  cadence: number | null;
  stride: number | null;
  power: number | null;
}

const WORKOUT_COLUMNS = `id, workout_number AS workoutNumber, start, end, sport_type AS sportType,
  sport_name AS sportName, duration, distance, calories, avg_hr AS avgHr, max_hr AS maxHr, steps,
  complete != 0 AS complete, imported != 0 AS imported`;

type RawWorkout = Omit<WorkoutRow, 'complete' | 'imported'> & { complete: number; imported: number };

function toWorkout(row: RawWorkout): WorkoutRow {
  return { ...row, complete: row.complete !== 0, imported: row.imported !== 0 };
}

/** Newest first. */
export async function listWorkouts(db: SQLiteDatabase): Promise<WorkoutRow[]> {
  const rows = await db.getAllAsync<RawWorkout>(
    `SELECT ${WORKOUT_COLUMNS} FROM workouts ORDER BY start DESC`,
  );
  return rows.map(toWorkout);
}

export async function getWorkout(
  db: SQLiteDatabase,
  id: number,
): Promise<{ workout: WorkoutRow; summaryJson: string } | null> {
  const row = await db.getFirstAsync<RawWorkout & { summaryJson: string }>(
    `SELECT ${WORKOUT_COLUMNS}, summary_json AS summaryJson FROM workouts WHERE id = ?`,
    id,
  );
  if (!row) return null;
  const { summaryJson, ...rest } = row;
  return { workout: toWorkout(rest), summaryJson };
}

export function listWorkoutPoints(db: SQLiteDatabase, workoutId: number): Promise<WorkoutPointRow[]> {
  return db.getAllAsync<WorkoutPointRow>(
    'SELECT ts, lat, lon, alt, hr, speed, cadence, stride, power FROM workout_points WHERE workout_id = ? ORDER BY ts',
    workoutId,
  );
}

/** Complete workouts other than `excludeId` that started in `[sinceSec, beforeSec)`, newest first, with their summary JSON. */
export async function listWorkoutsSince(
  db: SQLiteDatabase,
  sinceSec: number,
  beforeSec: number,
  excludeId: number,
): Promise<{ workout: WorkoutRow; summaryJson: string }[]> {
  const rows = await db.getAllAsync<RawWorkout & { summaryJson: string }>(
    `SELECT ${WORKOUT_COLUMNS}, summary_json AS summaryJson FROM workouts
     WHERE start >= ? AND start < ? AND id != ? AND complete != 0 ORDER BY start DESC`,
    sinceSec,
    beforeSec,
    excludeId,
  );
  return rows.map(({ summaryJson, ...rest }) => ({ workout: toWorkout(rest), summaryJson }));
}

/**
 * Heart-rate load per local day, aggregated in SQL so long ranges never put per-minute rows through JS. It is
 * `dailyStrain`'s arithmetic: a reading counts until the next reading (of any day), at most 600 s, never past
 * `day + 86400`, and at least 1 s; seconds are summed per Edwards zone. `bounds` are consecutive local midnights (day `i`
 * spans `bounds[i]` up to `bounds[i + 1]`), and `thresholds` are the lowest bpm of every zone (`HrZones.bounds`: five, six for the reserve method).
 * Everything is integer arithmetic, so there is no division to truncate. Days without heart rate are absent.
 */
export async function listDayHeartLoad(
  db: SQLiteDatabase,
  bounds: readonly number[],
  thresholds: readonly number[],
): Promise<DayHeartLoad[]> {
  const days: number[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) days.push(bounds[i], bounds[i + 1]);
  if (days.length === 0) return [];
  // CROSS JOIN pins `days` as the outer loop, so each day is one range seek on the timestamp primary key. LEAD runs over
  // the joined rows of all days in timestamp order, so the last reading of a day sees the next day's first.
  const zoneSums = thresholds.map((_, i) => `COALESCE(SUM(CASE WHEN zone = ${i + 1} THEN secs END), 0) AS z${i + 1}`).join(',\n            ');
  const zoneExpr = thresholds.map(() => '(bpm >= ?)').join(' + ');
  const rows = await db.getAllAsync<Record<string, number>>(
    `WITH days(d0, d1) AS (VALUES ${Array.from({ length: days.length / 2 }, () => '(?, ?)').join(', ')}),
     hr AS (
       SELECT s.timestamp AS ts, s.heart_rate AS bpm, d.d0 AS d0,
              LEAD(s.timestamp) OVER (ORDER BY s.timestamp) AS nxt
       FROM days d CROSS JOIN step_samples s
       WHERE s.timestamp >= d.d0 AND s.timestamp < d.d1 AND s.heart_rate > 0
     ),
     cover AS (
       SELECT d0, MAX(1, MIN(COALESCE(nxt, ts + 60), ts + 600, d0 + 86400) - ts) AS secs,
              ${zoneExpr} AS zone
       FROM hr
     )
     SELECT d0 AS day, SUM(secs) AS covered,
            ${zoneSums}
     FROM cover GROUP BY d0 ORDER BY d0`,
    [...days, ...thresholds],
  );
  return rows.map((r) => ({ day: r.day, zoneSeconds: thresholds.map((_, i) => r[`z${i + 1}`] as number), coveredSeconds: r.covered }));
}

/**
 * The watch's resting heart rate per day, (the lowest reported that day), aggregated in SQL.
 * `bounds` are consecutive local midnights; day `i` spans `bounds[i]` up to `bounds[i + 1]`, so the local calendar
 * (and daylight-saving days) stay with the caller. Days without a value are absent from the result.
 */
export async function listRestingHeartRateByDay(db: SQLiteDatabase, bounds: readonly number[]): Promise<Map<number, number>> {
  const days: number[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) days.push(bounds[i], bounds[i + 1]);
  if (days.length === 0) return new Map();
  const rows = await db.getAllAsync<{ day: number; bpm: number }>(
    `WITH days(d0, d1) AS (VALUES ${Array.from({ length: days.length / 2 }, () => '(?, ?)').join(', ')})
     SELECT d0 AS day, MIN(s.resting_heart_rate) AS bpm
     FROM days JOIN step_samples s ON s.timestamp >= d0 AND s.timestamp < d1
     WHERE s.resting_heart_rate > 0 GROUP BY d0`,
    days,
  );
  return new Map(rows.map((r) => [r.day, r.bpm]));
}

/** Workouts the watch recorded (not restored, FIT or Health imports) that started since `sinceSec`. */
export async function countWatchWorkoutsSince(db: SQLiteDatabase, sinceSec: number): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM workouts WHERE start >= ? AND imported = 0 AND complete = 1', sinceSec);
  return row?.n ?? 0;
}

/**
 * Steps and the watch's own active energy per local day, aggregated in SQL (`bounds` as in `listRestingHeartRateByDay`).
 * `calories` are small calories (1/1000 kcal) of the watch's own minutes (`imported = 0`); a day without samples is absent.
 */
export async function listDayTotals(db: SQLiteDatabase, bounds: readonly number[]): Promise<Map<number, { steps: number; calories: number }>> {
  const days: number[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) days.push(bounds[i], bounds[i + 1]);
  if (days.length === 0) return new Map();
  const rows = await db.getAllAsync<{ day: number; steps: number; calories: number }>(
    `WITH days(d0, d1) AS (VALUES ${Array.from({ length: days.length / 2 }, () => '(?, ?)').join(', ')})
     SELECT d0 AS day, SUM(s.steps) AS steps, SUM(CASE WHEN s.imported = 0 THEN s.calories ELSE 0 END) AS calories
     FROM days JOIN step_samples s ON s.timestamp >= d0 AND s.timestamp < d1 GROUP BY d0`,
    days,
  );
  return new Map(rows.map((r) => [r.day, { steps: r.steps ?? 0, calories: r.calories ?? 0 }]));
}

/** One `health_metrics` value of `type` (`ts` unix seconds); rows without a number are left out. */
export function listMetricSince(db: SQLiteDatabase, type: string, sinceSec: number): Promise<{ ts: number; value: number }[]> {
  return db.getAllAsync<{ ts: number; value: number }>(
    'SELECT ts, value FROM health_metrics WHERE type = ? AND ts >= ? AND value IS NOT NULL ORDER BY ts',
    type,
    sinceSec,
  );
}

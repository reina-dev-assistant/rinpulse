/**
 * Stores a ride or run from a FIT file as a workout, with the semantics of the Huawei Health export import
 * (`HuaweiImportStore.kt`):
 *
 * - **Imported rows stay out of the watch-only exports.** The workout is inserted with `imported = 1`, so the automatic
 *   Strava upload, the step and sleep upload to the JoyoFit cloud and the Health Connect / Apple Health export (all read
 *   `imported = 0` only) never send it. The per-workout "Send to Strava" button stays the user's choice. The JoyoRogo
 *   cloud sync (`src/cloud/workoutSync.ts`) is the exception: it keeps every workout, imported ones included.
 * - **Watch data wins.** A file whose time span overlaps a stored workout by more than half of the file's own span is
 *   not imported and says which workout it collided with: the watch's version is the one with the watch's own heart
 *   rate, so the watch workout is kept, the file is skipped. A smaller overlap (a short watch workout inside a long
 *   ride) imports, the two are different recordings.
 * - **Idempotent.** The same file again has the same start, which is `workouts.start`'s unique key: nothing is added.
 *   A file that matches a workout already imported from another file (the second device of the same ride) is skipped
 *   by the same overlap rule.
 * - **Counts for Strain, Readiness and Trends.** Those read the per-minute heart rate in `step_samples`, not the
 *   `workouts` table, so each minute of the ride's heart rate is written there too, `imported = 1`, as the Huawei
 *   import does for its minutes. A minute that already exists (the watch was recording it) is never touched.
 *
 * Per-sample cadence, power, speed and step length go into `workout_points`; the averages and maxima of cadence and
 * power also stay in `summary_json`, and a file with two or more laps adds them as `summary_json.laps`.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { fmtClock, fmtDate, fmtDecimal, t } from '@/i18n';

import { formatElapsed } from '../workouts/summary';
import { type FitActivity, type FitImportError, parseFitActivity } from './parseFit';
import { sportLabel } from '@/features/workouts/sportLabel';

export interface FitImported {
  ok: true;
  workoutId: number;
  /** `Ride (iGPSPORT)`, as stored. */
  name: string;
  /** The sport alone, `Ride`. */
  sport: string;
  /** Metres. */
  distance: number;
  /** Active seconds. */
  duration: number;
  points: number;
  /** One line for the screen: `Imported Ride 42.1 km, 1:35:20`. */
  message: string;
}

export type FitImportResult = FitImported | FitImportError;

/** What the import needs of the app's database handle. */
export type FitImportDb = Pick<SQLiteDatabase, 'getAllAsync' | 'withExclusiveTransactionAsync'>;

/** Over this share of the file's own time span, a stored workout is the same activity. */
export const OVERLAP_SHARE = 0.5;

/** Rows per multi-row INSERT: 90 rows of 10 bound values stay under the 999-variable limit of older SQLite builds. */
const CHUNK = 90;

function summaryOf(a: FitActivity): string {
  const summary: Record<string, unknown> = {
    kind: a.sport.kind,
    gps: a.points.some((p) => p.lat !== null) ? 'ok' : 'none',
    gpsPoints: a.points.filter((p) => p.lat !== null).length,
    avgSpeed: a.avgSpeed ?? undefined,
    maxSpeed: a.maxSpeed ?? undefined,
    // Foot sports show pace, like the watch's own rows.
    avgPaceSecPerKm: a.sport.foot && a.avgSpeed ? 1000 / a.avgSpeed : undefined,
    minPaceSecPerKm: a.sport.foot && a.maxSpeed ? 1000 / a.maxSpeed : undefined,
    minHr: a.minHr ?? undefined,
    elevationGain: a.ascent ?? undefined,
    elevationLoss: a.descent ?? undefined,
    ascentSource: a.ascent !== null && a.descent !== null ? 'device' : undefined,
    minAltitude: a.minAltitude ?? undefined,
    maxAltitude: a.maxAltitude ?? undefined,
    avgCadence: a.avgCadence ?? undefined,
    maxCadence: a.maxCadence ?? undefined,
    avgPower: a.avgPower ?? undefined,
    maxPower: a.maxPower ?? undefined,
    normalizedPower: a.normalizedPower ?? undefined,
    balanceLeftPct: a.balanceLeftPct ?? undefined,
    laps: a.laps.length > 0 ? a.laps : undefined,
    importedFrom: a.manufacturer ?? 'FIT file',
  };
  return JSON.stringify(summary);
}

/** Mean heart rate per whole minute of the points: what the watch stores in `step_samples`. */
function minuteHeartRates(a: FitActivity): [minute: number, bpm: number][] {
  const sums = new Map<number, { total: number; n: number }>();
  for (const p of a.points) {
    if (p.hr === null) continue;
    const minute = p.ts - (p.ts % 60);
    const slot = sums.get(minute);
    if (slot) {
      slot.total += p.hr;
      slot.n += 1;
    } else sums.set(minute, { total: p.hr, n: 1 });
  }
  return [...sums].map(([minute, { total, n }]) => [minute, Math.round(total / n)] as [number, number]).sort((x, y) => x[0] - y[0]);
}

const clock = (unixSeconds: number): string => `${fmtDate(unixSeconds, 'short')}, ${fmtClock(unixSeconds)}`;

/**
 * A stored workout that makes `a` a duplicate, as the message for the screen; null when there is none. Same start
 * (to the second) is the same file again; otherwise more than `OVERLAP_SHARE` of the file's span inside a stored one.
 */
async function collision(db: Pick<SQLiteDatabase, 'getAllAsync'>, a: FitActivity): Promise<FitImportError | null> {
  const span = Math.max(1, a.end - a.start);
  const rows = await db.getAllAsync<{ start: number; end: number; sportName: string; imported: number }>(
    `SELECT start, "end" AS "end", sport_name AS sportName, imported FROM workouts WHERE start < ? AND "end" > ? OR start = ? ORDER BY start`,
    [a.end, a.start, a.start],
  );
  for (const row of rows) {
    const overlap = Math.min(row.end, a.end) - Math.max(row.start, a.start);
    if (row.start !== a.start && overlap <= span * OVERLAP_SHARE) continue;
    if (row.imported === 1) {
      return {
        ok: false,
        reason: 'duplicate',
        message: t('sharing:fitImport.duplicate', { sport: sportLabel(row.sportName), when: clock(row.start) }),
      };
    }
    return {
      ok: false,
      reason: 'overlap',
      message: t('sharing:fitImport.overlap', { sport: sportLabel(row.sportName), when: clock(row.start) }),
    };
  }
  return null;
}

async function insertAll(txn: Pick<SQLiteDatabase, 'runAsync'>, a: FitActivity): Promise<number> {
  const inserted = await txn.runAsync(
    `INSERT INTO workouts
       (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, imported)
     VALUES (0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    [a.start, a.end, a.sport.type, a.name, a.timerSeconds, Math.round(a.distance), a.calories, a.avgHr, a.maxHr, a.steps, summaryOf(a)],
  );
  const id = inserted.lastInsertRowId;
  for (let i = 0; i < a.points.length; i += CHUNK) {
    const chunk = a.points.slice(i, i + CHUNK);
    await txn.runAsync(
      `INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr, speed, cadence, stride, power)
       VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      chunk.flatMap((p) => [id, p.ts, p.lat, p.lon, p.alt, p.hr, p.speed, p.cadence, p.stride, p.power]),
    );
  }
  const minutes = minuteHeartRates(a);
  for (let i = 0; i < minutes.length; i += CHUNK) {
    const chunk = minutes.slice(i, i + CHUNK);
    await txn.runAsync(
      `INSERT OR IGNORE INTO step_samples (timestamp, steps, calories, distance, heart_rate, imported) VALUES ${chunk.map(() => '(?, 0, 0, 0, ?, 1)').join(', ')}`,
      chunk.flatMap(([minute, bpm]) => [minute, bpm]),
    );
  }
  return id;
}

/** `Berhasil mengimpor bersepeda 42,1 km, 1:35:20` / `Imported Ride 42.1 km, 1:35:20`. */
function doneMessage(a: FitActivity): string {
  const sport = t(`sharing:fitImport.sports.${a.sport.kind}`);
  const duration = formatElapsed(a.timerSeconds);
  return a.distance > 0
    ? t('sharing:fitImport.done', { sport, distance: `${fmtDecimal(a.distance / 1000, 1)} km`, duration })
    : t('sharing:fitImport.doneNoDistance', { sport, duration });
}

/** Imports the FIT file `bytes`; see the module notes for what is stored and when a file is skipped. */
export async function importFit(db: FitImportDb, bytes: Uint8Array): Promise<FitImportResult> {
  const activity = parseFitActivity(bytes);
  if ('ok' in activity) return activity;

  let result = null as FitImportResult | null;
  // The check and the insert share one transaction, so two imports of the same file cannot both pass the check.
  await db.withExclusiveTransactionAsync(async (txn) => {
    const clash = await collision(txn, activity);
    if (clash) {
      result = clash;
      return;
    }
    const workoutId = await insertAll(txn, activity);
    result = {
      ok: true,
      workoutId,
      name: activity.name,
      sport: activity.sport.name,
      distance: activity.distance,
      duration: activity.timerSeconds,
      points: activity.points.length,
      message: doneMessage(activity),
    };
  });
  return result ?? { ok: false, reason: 'corrupt', message: t('sharing:fitImport.unfinished') };
}

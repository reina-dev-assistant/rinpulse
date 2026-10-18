/**
 * Per-ride figures kept so the all-time power curve, the FTP suggestion and the training load never re-read every ride's points.
 * Created from JS like `sensor` and `strength_record` (`ensureCyclingSchema`, run with the other schemas when the database opens): no
 * native code reads it, so it is not part of the shared migrations. Rows are derived data: delete them and they are rebuilt.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { listWorkoutPoints, type WorkoutRow } from '@/db/queries';
import { startOfLocalDay } from '@/features/today/stats';
import { strainFromTrimp, type DayStrain } from '@/features/today/strain';
import { parseSummary } from '@/features/workouts/summary';
import { sportKind } from '@/features/workouts/analysis/sport';

import { analyzeRide, RIDE_ENGINE_REV } from './analyzeRide';
import { KEY_DURATIONS, TSS_TO_TRIMP, trainingStressScore } from './power';
import type { PowerEffort, RideAnalysis, RideProfile } from './types';

export interface RideMetricsRow {
  /** The workout's start, unix seconds. */
  start: number;
  rev: number;
  /** Normalized power and the seconds it is based on; null for a ride without power. */
  np: number | null;
  basisSec: number;
  /** TRIMP of the ride's heart rate, 0 without. */
  trimpHr: number;
  curve: PowerEffort[];
}

interface Raw {
  workout_start: number;
  rev: number;
  np: number | null;
  basis_sec: number;
  trimp_hr: number;
  curve_json: string;
}

export type CyclingDb = Pick<SQLiteDatabase, 'getAllAsync' | 'getFirstAsync' | 'runAsync' | 'execAsync'>;

export async function ensureCyclingSchema(db: Pick<SQLiteDatabase, 'execAsync'>): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS ride_metrics (
      workout_start INTEGER PRIMARY KEY,
      rev INTEGER NOT NULL,
      np REAL,
      basis_sec INTEGER NOT NULL,
      trimp_hr REAL NOT NULL,
      curve_json TEXT NOT NULL
    );
  `);
}

function toRow(r: Raw): RideMetricsRow {
  return { start: r.workout_start, rev: r.rev, np: r.np, basisSec: r.basis_sec, trimpHr: r.trimp_hr, curve: JSON.parse(r.curve_json) as PowerEffort[] };
}

export async function saveRideMetrics(db: Pick<SQLiteDatabase, 'runAsync'>, start: number, ride: RideAnalysis): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO ride_metrics (workout_start, rev, np, basis_sec, trimp_hr, curve_json) VALUES (?, ?, ?, ?, ?, ?)',
    [start, ride.rev, ride.power?.normalized ?? null, ride.power?.basisSec ?? 0, ride.load.trimp ?? 0, JSON.stringify(ride.power?.curve ?? [])],
  );
}

/** Every stored row of the current engine revision, oldest first. */
export async function listRideMetrics(db: Pick<SQLiteDatabase, 'getAllAsync'>, sinceSec = 0): Promise<RideMetricsRow[]> {
  const rows = await db.getAllAsync<Raw>('SELECT * FROM ride_metrics WHERE rev = ? AND workout_start >= ? ORDER BY workout_start', [RIDE_ENGINE_REV, sinceSec]);
  return rows.map(toRow);
}

/** Cycling workouts as the app knows them: the sport name says ride (outdoor, indoor, spinning). */
export function isRide(workout: Pick<WorkoutRow, 'sportName'>): boolean {
  return sportKind(workout.sportName) === 'ride';
}

/**
 * Computes and stores the figures of up to `limit` rides (newest first) that have none for this engine revision. The load and the
 * curve only need the ones with power, but a ride without is stored too (an empty row) so it is not read again.
 */
export async function syncRideMetrics(
  db: CyclingDb,
  profile: RideProfile,
  options: { sinceSec: number; limit: number },
): Promise<number> {
  const rides = await db.getAllAsync<{
    id: number;
    start: number;
    end: number;
    duration: number;
    distance: number;
    calories: number;
    sportType: number;
    sportName: string;
    summaryJson: string;
  }>(
    `SELECT w.id, w.start, w."end" AS "end", w.duration, w.distance, w.calories, w.sport_type AS sportType, w.sport_name AS sportName, w.summary_json AS summaryJson
     FROM workouts w LEFT JOIN ride_metrics m ON m.workout_start = w.start AND m.rev = ?
     WHERE w.start >= ? AND w.complete != 0 AND m.workout_start IS NULL
     ORDER BY w.start DESC`,
    [RIDE_ENGINE_REV, options.sinceSec],
  );
  let done = 0;
  for (const ride of rides) {
    if (done >= options.limit) break;
    if (!isRide(ride)) continue;
    const points = await listWorkoutPoints(db as SQLiteDatabase, ride.id);
    const analysis = analyzeRide({ workout: ride, summary: parseSummary(ride.summaryJson), points, profile });
    await saveRideMetrics(db, ride.start, analysis);
    done += 1;
  }
  return done;
}

export interface AllTimeBest {
  sec: number;
  watts: number;
  /** The ride (workout start) it was set in. */
  start: number;
}

/** The best mean power of each duration over all stored rides. */
export function allTimeCurve(rows: readonly RideMetricsRow[]): AllTimeBest[] {
  const best = new Map<number, AllTimeBest>();
  for (const row of rows) {
    for (const e of row.curve) {
      const cur = best.get(e.sec);
      if (!cur || e.watts > cur.watts) best.set(e.sec, { sec: e.sec, watts: e.watts, start: row.start });
    }
  }
  return [...best.values()].sort((a, b) => a.sec - b.sec);
}

/** Of the five key durations, the ones this ride's effort set the all-time best (tied counts) among the rides stored. */
export function recordsOf(rideStart: number, rows: readonly RideMetricsRow[]): number[] {
  const best = allTimeCurve(rows);
  return KEY_DURATIONS.filter((d) => best.find((b) => b.sec === d)?.start === rideStart);
}

/**
 * Extra daily load of power rides in Edwards TRIMP, by local day. Heart rate already puts every ride's minutes into the day's
 * TRIMP (the per-minute samples); a ride with power and an FTP is scored by TSS instead (`TSS_TO_TRIMP` x TSS), so the ride's own
 * heart rate TRIMP is taken out and its TSS-based load put in: no ride is counted twice, a ride without heart rate (a power meter
 * alone) is counted at all, and rides without power or FTP, and every run, are left exactly as they were.
 */
export function rideLoadDeltas(rows: readonly RideMetricsRow[], ftp: number | null): Map<number, number> {
  const deltas = new Map<number, number>();
  if (ftp === null) return deltas;
  for (const row of rows) {
    const tss = row.np !== null ? trainingStressScore(row.basisSec, row.np, ftp) : null;
    if (tss === null) continue;
    const day = startOfLocalDay(row.start);
    deltas.set(day, (deltas.get(day) ?? 0) + tss * TSS_TO_TRIMP - row.trimpHr);
  }
  return deltas;
}

/**
 * Days of strain with the power rides' TSS-based load in place of their heart rate load (see `rideLoadDeltas`): `trimp` and
 * `strain` of a day move by the day's delta, a day with a ride but no heart rate at all is added, and a day never goes below zero.
 * Feeds the same ACWR, readiness and recovery as every other day, so a ride and a run count the same way.
 */
export function applyRideLoad(days: readonly DayStrain[], deltas: ReadonlyMap<number, number>): DayStrain[] {
  if (deltas.size === 0) return [...days];
  const out = days.map((d) => {
    const delta = deltas.get(d.day);
    if (delta === undefined) return d;
    const trimp = Math.max(0, d.trimp + delta);
    return { ...d, trimp, strain: strainFromTrimp(trimp) };
  });
  const have = new Set(days.map((d) => d.day));
  for (const [day, delta] of deltas) {
    if (have.has(day) || delta <= 0) continue;
    out.push({ day, trimp: delta, strain: strainFromTrimp(delta), zoneMinutes: [0, 0, 0, 0, 0], coveredMinutes: 0 });
  }
  return out.sort((a, b) => a.day - b.day);
}

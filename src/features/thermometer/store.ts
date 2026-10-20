/**
 * The bedroom thermometer's raw samples, kept on the phone only. Like the `sensor` table it sits next to, `env_sample` is created from
 * JS (`ensureEnvSchema`, run with the other schemas when the database opens): no native code reads it, so it needs no entry in
 * `joyofit-db-migrations.json`. Only per-night aggregates ever leave the phone (`aggregate.ts`, Wawasan tidur); this table never syncs.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { isThermometer, listSensors, type SavedSensor } from '@/features/sensors/store';

/** Raw samples older than this are deleted. Wawasan tidur keeps 90 nights; the margin covers a late sync. */
export const ENV_RETENTION_DAYS = 120;
/** One sample per sensor per this long, whichever path (foreground scan, overnight service) took it. */
export const SAMPLE_INTERVAL_MS = 5 * 60_000;

export interface EnvSample {
  sensorId: string;
  /** Epoch ms of the advertisement. */
  ts: number;
  tempC: number;
  rhPct: number;
  /** 0..100, null when the frame had none. */
  batteryPct: number | null;
}

type EnvDb = Pick<SQLiteDatabase, 'execAsync' | 'runAsync' | 'getAllAsync' | 'getFirstAsync'>;

interface Row {
  sensor_id: string;
  ts: number;
  temp_c: number;
  rh_pct: number;
  battery_pct: number | null;
}

const fromRow = (r: Row): EnvSample => ({ sensorId: r.sensor_id, ts: r.ts, tempC: r.temp_c, rhPct: r.rh_pct, batteryPct: r.battery_pct });

export async function ensureEnvSchema(db: EnvDb): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS env_sample (
      sensor_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      temp_c REAL NOT NULL,
      rh_pct REAL NOT NULL,
      battery_pct INTEGER,
      PRIMARY KEY (sensor_id, ts)
    ) WITHOUT ROWID;
  `);
}

/**
 * Stores a sample unless the sensor already has one closer than {@link SAMPLE_INTERVAL_MS} to it (the foreground scan and the overnight
 * service can both hear the same sensor, and a drained batch can interleave with live ones). Resolves with whether it was stored.
 */
export async function insertEnvSample(db: EnvDb, s: EnvSample): Promise<boolean> {
  const result = await db.runAsync(
    `INSERT INTO env_sample (sensor_id, ts, temp_c, rh_pct, battery_pct)
     SELECT ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM env_sample WHERE sensor_id = ? AND ts > ? AND ts < ?)`,
    s.sensorId,
    s.ts,
    s.tempC,
    s.rhPct,
    s.batteryPct,
    s.sensorId,
    s.ts - SAMPLE_INTERVAL_MS,
    s.ts + SAMPLE_INTERVAL_MS,
  );
  return result.changes > 0;
}

/** Deletes samples older than {@link ENV_RETENTION_DAYS}. Resolves with how many went. */
export async function pruneEnvSamples(db: EnvDb, now: number): Promise<number> {
  const result = await db.runAsync('DELETE FROM env_sample WHERE ts < ?', now - ENV_RETENTION_DAYS * 86_400_000);
  return result.changes;
}

/** Samples with `fromMs <= ts <= toMs`, oldest first, of every sensor (or one). */
export async function listEnvSamples(db: EnvDb, fromMs: number, toMs: number, sensorId?: string): Promise<EnvSample[]> {
  const rows = sensorId
    ? await db.getAllAsync<Row>('SELECT * FROM env_sample WHERE sensor_id = ? AND ts >= ? AND ts <= ? ORDER BY ts, sensor_id', sensorId, fromMs, toMs)
    : await db.getAllAsync<Row>('SELECT * FROM env_sample WHERE ts >= ? AND ts <= ? ORDER BY ts, sensor_id', fromMs, toMs);
  return rows.map(fromRow);
}

/** Deletes every sample of a sensor (it was forgotten). */
export async function deleteEnvSamples(db: EnvDb, sensorId: string): Promise<void> {
  await db.runAsync('DELETE FROM env_sample WHERE sensor_id = ?', sensorId);
}

export async function latestEnvSample(db: EnvDb, sensorId: string): Promise<EnvSample | null> {
  const row = await db.getFirstAsync<Row>('SELECT * FROM env_sample WHERE sensor_id = ? ORDER BY ts DESC LIMIT 1', sensorId);
  return row ? fromRow(row) : null;
}

/** The bedroom thermometers the person paired, in pairing order. */
export async function listThermometers(db: SQLiteDatabase): Promise<SavedSensor[]> {
  return (await listSensors(db)).filter(isThermometer);
}

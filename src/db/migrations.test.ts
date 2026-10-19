import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import migrationsJson from '../../modules/huawei-wear/schema/joyofit-db-migrations.json';
import { migrate } from './migrations';

/** The slice of expo-sqlite that `migrate` uses, over bun:sqlite. */
function wrap(raw: Database): SQLiteDatabase {
  return {
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
    getFirstAsync: async (sql: string) => raw.query(sql).get(),
  } as unknown as SQLiteDatabase;
}

const columns = (raw: Database, table: string) =>
  raw
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

describe('migration 12: per-sample columns of workout_points', () => {
  it('only adds nullable columns, once, and leaves the stored workouts and points as they were', async () => {
    const raw = new Database(':memory:');
    // A phone that has run the app since migration 3 and holds a recorded workout.
    for (const statements of migrationsJson.slice(0, 3)) raw.exec(statements.join(';\n'));
    raw.exec('PRAGMA user_version = 3');
    raw.exec(
      `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete)
       VALUES (1, 1700000000, 1700000600, 1, 'Running', 600, 5000, 321, 135, 170, 100, '{"kind":"RUNNING"}', 1)`,
    );
    raw.exec(
      `INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr)
       VALUES (1, 1700000001, -6.2, 106.8, 12.5, 140), (1, 1700000002, NULL, NULL, NULL, 142)`,
    );

    await migrate(wrap(raw));

    expect(raw.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version).toBe(migrationsJson.length);
    expect(columns(raw, 'workout_points')).toEqual(['workout_id', 'ts', 'lat', 'lon', 'alt', 'hr', 'speed', 'cadence', 'stride', 'power']);
    expect(raw.query('SELECT ts, lat, lon, alt, hr, speed, cadence, stride, power FROM workout_points ORDER BY ts').all()).toEqual([
      { ts: 1700000001, lat: -6.2, lon: 106.8, alt: 12.5, hr: 140, speed: null, cadence: null, stride: null, power: null },
      { ts: 1700000002, lat: null, lon: null, alt: null, hr: 142, speed: null, cadence: null, stride: null, power: null },
    ]);
    expect(raw.query('SELECT workout_number, distance, summary_json FROM workouts').all()).toEqual([
      { workout_number: 1, distance: 5000, summary_json: '{"kind":"RUNNING"}' },
    ]);

    // A second start applies nothing: ALTER TABLE ADD COLUMN would throw on a duplicate column.
    await migrate(wrap(raw));
    expect(columns(raw, 'workout_points')).toHaveLength(10);
  });

  it('only appends nullable columns to workout_points, never rebuilds a table or deletes', () => {
    const statements = migrationsJson[11] as string[];
    expect(statements).toEqual([
      'ALTER TABLE workout_points ADD COLUMN speed REAL',
      'ALTER TABLE workout_points ADD COLUMN cadence INTEGER',
      'ALTER TABLE workout_points ADD COLUMN stride REAL',
      'ALTER TABLE workout_points ADD COLUMN power INTEGER',
    ]);
  });
});

describe('migration 13: cloud_workout', () => {
  it('only creates the table that records what was uploaded or restored per workout', () => {
    expect(migrationsJson[12] as string[]).toEqual([
      'CREATE TABLE cloud_workout (start INTEGER PRIMARY KEY NOT NULL, rev INTEGER NOT NULL, engine_rev INTEGER NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL, uploaded_at INTEGER NOT NULL)',
    ]);
  });

  it('applies on top of a phone at version 12 and keeps its workouts', async () => {
    const raw = new Database(':memory:');
    for (const statements of migrationsJson.slice(0, 12)) raw.exec(statements.join(';\n'));
    raw.exec('PRAGMA user_version = 12');
    raw.exec(
      `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete)
       VALUES (1, 1700000000, 1700000600, 1, 'Running', 600, 5000, 321, 100, '{}', 1)`,
    );

    await migrate(wrap(raw));

    expect(raw.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version).toBe(migrationsJson.length);
    expect(columns(raw, 'cloud_workout')).toEqual(['start', 'rev', 'engine_rev', 'version', 'hash', 'bytes', 'uploaded_at']);
    expect(raw.query('SELECT COUNT(*) AS n FROM workouts').get()).toEqual({ n: 1 });
  });
});

/** A phone at migration 13 (the last one before watch attribution), with the rows a single-watch user has. */
function phoneAt13(devices: { address: string; lastSync: number | null }[]): Database {
  const raw = new Database(':memory:');
  for (const statements of migrationsJson.slice(0, 13)) raw.exec(statements.join(';\n'));
  raw.exec('PRAGMA user_version = 13');
  for (const d of devices) {
    raw.exec(`INSERT INTO device (address, name, last_sync) VALUES ('${d.address}', 'Watch ${d.address}', ${d.lastSync ?? 'NULL'})`);
  }
  raw.exec(`INSERT INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (1700000000, 10, 1, 8, 0), (1700000060, 12, 1, 9, 0), (1700000120, 5, 1, 4, 1)`);
  raw.exec(`INSERT INTO sleep_segments (start, end, type, stage, imported) VALUES (1700000000, 1700003600, 1, 'light', 0), (1700003600, 1700007200, 2, NULL, 1)`);
  raw.exec(`INSERT INTO sleep_scores (start, end, score) VALUES (1700000000, 1700007200, 80)`);
  raw.exec(
    `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, imported)
     VALUES (1, 1700000000, 1700000600, 1, 'Running', 600, 5000, 321, 100, '{}', 1, 0), (2, 1700100000, 1700100600, 1, 'Running', 600, 5000, 321, 100, '{}', 1, 1)`,
  );
  raw.exec(`INSERT INTO health_metrics (type, ts, last_ts, value, values_json) VALUES ('spo2', 1700000000, 1700000000, 97, '[]')`);
  raw.exec(`INSERT INTO hrv_readings (start, end, source, rmssd, beats) VALUES (1700000000, 1700000060, 'spot', 40, 60)`);
  return raw;
}

const revs = (raw: Database) => ({
  steps: raw.query('SELECT timestamp, rev FROM step_samples ORDER BY timestamp').all(),
  sleep: raw.query('SELECT start, rev FROM sleep_segments ORDER BY start').all(),
  workouts: raw.query('SELECT id, rev FROM workouts ORDER BY id').all(),
  cursor: raw.query('SELECT tbl, seq, uploaded FROM cloud_cursor ORDER BY tbl').all(),
});

describe('migration 14: which watch a row came from', () => {
  it('only adds columns and one table; the one DROP is the three rev triggers, re-created at the end', () => {
    const statements = migrationsJson[13] as string[];
    expect(statements.filter((s) => /^(DELETE|DROP TABLE|INSERT)/.test(s))).toEqual([]);
    const drops = statements.filter((s) => s.startsWith('DROP TRIGGER'));
    expect(drops).toEqual([
      'DROP TRIGGER step_samples_rev_update',
      'DROP TRIGGER sleep_segments_rev_update',
      'DROP TRIGGER workouts_rev_update',
    ]);
    for (const drop of drops) {
      const name = drop.split(' ')[2];
      expect(statements.some((s) => s.startsWith(`CREATE TRIGGER ${name} `))).toBe(true);
      // The trigger comes back exactly as migration 4 made it.
      expect(statements.find((s) => s.startsWith(`CREATE TRIGGER ${name} `))).toBe(
        (migrationsJson[3] as string[]).find((s) => s.startsWith(`CREATE TRIGGER ${name} `)),
      );
    }
  });

  it('attributes the rows of a single-watch phone to its watch, makes it primary, and leaves imported rows and the cloud cursors alone', async () => {
    const raw = phoneAt13([{ address: 'AA:BB', lastSync: 1700000500 }]);
    const before = revs(raw);

    await migrate(wrap(raw));

    expect(raw.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version).toBe(migrationsJson.length);
    expect(raw.query('SELECT timestamp, device FROM step_samples ORDER BY timestamp').all()).toEqual([
      { timestamp: 1700000000, device: 'AA:BB' },
      { timestamp: 1700000060, device: 'AA:BB' },
      { timestamp: 1700000120, device: null },
    ]);
    expect(raw.query('SELECT start, device FROM sleep_segments ORDER BY start').all()).toEqual([
      { start: 1700000000, device: 'AA:BB' },
      { start: 1700003600, device: null },
    ]);
    expect(raw.query('SELECT device FROM sleep_scores').all()).toEqual([{ device: 'AA:BB' }]);
    expect(raw.query('SELECT id, device FROM workouts ORDER BY id').all()).toEqual([
      { id: 1, device: 'AA:BB' },
      { id: 2, device: null },
    ]);
    expect(raw.query('SELECT device FROM health_metrics').all()).toEqual([{ device: 'AA:BB' }]);
    expect(raw.query('SELECT device FROM hrv_readings').all()).toEqual([{ device: 'AA:BB' }]);
    expect(raw.query('SELECT address, alias, is_primary, tracks_health, bg_sync, added_at FROM device').all()).toEqual([
      { address: 'AA:BB', alias: null, is_primary: 1, tracks_health: 1, bg_sync: 0, added_at: 1700000500 },
    ]);
    // Nothing is re-uploaded to the cloud because of the attribution.
    expect(revs(raw)).toEqual(before);
  });

  it('keeps the rev triggers working: a later update still moves the row to the head of the upload queue', async () => {
    const raw = phoneAt13([{ address: 'AA:BB', lastSync: 1700000500 }]);
    await migrate(wrap(raw));
    const old = raw.query<{ rev: number }, []>('SELECT rev FROM step_samples WHERE timestamp = 1700000000').get()!.rev;
    raw.exec('UPDATE step_samples SET steps = 99 WHERE timestamp = 1700000000');
    const bumped = raw.query<{ rev: number }, []>('SELECT rev FROM step_samples WHERE timestamp = 1700000000').get()!.rev;
    expect(bumped).toBeGreaterThan(old);
    raw.exec("INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json) VALUES (3, 1700200000, 1700200600, 1, 'Run', 600, 1, 1, 1, '{}')");
    expect(raw.query<{ rev: number }, []>('SELECT rev FROM workouts WHERE workout_number = 3').get()!.rev).toBeGreaterThan(0);
  });

  it('with two watch rows already stored (an earlier switch) it cannot know whose rows are whose: rows stay unattributed, the newest-synced watch is primary', async () => {
    const raw = phoneAt13([
      { address: 'AA:BB', lastSync: 1700000500 },
      { address: 'CC:DD', lastSync: 1700009999 },
    ]);
    await migrate(wrap(raw));
    expect(raw.query('SELECT COUNT(*) AS n FROM step_samples WHERE device IS NOT NULL').get()).toEqual({ n: 0 });
    expect(raw.query('SELECT COUNT(*) AS n FROM workouts WHERE device IS NOT NULL').get()).toEqual({ n: 0 });
    expect(raw.query('SELECT address, is_primary FROM device ORDER BY address').all()).toEqual([
      { address: 'AA:BB', is_primary: 0 },
      { address: 'CC:DD', is_primary: 1 },
    ]);
  });

  it('a phone that only imported data (no watch row) migrates with no primary and no attribution', async () => {
    const raw = phoneAt13([]);
    await migrate(wrap(raw));
    expect(raw.query('SELECT COUNT(*) AS n FROM step_samples WHERE device IS NOT NULL').get()).toEqual({ n: 0 });
    expect(raw.query('SELECT COUNT(*) AS n FROM device').get()).toEqual({ n: 0 });
  });

  it('a second start applies nothing', async () => {
    const raw = phoneAt13([{ address: 'AA:BB', lastSync: 1700000500 }]);
    await migrate(wrap(raw));
    await migrate(wrap(raw));
    expect(columns(raw, 'device')).toEqual([
      'address', 'name', 'product_model', 'software_version', 'last_sync', 'alias', 'is_primary', 'added_at', 'tracks_health', 'bg_sync',
    ]);
    expect(columns(raw, 'workout_shadow')).toEqual(['device', 'start', 'end', 'kept_start']);
  });
});

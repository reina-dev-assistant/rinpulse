import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it } from 'bun:test';

import migrationsJson from '../../modules/huawei-wear/schema/joyofit-db-migrations.json';

/**
 * The write rules of docs/multi-watch.md, checked on the schema the app ships: two watches write into the same tables
 * with the same statements the native stores use (`SyncStore`, `HealthMetricsStore`, `NightHrv`), and the triggers of
 * migration 14 decide which row is kept.
 */
const A = 'AA:AA:AA:AA:AA:01';
const B = 'BB:BB:BB:BB:BB:02';
const C = 'CC:CC:CC:CC:CC:03';

let db: Database;

function open(primary: string | null) {
  db = new Database(':memory:');
  for (const statements of migrationsJson) db.exec(statements.join(';\n'));
  for (const address of [A, B, C]) {
    db.exec(`INSERT INTO device (address, name, is_primary) VALUES ('${address}', 'W ${address}', ${address === primary ? 1 : 0})`);
  }
}

beforeEach(() => open(A));

interface Step {
  steps: number;
  calories?: number;
  distance?: number;
  hr?: number | null;
  spo2?: number | null;
  rhr?: number | null;
}

/** `SyncStore.save`'s step upsert. */
function writeStep(device: string, timestamp: number, s: Step) {
  db.query(
    `INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate, device)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(timestamp) DO UPDATE SET
       steps = excluded.steps, calories = excluded.calories, distance = excluded.distance,
       heart_rate = excluded.heart_rate, spo2 = excluded.spo2, resting_heart_rate = excluded.resting_heart_rate,
       device = excluded.device, imported = 0`,
  ).run(timestamp, s.steps, s.calories ?? 0, s.distance ?? 0, s.hr ?? null, s.spo2 ?? null, s.rhr ?? null, device);
}

const step = (timestamp: number) =>
  db.query<{ steps: number; device: string | null; rev: number }, [number]>('SELECT steps, device, rev FROM step_samples WHERE timestamp = ?').get(timestamp);

/** `SyncStore.save`'s segment upsert. */
function writeSleep(device: string, start: number, end: number, type = 2) {
  db.query(
    `INSERT INTO sleep_segments (start, end, type, stage, device) VALUES (?, ?, ?, NULL, ?)
     ON CONFLICT(start, type) DO UPDATE SET end = excluded.end, stage = excluded.stage, device = excluded.device, imported = 0`,
  ).run(start, end, type, device);
}

const sleep = () => db.query('SELECT start, end, device FROM sleep_segments ORDER BY start').all();

describe('all-day samples (step_samples): the primary watch owns a minute, the others fill gaps', () => {
  it('a second watch never overwrites the primary, and fills the minutes the primary has nothing for', () => {
    writeStep(A, 1000, { steps: 30, hr: 80 });
    writeStep(B, 1000, { steps: 99, hr: 120 });
    writeStep(B, 1060, { steps: 12 });
    expect(step(1000)).toMatchObject({ steps: 30, device: A });
    expect(step(1060)).toMatchObject({ steps: 12, device: B });
  });

  it('the primary takes a minute over from another watch, whenever it syncs', () => {
    writeStep(B, 1000, { steps: 99 });
    expect(step(1000)).toMatchObject({ steps: 99, device: B });
    writeStep(A, 1000, { steps: 30 });
    expect(step(1000)).toMatchObject({ steps: 30, device: A });
  });

  it('an empty minute of the primary (watch in a drawer) does not hide what another watch recorded, in either order', () => {
    writeStep(A, 1000, { steps: 0 });
    writeStep(B, 1000, { steps: 25, hr: 90 });
    expect(step(1000)).toMatchObject({ steps: 25, device: B });
    // The primary syncing its empty minute later changes nothing.
    writeStep(A, 1000, { steps: 0 });
    expect(step(1000)).toMatchObject({ steps: 25, device: B });
    // and an empty minute of the other watch never replaces the primary's data.
    writeStep(A, 2000, { steps: 8 });
    writeStep(B, 2000, { steps: 0 });
    expect(step(2000)).toMatchObject({ steps: 8, device: A });
  });

  it('two non-primary watches: the one that wrote the minute first keeps it', () => {
    writeStep(B, 1000, { steps: 10 });
    writeStep(C, 1000, { steps: 77 });
    expect(step(1000)).toMatchObject({ steps: 10, device: B });
  });

  it('a watch rewrites its own minutes, and unattributed rows (imported, unknown) lose to every watch', () => {
    writeStep(B, 1000, { steps: 10 });
    writeStep(B, 1000, { steps: 11 });
    expect(step(1000)).toMatchObject({ steps: 11, device: B });
    db.exec('INSERT INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (3000, 5, 0, 0, 1)');
    writeStep(C, 3000, { steps: 6 });
    expect(step(3000)).toMatchObject({ steps: 6, device: C });
  });

  it('a refused write does not move the row up the cloud upload queue, an accepted one does', () => {
    writeStep(A, 1000, { steps: 30 });
    const before = step(1000)!.rev;
    writeStep(B, 1000, { steps: 99 });
    expect(step(1000)!.rev).toBe(before);
    writeStep(A, 1000, { steps: 31 });
    expect(step(1000)!.rev).toBeGreaterThan(before);
  });

  it('with no primary every watch is equal: first writer keeps the minute', () => {
    open(null);
    writeStep(B, 1000, { steps: 10 });
    writeStep(A, 1000, { steps: 20 });
    expect(step(1000)).toMatchObject({ steps: 10, device: B });
  });

  it('changing the primary changes who wins from the next write on', () => {
    writeStep(A, 1000, { steps: 30 });
    db.exec(`UPDATE device SET is_primary = (address = '${B}')`);
    writeStep(B, 1000, { steps: 28 });
    expect(step(1000)).toMatchObject({ steps: 28, device: B });
    writeStep(A, 1000, { steps: 31 });
    expect(step(1000)).toMatchObject({ steps: 28, device: B });
  });
});

describe('sleep: one watch per stretch of the night', () => {
  it('another watch is skipped where the primary has sleep, and kept where it has not', () => {
    writeSleep(A, 1000, 5000);
    writeSleep(B, 1100, 4900);
    writeSleep(B, 90_000, 93_000);
    expect(sleep()).toEqual([
      { start: 1000, end: 5000, device: A },
      { start: 90_000, end: 93_000, device: B },
    ]);
  });

  it('the primary replaces what another watch stored for the same stretch, even with other boundaries', () => {
    writeSleep(B, 1100, 4900);
    writeSleep(B, 4900, 6000, 1);
    writeSleep(A, 1000, 5500);
    expect(sleep()).toEqual([{ start: 1000, end: 5500, device: A }]);
  });

  it('only overlapping rows are replaced', () => {
    writeSleep(B, 1100, 4900);
    writeSleep(B, 200_000, 203_000);
    writeSleep(A, 1000, 5500);
    expect(sleep()).toEqual([
      { start: 1000, end: 5500, device: A },
      { start: 200_000, end: 203_000, device: B },
    ]);
  });

  it('non-primary watches: the first one keeps the stretch', () => {
    writeSleep(B, 1000, 5000);
    writeSleep(C, 1200, 5100);
    expect(sleep()).toEqual([{ start: 1000, end: 5000, device: B }]);
  });

  it('segments of one watch never remove each other, and unattributed rows never block', () => {
    writeSleep(B, 1000, 3000, 1);
    writeSleep(B, 3000, 5000, 2);
    db.exec("INSERT INTO sleep_segments (start, end, type, imported) VALUES (500, 2000, 2, 1)");
    writeSleep(C, 1500, 2500, 1);
    expect(sleep()).toEqual([
      { start: 500, end: 2000, device: null },
      { start: 1000, end: 3000, device: B },
      { start: 3000, end: 5000, device: B },
    ]);
  });

  it('sleep scores follow the same rule', () => {
    db.exec(`INSERT INTO sleep_scores (start, end, score, device) VALUES (1000, 5000, 80, '${B}')`);
    db.exec(`INSERT INTO sleep_scores (start, end, score, device) VALUES (1100, 5200, 70, '${A}')`);
    expect(db.query('SELECT score, device FROM sleep_scores').all()).toEqual([{ score: 70, device: A }]);
    db.exec(`INSERT INTO sleep_scores (start, end, score, device) VALUES (1200, 5000, 90, '${C}')`);
    expect(db.query('SELECT score, device FROM sleep_scores').all()).toEqual([{ score: 70, device: A }]);
  });

  it('night HRV follows the same rule and spot measurements never conflict', () => {
    const night = (device: string, start: number, end: number) =>
      db.query("INSERT OR REPLACE INTO hrv_readings (start, end, source, rmssd, beats, device) VALUES (?, ?, 'night', 40, 100, ?)").run(start, end, device);
    night(B, 1000, 5000);
    night(A, 1100, 5200);
    night(C, 1200, 5000);
    expect(db.query("SELECT device FROM hrv_readings WHERE source = 'night'").all()).toEqual([{ device: A }]);
    for (const d of [A, B]) {
      db.query("INSERT OR REPLACE INTO hrv_readings (start, end, source, rmssd, beats, device) VALUES (3000, 3060, 'spot', 40, 60, ?)").run(d);
    }
    expect(db.query("SELECT COUNT(*) AS n FROM hrv_readings WHERE source = 'spot'").get()).toEqual({ n: 1 });
  });
});

describe('health_metrics: one value per type and time, the primary wins', () => {
  const upsert = (device: string, ts: number, value: number) =>
    db
      .query(
        `INSERT INTO health_metrics (type, ts, last_ts, value, values_json, device) VALUES ('spo2', ?, ?, ?, '[]', ?)
         ON CONFLICT(type, ts) DO UPDATE SET last_ts = excluded.last_ts, value = excluded.value, values_json = excluded.values_json, device = excluded.device`,
      )
      .run(ts, ts, value, device);
  const value = (ts: number) => db.query('SELECT value, device FROM health_metrics WHERE ts = ?').get(ts);

  it('keeps the primary, lets the primary take over, and keeps the first of two other watches', () => {
    upsert(A, 100, 97);
    upsert(B, 100, 90);
    expect(value(100)).toEqual({ value: 97, device: A });
    upsert(B, 200, 91);
    upsert(C, 200, 92);
    expect(value(200)).toEqual({ value: 91, device: B });
    upsert(A, 200, 95);
    expect(value(200)).toEqual({ value: 95, device: A });
  });
});

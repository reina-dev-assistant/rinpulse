import { Database } from 'bun:sqlite';
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import * as prefsSyncModule from '@/cloud/prefsSync';
import { createHealthAdapters, countDirtyHealth, scanHealth, setCycleGate, type HealthOptions } from '@/cloud/healthRecords';
import { forgetHealthRestore, restoreWindow, type FetchRestorePage, type RestoreOptions, type RestorePage, type RestoreTable } from '@/cloud/healthRestore';
import { runSync } from '@/cloud/syncEngine';
import { ensureSyncItemSchema, listItems } from '@/cloud/syncItems';
import { FakeSyncServer, openMemoryDb } from '@/cloud/syncTestKit';
import { countPendingRows, listSleepAfter, listStepSamplesAfter } from '@/db/cloud';

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);
const NOW_S = T0 / 1000;
const DAY = 86_400;
const clock = { t: T0 };
const tick = (ms = 120_000) => {
  clock.t += ms;
};

beforeEach(() => {
  clock.t = T0;
});

// ---------------------------------------------------------------------------------------------------------------------
// A phone: its own database, its own cycle switch, one shared server.

interface Phone {
  db: SQLiteDatabase;
  raw: Database;
  cursor: number;
  now: () => number;
  cycle: { on: boolean };
  wiped: number;
  options: HealthOptions;
}

async function phone(server?: FakeSyncServer): Promise<Phone> {
  const { db, raw } = openMemoryDb();
  await ensureSyncItemSchema(db);
  const p: Phone = { db, raw, cursor: 0, now: () => clock.t, cycle: { on: true }, wiped: 0, options: undefined as never };
  p.options = {
    cycleEnabled: () => p.cycle.on,
    wipeCycle: async () => {
      p.wiped += 1;
      if (server) for (const key of [...server.rows.keys()]) if (/^cycle(period|day)\u0000/.test(key)) server.rows.delete(key);
    },
    now: p.now,
  };
  return p;
}

const sync = (server: FakeSyncServer, p: Phone) => runSync(server.io(p), createHealthAdapters(p.db, p.options));
const one = <T>(p: Phone, sql: string, ...args: unknown[]) => p.raw.query(sql).get(...(args as never[])) as T;
const all = <T>(p: Phone, sql: string, ...args: unknown[]) => p.raw.query(sql).all(...(args as never[])) as T[];

// ---------------------------------------------------------------------------------------------------------------------
// restore

/** The Worker's `restoreSteps` / `restoreSleep` over an in-memory copy of its tables. */
function fakeRestoreServer(cloud: Phone) {
  const calls: { table: RestoreTable; after: string | number | null }[] = [];
  const state = { failOnCall: -1 };
  const fetchPage = async (table: RestoreTable, from: number, after: string | number | null, limit: number): Promise<RestorePage> => {
    calls.push({ table, after });
    if (calls.length - 1 === state.failOnCall) throw new Error('network down');
    if (table === 'steps') {
      const rows = all<{ timestamp: number; steps: number; calories: number; distance: number; heart_rate: number | null; spo2: number | null; resting_heart_rate: number | null }>(
        cloud,
        'SELECT * FROM step_samples WHERE timestamp >= ? AND timestamp > ? ORDER BY timestamp LIMIT ?',
        from,
        Number(after ?? -1),
        limit + 1,
      );
      const page = rows.slice(0, limit);
      return {
        rows: page.map((r) => ({
          timestamp: r.timestamp,
          steps: r.steps,
          calories: r.calories,
          distance: r.distance,
          heartRate: r.heart_rate,
          spo2: r.spo2,
          restingHeartRate: r.resting_heart_rate,
          device: 'watch',
        })),
        cursor: page.at(-1)?.timestamp ?? null,
        hasMore: rows.length > limit,
      };
    }
    const [aStart, aType] = after === null ? [-1, -1] : String(after).split(':').map(Number);
    const rows = all<{ start: number; end: number; type: number; stage: string | null }>(
      cloud,
      'SELECT start, end, type, stage FROM sleep_segments WHERE start >= ? AND end >= ? AND (start, type) > (?, ?) ORDER BY start, type LIMIT ?',
      Math.max(0, from - DAY),
      from,
      aStart,
      aType,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      rows: page.map((r) => ({ ...r, device: 'watch' })),
      cursor: last ? `${last.start}:${last.type}` : null,
      hasMore: rows.length > limit,
    };
  };
  return { fetchPage, calls, state };
}

function seedCloud(cloud: Phone, steps: number, sleepNights: number) {
  cloud.raw.exec('BEGIN');
  for (let i = 0; i < steps; i++) {
    const ts = NOW_S - 60 * (steps - i);
    cloud.raw.exec(`INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate) VALUES (${ts}, ${i % 30}, 1, 2, 70)`);
  }
  for (let n = 0; n < sleepNights; n++) {
    const start = NOW_S - (n + 1) * DAY;
    cloud.raw.exec(`INSERT INTO sleep_segments (start, end, type, stage) VALUES (${start}, ${start + 3600}, 1, 'light')`);
    cloud.raw.exec(`INSERT INTO sleep_segments (start, end, type, stage) VALUES (${start}, ${start + 1800}, 2, 'deep')`);
  }
  cloud.raw.exec('COMMIT');
}

const restoreOpts = (fetchPage: FetchRestorePage, extra: Partial<RestoreOptions> = {}): RestoreOptions => ({
  days: 90,
  userId: 'user-1',
  fetchPage,
  now: () => clock.t,
  ...extra,
});

describe('restoreWindow', () => {
  it('pages through steps and sleep and stores every row as imported', async () => {
    const cloud = await phone();
    seedCloud(cloud, 4_500, 10);
    const server = fakeRestoreServer(cloud);
    const fresh = await phone();
    const progress: number[] = [];
    const result = await restoreWindow(fresh.db, restoreOpts(server.fetchPage, { onProgress: (done) => progress.push(done) }));

    expect(result).toEqual({ steps: 4_500, sleep: 20 });
    expect(server.calls.filter((c) => c.table === 'steps')).toHaveLength(3);
    expect(one<{ n: number }>(fresh, 'SELECT COUNT(*) AS n FROM step_samples WHERE imported = 1').n).toBe(4_500);
    expect(one<{ n: number }>(fresh, 'SELECT COUNT(*) AS n FROM step_samples WHERE imported = 0').n).toBe(0);
    expect(one<{ n: number }>(fresh, 'SELECT COUNT(*) AS n FROM sleep_segments WHERE imported = 1').n).toBe(20);
    expect(one<{ heart_rate: number; spo2: number | null }>(fresh, 'SELECT heart_rate, spo2 FROM step_samples LIMIT 1').heart_rate).toBe(70);
    expect(progress.at(-1)).toBe(4_520);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it('twice is no change and asks the server for nothing the second time', async () => {
    const cloud = await phone();
    seedCloud(cloud, 50, 3);
    const server = fakeRestoreServer(cloud);
    const fresh = await phone();
    await restoreWindow(fresh.db, restoreOpts(server.fetchPage));
    const before = all(fresh, 'SELECT * FROM step_samples ORDER BY timestamp');
    const calls = server.calls.length;

    expect(await restoreWindow(fresh.db, restoreOpts(server.fetchPage))).toEqual({ steps: 0, sleep: 0 });
    expect(server.calls.length).toBe(calls);

    // Even when the bookkeeping is lost, INSERT OR IGNORE writes nothing new (the phone now holds the window).
    fresh.raw.exec('DELETE FROM cloud_state');
    expect(await restoreWindow(fresh.db, restoreOpts(server.fetchPage))).toEqual({ steps: 0, sleep: 0 });
    expect(all(fresh, 'SELECT * FROM step_samples ORDER BY timestamp')).toEqual(before);
  });

  it('resumes after an interruption from the saved cursor', async () => {
    const cloud = await phone();
    seedCloud(cloud, 4_500, 4);
    const server = fakeRestoreServer(cloud);
    const fresh = await phone();
    server.state.failOnCall = 1;
    await expect(restoreWindow(fresh.db, restoreOpts(server.fetchPage))).rejects.toThrow('network down');
    expect(one<{ n: number }>(fresh, 'SELECT COUNT(*) AS n FROM step_samples').n).toBe(2_000);

    server.state.failOnCall = -1;
    server.calls.length = 0;
    const result = await restoreWindow(fresh.db, restoreOpts(server.fetchPage));
    // The first request after the failure continues behind the last stored page, not from the start.
    expect(server.calls[0].after).not.toBeNull();
    expect(result.steps).toBe(4_500);
    expect(one<{ n: number }>(fresh, 'SELECT COUNT(*) AS n FROM step_samples').n).toBe(4_500);
    expect(one<{ n: number }>(fresh, 'SELECT COUNT(*) AS n FROM sleep_segments').n).toBe(8);
  });

  it('after forgetHealthRestore a wiped phone restores again', async () => {
    const cloud = await phone();
    seedCloud(cloud, 10, 1);
    const server = fakeRestoreServer(cloud);
    const fresh = await phone();
    await restoreWindow(fresh.db, restoreOpts(server.fetchPage));
    fresh.raw.exec('DELETE FROM step_samples; DELETE FROM sleep_segments');
    expect(await restoreWindow(fresh.db, restoreOpts(server.fetchPage))).toEqual({ steps: 0, sleep: 0 });
    await forgetHealthRestore(fresh.db);
    expect(await restoreWindow(fresh.db, restoreOpts(server.fetchPage))).toEqual({ steps: 10, sleep: 2 });
  });

  it('skips a table the phone already holds the window of', async () => {
    const cloud = await phone();
    seedCloud(cloud, 20, 2);
    const server = fakeRestoreServer(cloud);
    const fresh = await phone();
    // The watch synced three months of steps on this phone already (a first sync reads everything the watch holds).
    fresh.raw.exec(`INSERT INTO step_samples (timestamp, steps, calories, distance) VALUES (${NOW_S - 120 * DAY}, 5, 0, 0)`);
    const result = await restoreWindow(fresh.db, restoreOpts(server.fetchPage));
    expect(result.steps).toBe(0);
    expect(server.calls.every((c) => c.table === 'sleep')).toBe(true);
    expect(result.sleep).toBe(4);
  });

  it('never overwrites a row this phone measured', async () => {
    const cloud = await phone();
    seedCloud(cloud, 5, 1);
    const ts = NOW_S - 60 * 3;
    const server = fakeRestoreServer(cloud);
    const fresh = await phone();
    fresh.raw.exec(`INSERT INTO step_samples (timestamp, steps, calories, distance) VALUES (${ts}, 999, 7, 7)`);
    fresh.raw.exec(`INSERT INTO step_samples (timestamp, steps, calories, distance) VALUES (${NOW_S - DAY * 200}, 1, 1, 1)`);
    await restoreWindow(fresh.db, restoreOpts(server.fetchPage));
    expect(one<{ steps: number; imported: number }>(fresh, 'SELECT steps, imported FROM step_samples WHERE timestamp = ?', ts)).toEqual({ steps: 999, imported: 0 });
  });

  it('a later native write of the same minute is one row and becomes own data', async () => {
    const cloud = await phone();
    seedCloud(cloud, 5, 2);
    const server = fakeRestoreServer(cloud);
    const fresh = await phone();
    await restoreWindow(fresh.db, restoreOpts(server.fetchPage));
    const ts = NOW_S - 60 * 2;
    const start = NOW_S - DAY;
    expect(one<{ imported: number }>(fresh, 'SELECT imported FROM step_samples WHERE timestamp = ?', ts).imported).toBe(1);

    // SyncStore.kt / SyncStore.swift, verbatim.
    fresh.raw.exec(
      `INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate) VALUES (${ts}, 11, 1, 1, 80, NULL, NULL)
       ON CONFLICT(timestamp) DO UPDATE SET steps = excluded.steps, calories = excluded.calories, distance = excluded.distance,
         heart_rate = excluded.heart_rate, spo2 = excluded.spo2, resting_heart_rate = excluded.resting_heart_rate, imported = 0`,
    );
    fresh.raw.exec(
      `INSERT INTO sleep_segments (start, end, type, stage) VALUES (${start}, ${start + 3700}, 1, 'rem')
       ON CONFLICT(start, type) DO UPDATE SET end = excluded.end, stage = excluded.stage, imported = 0`,
    );
    expect(all(fresh, 'SELECT * FROM step_samples WHERE timestamp = ?', ts)).toHaveLength(1);
    expect(one<{ steps: number; imported: number }>(fresh, 'SELECT steps, imported FROM step_samples WHERE timestamp = ?', ts)).toMatchObject({ steps: 11, imported: 0 });
    expect(all(fresh, 'SELECT * FROM sleep_segments WHERE start = ? AND type = 1', start)).toHaveLength(1);
    expect(one<{ imported: number }>(fresh, 'SELECT imported FROM sleep_segments WHERE start = ? AND type = 1', start).imported).toBe(0);
    // Counted once in a day total.
    expect(one<{ s: number }>(fresh, 'SELECT SUM(steps) AS s FROM step_samples WHERE timestamp = ?', ts).s).toBe(11);
  });

  it('restored rows are never pending for upload', async () => {
    const cloud = await phone();
    seedCloud(cloud, 30, 3);
    const server = fakeRestoreServer(cloud);
    const fresh = await phone();
    await restoreWindow(fresh.db, restoreOpts(server.fetchPage));
    expect(await listStepSamplesAfter(fresh.db, 0, 100)).toEqual([]);
    expect(await listSleepAfter(fresh.db, 0, 100)).toEqual([]);
    expect(await countPendingRows(fresh.db)).toBe(0);
  });

  it('a window of 400 days or more is cut to what the server accepts', async () => {
    const cloud = await phone();
    const server = fakeRestoreServer(cloud);
    const fresh = await phone();
    const froms: number[] = [];
    await restoreWindow(fresh.db, restoreOpts(async (t, from, after, limit) => {
      froms.push(from);
      return server.fetchPage(t, from, after, limit);
    }, { days: 5_000 }));
    expect(NOW_S - froms[0]).toBeLessThanOrEqual(400 * DAY);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// record kinds

const metricRow = (p: Phone, type: string, ts: number, value: number | null, lastTs = ts, json = '{}') =>
  p.raw.exec(`INSERT INTO health_metrics (type, ts, last_ts, value, values_json) VALUES ('${type}', ${ts}, ${lastTs}, ${value}, '${json}')`);

describe('health records A -> B', () => {
  it('hrv, sleepscore, metric and cycle rows reach the other phone', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone(server);
    const b = await phone(server);
    const night = NOW_S - 8 * 3600;
    a.raw.exec(`INSERT INTO hrv_readings (start, end, source, rmssd, sdnn, mean_rr, beats) VALUES (${night - 7200}, ${night}, 'night', 48.5, NULL, NULL, 900)`);
    a.raw.exec(`INSERT INTO hrv_readings (start, end, source, rmssd, sdnn, mean_rr, beats) VALUES (${night + 100}, ${night + 160}, 'spot', 40, 50, 800, 60)`);
    a.raw.exec(`INSERT INTO sleep_scores (start, end, score, efficiency) VALUES (${night - 7200}, ${night}, 82, 91)`);
    for (let i = 0; i < 5; i++) metricRow(a, 'skin_temperature', NOW_S - 3600 * i, 33 + i / 10, NOW_S - 3600 * i + 60, '{"v":1}');
    a.raw.exec("INSERT INTO cycle_periods (start, end, modified) VALUES ('2026-10-01', '2026-10-05', 1790000000)");
    a.raw.exec("INSERT INTO cycle_days (day, flow, cramps, modified) VALUES ('2026-10-02', 2, 1, 1790000100)");

    const up = await sync(server, a);
    expect(up.rejected).toEqual([]);
    expect(up.pushed).toBeGreaterThanOrEqual(6);
    tick();
    const down = await sync(server, b);
    expect(down.applied).toBe(up.pushed);

    expect(all(b, 'SELECT start, end, source, rmssd, sdnn, mean_rr, beats FROM hrv_readings ORDER BY start')).toEqual(
      all(a, 'SELECT start, end, source, rmssd, sdnn, mean_rr, beats FROM hrv_readings ORDER BY start'),
    );
    expect(all(b, 'SELECT * FROM sleep_scores')).toEqual(all(a, 'SELECT * FROM sleep_scores'));
    expect(all(b, 'SELECT * FROM health_metrics ORDER BY ts')).toEqual(all(a, 'SELECT * FROM health_metrics ORDER BY ts'));
    expect(all(b, 'SELECT * FROM cycle_periods')).toEqual(all(a, 'SELECT * FROM cycle_periods'));
    expect(all(b, 'SELECT * FROM cycle_days')).toEqual(all(a, 'SELECT * FROM cycle_days'));

    // What B received is not sent back, and a second pass changes nothing on either side.
    tick();
    expect((await sync(server, b)).pushed).toBe(0);
    tick();
    expect((await sync(server, a)).pushed).toBe(0);
    expect(await countDirtyHealth(b.db, b.options)).toBe(0);
  });

  it('records have the documented ids and doc shapes, and stay far below the server caps', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone(server);
    const ts = Date.UTC(2026, 9, 17, 23, 30) / 1000;
    metricRow(a, 'hrv', ts, 55, ts, '{"a":1}');
    a.raw.exec(`INSERT INTO hrv_readings (start, end, source, rmssd, beats) VALUES (100000, 100100, 'spot', 40, 10)`);
    a.raw.exec(`INSERT INTO hrv_readings (start, end, source, rmssd, beats) VALUES (${NOW_S - 100}, ${NOW_S - 40}, 'spot', 40, 10)`);
    a.raw.exec(`INSERT INTO sleep_scores (start, end, score) VALUES (${NOW_S - 9000}, ${NOW_S - 100}, 70)`);
    await sync(server, a);
    const keys = [...server.rows.keys()].map((k) => k.replace('\u0000', '/'));
    expect(keys).toContain('metric/hrv:2026-10-17');
    expect(keys).toContain(`hrv/${NOW_S - 100}:spot`);
    expect(keys).toContain(`sleepscore/${NOW_S - 9000}`);
    // The 1970 row is outside the 400-day scan window.
    expect(keys.some((k) => k.startsWith('hrv/100000'))).toBe(false);
    const metric = JSON.parse(server.rows.get('metric\u0000hrv:2026-10-17')!.json);
    expect(metric).toEqual({ type: 'hrv', day: '2026-10-17', rows: [[ts, ts, 55, '{"a":1}']], n: 1 });
    expect(server.rows.get('metric\u0000hrv:2026-10-17')!.rank).toBe(1);
  });

  it('a day is bundled in UTC, so phones in any time zone cut the same days', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone(server);
    metricRow(a, 'emotion', Date.UTC(2026, 9, 16, 23, 59, 59) / 1000, 1);
    metricRow(a, 'emotion', Date.UTC(2026, 9, 17, 0, 0, 0) / 1000, 2);
    await sync(server, a);
    const ids = [...server.rows.values()].filter((r) => r.kind === 'metric').map((r) => r.id).sort();
    expect(ids).toEqual(['emotion:2026-10-16', 'emotion:2026-10-17']);
  });

  it('a fuller bundle beats a newer partial one, and the partial phone ends with the full day', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone(server);
    const b = await phone(server);
    const day = Date.UTC(2026, 9, 17) / 1000;
    for (let i = 0; i < 6; i++) metricRow(a, 'skin_temperature', day + i * 600, 33 + i / 10);
    await sync(server, a);
    tick();
    // B has only two of the six rows, and edits them later than A did.
    for (let i = 0; i < 2; i++) metricRow(b, 'skin_temperature', day + i * 600, 33 + i / 10);
    await scanHealth(b.db, b.options);
    tick();
    const report = await sync(server, b);
    expect(report.applied).toBeGreaterThanOrEqual(1);
    expect(server.rows.get('metric\u0000skin_temperature:2026-10-17')!.rank).toBe(6);
    expect(one<{ n: number }>(b, 'SELECT COUNT(*) AS n FROM health_metrics').n).toBe(6);
    tick();
    expect((await sync(server, b)).pushed).toBe(0);
  });

  it('a phone with more rows than the cloud sends its fuller bundle', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone(server);
    const b = await phone(server);
    const day = Date.UTC(2026, 9, 17) / 1000;
    for (let i = 0; i < 3; i++) metricRow(a, 'ams', day + i * 600, i);
    await sync(server, a);
    tick();
    await sync(server, b);
    expect(one<{ n: number }>(b, 'SELECT COUNT(*) AS n FROM health_metrics').n).toBe(3);
    for (let i = 3; i < 7; i++) metricRow(b, 'ams', day + i * 600, i);
    tick();
    expect((await sync(server, b)).pushed).toBe(1);
    expect(server.rows.get('metric\u0000ams:2026-10-17')!.rank).toBe(7);
    tick();
    await sync(server, a);
    expect(one<{ n: number }>(a, 'SELECT COUNT(*) AS n FROM health_metrics').n).toBe(7);
  });

  it('merges two phones that each hold different rows of one day', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone(server);
    const b = await phone(server);
    const day = Date.UTC(2026, 9, 17) / 1000;
    for (let i = 0; i < 4; i++) metricRow(a, 'ams', day + i * 600, i);
    for (let i = 4; i < 6; i++) metricRow(b, 'ams', day + i * 600, i);
    await sync(server, a);
    tick();
    await sync(server, b);
    expect(one<{ n: number }>(b, 'SELECT COUNT(*) AS n FROM health_metrics').n).toBe(6);
    tick();
    await sync(server, b);
    tick();
    await sync(server, a);
    expect(one<{ n: number }>(a, 'SELECT COUNT(*) AS n FROM health_metrics').n).toBe(6);
    expect(server.rows.get('metric\u0000ams:2026-10-17')!.rank).toBe(6);
    tick();
    expect((await sync(server, a)).pushed).toBe(0);
    expect((await sync(server, b)).pushed).toBe(0);
  });

  it('splits a day that would exceed 48 KB into hour bundles under the server cap', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone(server);
    const b = await phone(server);
    const day = Date.UTC(2026, 9, 17) / 1000;
    const big = JSON.stringify({ pad: 'x'.repeat(400) });
    a.raw.exec('BEGIN');
    for (let i = 0; i < 200; i++) metricRow(a, 'arrhythmia', day + i * 300, i, day + i * 300, big);
    a.raw.exec('COMMIT');
    await sync(server, a);
    const bundles = [...server.rows.values()].filter((r) => r.kind === 'metric');
    expect(bundles.length).toBeGreaterThan(1);
    expect(bundles.every((r) => r.json.length < 48_000)).toBe(true);
    expect(bundles.every((r) => /^arrhythmia:2026-10-17:\d\d$/.test(r.id))).toBe(true);
    tick();
    await sync(server, b);
    expect(one<{ n: number }>(b, 'SELECT COUNT(*) AS n FROM health_metrics').n).toBe(200);
  });

  it('a newer score replaces the older one on the other phone', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone(server);
    const b = await phone(server);
    const start = NOW_S - 9000;
    a.raw.exec(`INSERT INTO sleep_scores (start, end, score) VALUES (${start}, ${start + 8000}, 60)`);
    await sync(server, a);
    tick();
    await sync(server, b);
    tick();
    a.raw.exec(`UPDATE sleep_scores SET score = 77, end = ${start + 8500} WHERE start = ${start}`);
    await sync(server, a);
    tick();
    await sync(server, b);
    expect(one<{ score: number; end: number }>(b, 'SELECT score, end FROM sleep_scores')).toEqual({ score: 77, end: start + 8500 });
  });

  it('two phones with different values for one HRV night converge on the newer one', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone(server);
    const b = await phone(server);
    const end = NOW_S - 6 * 3600;
    a.raw.exec(`INSERT INTO hrv_readings (start, end, source, rmssd, beats) VALUES (${end - 7000}, ${end}, 'night', 40, 500)`);
    await sync(server, a);
    tick();
    await sync(server, b);
    tick();
    b.raw.exec(`UPDATE hrv_readings SET rmssd = 52, beats = 700`);
    await sync(server, b);
    tick();
    await sync(server, a);
    expect(one<{ rmssd: number }>(a, 'SELECT rmssd FROM hrv_readings').rmssd).toBe(52);
    for (let i = 0; i < 2; i++) {
      tick();
      expect((await sync(server, a)).pushed).toBe(0);
      expect((await sync(server, b)).pushed).toBe(0);
    }
  });

  it('a pulled night overlapping a richer local night is dropped; a poorer local one is replaced', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone(server);
    const b = await phone(server);
    const end = NOW_S - 6 * 3600;
    a.raw.exec(`INSERT INTO hrv_readings (start, end, source, rmssd, beats) VALUES (${end - 7200}, ${end}, 'night', 40, 300)`);
    b.raw.exec(`INSERT INTO hrv_readings (start, end, source, rmssd, beats) VALUES (${end - 7000}, ${end}, 'night', 44, 800)`);
    await sync(server, a);
    tick();
    await sync(server, b);
    expect(all<{ beats: number }>(b, 'SELECT beats FROM hrv_readings')).toEqual([{ beats: 800 }]);
    tick();
    await sync(server, a);
    expect(all<{ beats: number }>(a, 'SELECT beats FROM hrv_readings')).toEqual([{ beats: 800 }]);
  });

  it('restored rows are not pending and survive a rescan; a scan is bounded by the 400-day window', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone(server);
    const b = await phone(server);
    a.raw.exec(`INSERT INTO sleep_scores (start, end, score) VALUES (${NOW_S - 9000}, ${NOW_S - 100}, 70)`);
    a.raw.exec(`INSERT INTO sleep_scores (start, end, score) VALUES (${NOW_S - 500 * DAY}, ${NOW_S - 500 * DAY + 100}, 50)`);
    await sync(server, a);
    expect(server.rows.size).toBe(1);
    tick();
    await sync(server, b);
    tick(86_400_000);
    await scanHealth(b.db, b.options);
    expect(await countDirtyHealth(b.db, b.options)).toBe(0);
  });
});

describe('cycle switch', () => {
  it('off: nothing is pushed or applied, the cloud copies are wiped; on again: everything is uploaded again', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone(server);
    const b = await phone(server);
    a.raw.exec("INSERT INTO cycle_periods (start, end, modified) VALUES ('2026-10-01', '2026-10-05', 1790000000)");
    a.raw.exec("INSERT INTO cycle_days (day, flow, cramps, modified) VALUES ('2026-10-02', 2, 1, 1790000100)");
    await sync(server, a);
    expect([...server.rows.values()].filter((r) => r.kind.startsWith('cycle'))).toHaveLength(2);

    a.cycle.on = false;
    await setCycleGate(a.db, false, a.options);
    expect(a.wiped).toBe(1);
    expect([...server.rows.values()].filter((r) => r.kind.startsWith('cycle'))).toHaveLength(0);

    a.raw.exec("INSERT INTO cycle_days (day, flow, cramps, modified) VALUES ('2026-10-03', 1, 0, 1790000200)");
    tick();
    await sync(server, a);
    expect([...server.rows.values()].filter((r) => r.kind.startsWith('cycle'))).toHaveLength(0);
    expect(await countDirtyHealth(a.db, a.options)).toBe(0);

    // B (switch on) sends its own row; A, switched off, does not apply it.
    b.raw.exec("INSERT INTO cycle_days (day, flow, cramps, modified) VALUES ('2026-10-09', 3, 3, 1790000300)");
    tick();
    await sync(server, b);
    tick();
    await sync(server, a);
    expect(all(a, "SELECT * FROM cycle_days WHERE day = '2026-10-09'")).toEqual([]);
    expect(a.wiped).toBe(1);

    a.cycle.on = true;
    await setCycleGate(a.db, true, a.options);
    tick();
    const up = await sync(server, a);
    expect(up.pushed).toBeGreaterThanOrEqual(3);
    const stored = [...server.rows.values()].filter((r) => r.kind === 'cycleday').map((r) => r.id).sort();
    expect(stored).toEqual(['2026-10-02', '2026-10-03', '2026-10-09']);
  });

  it('a pulled switch change only forgets on the receiving phone, no wipe', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const b = await phone(server);
    b.raw.exec("INSERT INTO cycle_days (day, flow, cramps, modified) VALUES ('2026-10-02', 2, 1, 1790000100)");
    await sync(server, b);
    expect(server.rows.size).toBe(1);
    b.cycle.on = false;
    tick();
    await sync(server, b);
    expect(b.wiped).toBe(0);
    expect(await listItems(b.db, 'cycleday')).toEqual([]);
    b.cycle.on = true;
    tick();
    expect((await sync(server, b)).pushed).toBe(1);
  });

  it('a wipe that failed (offline) is retried by the next run', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone(server);
    a.raw.exec("INSERT INTO cycle_days (day, flow, cramps, modified) VALUES ('2026-10-02', 2, 1, 1790000100)");
    await sync(server, a);
    let online = false;
    const options: HealthOptions = {
      ...a.options,
      wipeCycle: async () => {
        if (!online) throw new Error('offline');
        await a.options.wipeCycle();
      },
    };
    a.cycle.on = false;
    await setCycleGate(a.db, false, options);
    expect(server.rows.size).toBe(1);
    online = true;
    tick();
    await runSync(server.io(a), createHealthAdapters(a.db, options));
    expect(server.rows.size).toBe(0);
    expect(a.wiped).toBe(1);
  });

  it('newest modified wins and a deleted period is a tombstone that removes it elsewhere', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone(server);
    const b = await phone(server);
    a.raw.exec("INSERT INTO cycle_periods (start, end, modified) VALUES ('2026-10-01', NULL, 1790000000)");
    await sync(server, a);
    tick();
    await sync(server, b);
    expect(one<{ end: string | null }>(b, 'SELECT end FROM cycle_periods').end).toBeNull();

    tick();
    const edit = Math.floor(clock.t / 1000);
    b.raw.exec(`UPDATE cycle_periods SET end = '2026-10-06', modified = ${edit}`);
    await sync(server, b);
    tick();
    await sync(server, a);
    expect(one<{ end: string; modified: number }>(a, 'SELECT end, modified FROM cycle_periods')).toEqual({ end: '2026-10-06', modified: edit });

    tick();
    a.raw.exec("DELETE FROM cycle_periods WHERE start = '2026-10-01'");
    await sync(server, a);
    tick();
    await sync(server, b);
    expect(all(b, 'SELECT * FROM cycle_periods')).toEqual([]);
    tick();
    expect((await sync(server, b)).pushed).toBe(0);
  });
});

describe('pending count and scan cost', () => {
  it('counts rows waiting and none once pushed; an unchanged table is not re-queued', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone(server);
    a.raw.exec(`INSERT INTO sleep_scores (start, end, score) VALUES (${NOW_S - 9000}, ${NOW_S - 100}, 70)`);
    metricRow(a, 'ams', NOW_S - 300, 1);
    await scanHealth(a.db, a.options);
    expect(await countDirtyHealth(a.db, a.options)).toBe(2);
    await sync(server, a);
    expect(await countDirtyHealth(a.db, a.options)).toBe(0);
    tick(86_400_000);
    await scanHealth(a.db, a.options);
    expect(await countDirtyHealth(a.db, a.options)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// A copy of the real module, taken before the mock below replaces it for every test file that loads later.
const realPrefsSync = { ...prefsSyncModule };

// the public wrapper

// The wrapper imports the app's HTTP client and KV store, which only exist once mocked: the mocks must be in place
// before the module loads, so it is imported inside the tests.
describe('healthSync wrapper', () => {
  const kv = new Map<string, string>();
  const requests: string[] = [];
  const wipes: unknown[] = [];
  const noted: string[] = [];
  let cloudDb: Phone;

  mock.module('expo-sqlite/kv-store', () => ({
    default: {
      getItemSync: (key: string) => kv.get(key) ?? null,
      setItemSync: (key: string, value: string) => void kv.set(key, value),
    },
  }));
  mock.module('@/cloud/api', () => ({
    // Every export other modules import by name: the mock outlives this file, and a later file loading a module that imports a
    // missing name fails with "Export named ... not found" depending on test order.
    NotSignedInError: class NotSignedInError extends Error {},
    CloudNotConfiguredError: class CloudNotConfiguredError extends Error {},
    CloudHttpError: class CloudHttpError extends Error {},
    CloudLockedError: class CloudLockedError extends Error {},
    withRetry: <T,>(request: () => Promise<T>) => request(),
    cloudRequest: async (_method: string, path: string) => {
      requests.push(path);
      const url = new URL(`https://x${path}`);
      const table = url.searchParams.get('table') as RestoreTable;
      const after = url.searchParams.get('after');
      return fakeRestoreServer(cloudDb).fetchPage(table, Number(url.searchParams.get('from')), after, Number(url.searchParams.get('limit')));
    },
  }));
  mock.module('@/cloud/rogo', () => ({ rogoCall: async (_path: string, input: unknown) => void wipes.push(input) }));
  mock.module('@/cloud/prefsSync', () => ({ ...realPrefsSync, notePrefChanged: async (key: string) => void noted.push(key) }));
  // A module mock outlives the file that made it: put the real module back for `prefsSync.test.ts` and any file that loads later.
  afterAll(() => {
    mock.module('@/cloud/prefsSync', () => realPrefsSync);
  });

  it('cycle sync is on by default; setCycleSync flips the KV, notes the pref and wipes the cloud kinds', async () => {
    const { cycleSyncEnabled, setCycleSync } = await import('@/cloud/healthSync');
    const p = await phone();
    expect(cycleSyncEnabled()).toBe(true);
    await setCycleSync(p.db, false);
    expect(cycleSyncEnabled()).toBe(false);
    expect(kv.get('cloud.syncCycle')).toBe('0');
    expect(noted).toEqual(['sync.cycle']);
    expect(wipes).toEqual([{ ns: 'fit', kinds: ['cycleperiod', 'cycleday'] }]);
    await setCycleSync(p.db, true);
    expect(cycleSyncEnabled()).toBe(true);
    expect(wipes).toHaveLength(1);
  });

  it('restoreHealthWindow asks the Worker with from/after/limit and fills the tables', async () => {
    const { restoreHealthWindow } = await import('@/cloud/healthSync');
    cloudDb = await phone();
    seedCloud(cloudDb, 2_500, 2);
    const fresh = await phone();
    await expect(restoreHealthWindow(fresh.db)).rejects.toThrow();
    fresh.raw.exec("INSERT INTO cloud_state (key, value) VALUES ('user_id', 'user-1')");
    const result = await restoreHealthWindow(fresh.db);
    expect(result).toEqual({ steps: 2_500, sleep: 4 });
    expect(requests[0]).toMatch(/^\/v1\/restore\?table=steps&from=\d+&limit=2000$/);
    expect(requests[1]).toMatch(/table=steps&from=\d+&limit=2000&after=\d+$/);
    expect(requests.some((r) => r.startsWith('/v1/restore?table=sleep'))).toBe(true);
  });

  it('healthPendingCount scans first and counts what waits', async () => {
    const { healthPendingCount } = await import('@/cloud/healthSync');
    const p = await phone();
    p.raw.exec(`INSERT INTO sleep_scores (start, end, score) VALUES (${Math.floor(Date.now() / 1000) - 9000}, ${Math.floor(Date.now() / 1000) - 100}, 70)`);
    expect(await healthPendingCount(p.db)).toBe(1);
  });
});

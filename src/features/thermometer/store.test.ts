import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';

import { ensureSensorSchema, saveSensor } from '@/features/sensors/store';

import {
  deleteEnvSamples,
  ENV_RETENTION_DAYS,
  ensureEnvSchema,
  insertEnvSample,
  latestEnvSample,
  listEnvSamples,
  listThermometers,
  pruneEnvSamples,
  SAMPLE_INTERVAL_MS,
  type EnvSample,
} from './store';

async function openDb() {
  const raw = new Database(':memory:');
  const flat = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? params[0] : params) as never[];
  const db = {
    getAllAsync: async (sql: string, ...p: unknown[]) => raw.query(sql).all(...flat(p)),
    getFirstAsync: async (sql: string, ...p: unknown[]) => raw.query(sql).get(...flat(p)),
    runAsync: async (sql: string, ...p: unknown[]) => {
      const r = raw.query(sql).run(...flat(p));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes };
    },
    execAsync: async (sql: string) => raw.exec(sql),
  };
  await ensureEnvSchema(db as never);
  await ensureSensorSchema(db as never);
  return db as never as Parameters<typeof insertEnvSample>[0] & Parameters<typeof listThermometers>[0];
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const s = (ts: number, sensorId = 'S1', tempC = 25): EnvSample => ({ sensorId, ts, tempC, rhPct: 55, batteryPct: 90 });

describe('env_sample', () => {
  it('stores samples and lists a range oldest first, per sensor or for all', async () => {
    const db = await openDb();
    await insertEnvSample(db, s(NOW + 2 * SAMPLE_INTERVAL_MS));
    await insertEnvSample(db, s(NOW));
    await insertEnvSample(db, s(NOW, 'S2'));
    expect((await listEnvSamples(db, NOW, NOW + DAY)).map((x) => x.sensorId + x.ts)).toEqual([`S1${NOW}`, `S2${NOW}`, `S1${NOW + 2 * SAMPLE_INTERVAL_MS}`]);
    expect(await listEnvSamples(db, NOW, NOW + DAY, 'S2')).toEqual([s(NOW, 'S2')]);
    expect(await listEnvSamples(db, NOW + 1, NOW + SAMPLE_INTERVAL_MS)).toEqual([]);
    expect((await latestEnvSample(db, 'S1'))?.ts).toBe(NOW + 2 * SAMPLE_INTERVAL_MS);
    expect(await latestEnvSample(db, 'nobody')).toBeNull();
  });

  it('refuses a second sample of the same sensor closer than the interval, on either side', async () => {
    const db = await openDb();
    expect(await insertEnvSample(db, s(NOW))).toBe(true);
    expect(await insertEnvSample(db, s(NOW))).toBe(false);
    expect(await insertEnvSample(db, s(NOW + SAMPLE_INTERVAL_MS - 1))).toBe(false);
    expect(await insertEnvSample(db, s(NOW - SAMPLE_INTERVAL_MS + 1))).toBe(false);
    expect(await insertEnvSample(db, s(NOW + SAMPLE_INTERVAL_MS))).toBe(true);
    expect(await insertEnvSample(db, s(NOW + 1_000, 'S2'))).toBe(true);
    expect(await listEnvSamples(db, 0, NOW + DAY)).toHaveLength(3);
  });

  it('keeps the battery reading, null included', async () => {
    const db = await openDb();
    await insertEnvSample(db, { ...s(NOW), batteryPct: null });
    expect((await latestEnvSample(db, 'S1'))?.batteryPct).toBeNull();
  });

  it('prunes samples older than 120 days and only those', async () => {
    const db = await openDb();
    await insertEnvSample(db, s(NOW - ENV_RETENTION_DAYS * DAY - 1));
    await insertEnvSample(db, s(NOW - ENV_RETENTION_DAYS * DAY + HOUR));
    await insertEnvSample(db, s(NOW));
    expect(await pruneEnvSamples(db, NOW)).toBe(1);
    expect((await listEnvSamples(db, 0, NOW + DAY)).map((x) => x.ts)).toEqual([NOW - ENV_RETENTION_DAYS * DAY + HOUR, NOW]);
  });
});

describe('thermometer pairing', () => {
  it('lists only paired thermometers, leaving sports sensors alone', async () => {
    const db = await openDb();
    await saveSensor(db as never, { id: 'A4:C1:38:8D:18:B2', name: 'ATC_8D18B2', kinds: ['thermometer'] }, 10);
    await saveSensor(db as never, { id: 'AA:BB', name: 'Polar H10', kinds: ['hr'] }, 20);
    const found = await listThermometers(db as never);
    expect(found.map((x) => x.id)).toEqual(['A4:C1:38:8D:18:B2']);
    expect(found[0]?.kinds).toEqual(['thermometer']);
  });
});

describe('forgetting', () => {
  it('deletes the samples of one sensor only', async () => {
    const db = await openDb();
    await insertEnvSample(db, s(NOW, 'S1'));
    await insertEnvSample(db, s(NOW, 'S2'));
    await deleteEnvSamples(db, 'S1');
    expect((await listEnvSamples(db, 0, NOW + DAY)).map((x) => x.sensorId)).toEqual(['S2']);
  });
});

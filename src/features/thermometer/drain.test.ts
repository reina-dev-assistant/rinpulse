import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';

import { drainRoomAdverts } from './drain';
import { pickRoomCapture } from './roomNative';
import { ThermometerSampler } from './sampler';
import { ensureEnvSchema, listEnvSamples } from './store';

const MIN = 60_000;
const T0 = 1_700_000_000_000;
const MAC = 'A4:C1:38:8D:18:B2';

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
  } as never;
  await ensureEnvSchema(db);
  return db as Parameters<typeof drainRoomAdverts>[2];
}

const atc = (counter: number) => 'a4c1388d18b2' + '00ea' + '37' + '57' + '0ba1' + counter.toString(16).padStart(2, '0');

function fakeNative(adverts: { id: string; ts: number; uuid: string; hex: string }[]) {
  const cleared: number[] = [];
  return {
    cleared,
    roomAdverts: async () => adverts,
    clearRoomAdverts: async (ts: number) => {
      cleared.push(ts);
    },
  };
}

describe('drainRoomAdverts', () => {
  it('stores what a night of kept adverts decodes to, then clears up to the newest', async () => {
    const db = await openDb();
    const sampler = new ThermometerSampler();
    sampler.setPaired([MAC]);
    const adverts = [0, 1, 2, 3].map((i) => ({ id: MAC, ts: T0 + i * 5 * MIN, uuid: '181a', hex: atc(i + 1) }));
    const native = fakeNative([...adverts].reverse());
    const stored = await drainRoomAdverts(native, sampler, db);
    expect(stored.map((s) => s.ts)).toEqual(adverts.map((a) => a.ts));
    expect(await listEnvSamples(db, 0, T0 + 24 * 60 * MIN)).toHaveLength(4);
    expect(native.cleared).toEqual([T0 + 15 * MIN]);
  });

  it('drops adverts of sensors that are not paired and frames that do not decode, yet still clears them', async () => {
    const db = await openDb();
    const sampler = new ThermometerSampler();
    sampler.setPaired([MAC]);
    const native = fakeNative([
      { id: 'AA:BB:CC:DD:EE:FF', ts: T0, uuid: '181a', hex: atc(1) },
      { id: MAC, ts: T0 + MIN, uuid: '181a', hex: 'zz' },
    ]);
    expect(await drainRoomAdverts(native, sampler, db)).toEqual([]);
    expect(native.cleared).toEqual([T0 + MIN]);
  });

  it('does nothing when the file is empty', async () => {
    const native = fakeNative([]);
    expect(await drainRoomAdverts(native, new ThermometerSampler(), await openDb())).toEqual([]);
    expect(native.cleared).toEqual([]);
  });

  it('does not clear when storing fails, so the next drain starts over', async () => {
    const sampler = new ThermometerSampler();
    sampler.setPaired([MAC]);
    const native = fakeNative([{ id: MAC, ts: T0, uuid: '181a', hex: atc(1) }]);
    const broken = { runAsync: async () => { throw new Error('disk full'); } } as never;
    await expect(drainRoomAdverts(native, sampler, broken)).rejects.toThrow('disk full');
    expect(native.cleared).toEqual([]);
  });

  it('refuses a sample the database already holds (a second drain of the same file)', async () => {
    const db = await openDb();
    const adverts = [{ id: MAC, ts: T0, uuid: '181a', hex: atc(1) }];
    const first = new ThermometerSampler();
    first.setPaired([MAC]);
    expect(await drainRoomAdverts(fakeNative(adverts), first, db)).toHaveLength(1);
    const second = new ThermometerSampler(); // a restarted app: no memory
    second.setPaired([MAC]);
    expect(await drainRoomAdverts(fakeNative(adverts), second, db)).toEqual([]);
  });
});

describe('pickRoomCapture', () => {
  const full = { startRoomCapture() {}, stopRoomCapture() {}, roomCaptureState() {}, roomAdverts() {}, clearRoomAdverts() {} };

  it('returns a module that has every function and null for one from before the feature', () => {
    expect(pickRoomCapture(full)).toBe(full);
    expect(pickRoomCapture({ startScan() {} })).toBeNull();
    expect(pickRoomCapture({ ...full, roomAdverts: undefined })).toBeNull();
    expect(pickRoomCapture(null)).toBeNull();
    expect(pickRoomCapture(undefined)).toBeNull();
  });
});

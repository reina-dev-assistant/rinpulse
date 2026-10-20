import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';

import { captureFinal, confirmPending, type CaptureContext, type LastSaved } from './capture';
import { ensureScaleSchema, listWeighIns, type ScaleDb } from './store';
import type { ScaleReading } from './types';

async function openDb(): Promise<ScaleDb> {
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
  } as unknown as ScaleDb;
  await ensureScaleSchema(db);
  return db;
}

const NOW = 1_000 * 86_400_000;
const user = { heightCm: 175, ageYears: 34, male: true };

async function ctx(over: Partial<CaptureContext> = {}): Promise<CaptureContext> {
  return {
    db: await openDb(), scaleId: 'AA', protocolId: 'okok-chipsea-broadcast', user, guardPercent: 6, pushToRogo: true, now: NOW,
    reference: async () => ({ weightKg: 73.5, at: NOW - 86_400_000 }), ...over,
  };
}

const final = (weightKg: number, extra: Partial<ScaleReading> = {}): ScaleReading => ({ weightKg, stable: true, ...extra });

describe('captureFinal', () => {
  it('saves a weigh-in close to the last one and queues it for JoyoRogo', async () => {
    const c = await ctx();
    const r = await captureFinal(c, final(73.9), false, null);
    expect(r.kind).toBe('saved');
    const [row] = await listWeighIns(c.db);
    expect(row).toMatchObject({ weightKg: 73.9, takenAt: NOW, rogoState: 'pending' });
  });

  it('asks "Ini kamu?" for a weight far from the last one and saves nothing yet', async () => {
    const c = await ctx();
    const r = await captureFinal(c, final(52), false, null);
    expect(r).toMatchObject({ kind: 'confirm', pending: { referenceKg: 73.5, reading: { weightKg: 52 } } });
    expect(await listWeighIns(c.db)).toHaveLength(0);
    if (r.kind !== 'confirm') throw new Error('unreachable');
    const saved = await confirmPending(c, r.pending);
    expect(saved.kind).toBe('saved');
    expect(await listWeighIns(c.db)).toHaveLength(1);
  });

  it('does not ask without a reference or when the question is off', async () => {
    expect((await captureFinal(await ctx({ reference: async () => null }), final(40), false, null)).kind).toBe('saved');
    expect((await captureFinal(await ctx({ guardPercent: 0 }), final(40), false, null)).kind).toBe('saved');
  });

  it('keeps a weight JoyoRogo does not take, and everything when pushing is off, as skipped', async () => {
    const low = await ctx({ reference: async () => null });
    await captureFinal(low, final(20), false, null);
    expect((await listWeighIns(low.db))[0].rogoState).toBe('skipped');
    const off = await ctx({ pushToRogo: false });
    await captureFinal(off, final(73.5), false, null);
    expect((await listWeighIns(off.db))[0].rogoState).toBe('skipped');
  });

  it('completes the row just saved when the same weight comes back with impedance, with an estimate', async () => {
    const c = await ctx();
    const first = await captureFinal(c, final(73.5), false, null);
    if (first.kind !== 'saved') throw new Error('unreachable');
    const out = await captureFinal(c, final(73.5, { impedanceOhm: 480 }), true, { id: first.weighIn.id, weightKg: 73.5 });
    expect(out).toEqual({ kind: 'completed', id: first.weighIn.id });
    const rows = await listWeighIns(c.db);
    expect(rows).toHaveLength(1);
    expect(rows[0].impedanceOhm).toBe(480);
    expect(rows[0].estimate?.formula).toBe('standard');
    expect(rows[0].estimate?.bodyFatPct).toBeGreaterThan(0);
  });

  it('never invents body values: no impedance or no profile means none', async () => {
    const noImpedance = await ctx();
    await captureFinal(noImpedance, final(73.5), false, null);
    expect((await listWeighIns(noImpedance.db))[0]).toMatchObject({ estimate: null, reported: null });
    const noProfile = await ctx({ user: null });
    await captureFinal(noProfile, final(73.5, { impedanceOhm: 480 }), false, null);
    expect((await listWeighIns(noProfile.db))[0].estimate).toBeNull();
  });

  it("keeps the scale's own body values and then gives no estimate", async () => {
    const c = await ctx({ protocolId: 'standard-weight-profile' });
    await captureFinal(c, final(73.5, { impedanceOhm: 480, reported: { bodyFatPct: 18.5, waterPct: 55 } }), false, null);
    const [row] = await listWeighIns(c.db);
    expect(row.reported).toEqual({ bodyFatPct: 18.5, waterPct: 55 });
    expect(row.estimate).toBeNull();
  });
});

describe('captureFinal for a weight-only scale', () => {
  it('stores no body values and no impedance, even for a frame that carries them, and still queues the weight for JoyoRogo', async () => {
    const c = await ctx({ protocolId: 'tuya-beacon-broadcast', reference: async () => null });
    await captureFinal(c, final(108.6, { impedanceOhm: 500, reported: { bodyFatPct: 30 } }), false, null);
    const [row] = await listWeighIns(c.db);
    expect(row).toMatchObject({ weightKg: 108.6, impedanceOhm: null, reported: null, estimate: null, rogoState: 'pending' });
  });
});

describe('captureFinal with a revision', () => {
  const settle = (weightKg: number): ScaleReading => ({ weightKg, stable: true, revision: true });

  it('replaces the weight of the row saved for the same weigh-in and queues it for JoyoRogo again', async () => {
    const c = await ctx({ protocolId: 'tuya-beacon-broadcast', reference: async () => null });
    const first = await captureFinal(c, final(107.9), false, null);
    if (first.kind !== 'saved') throw new Error('unreachable');
    const last: LastSaved = { id: first.weighIn.id, weightKg: 107.9, at: NOW };
    const revised = await captureFinal({ ...c, now: NOW + 160_000 }, settle(108.6), false, last);
    expect(revised).toEqual({ kind: 'revised', weighIn: { id: first.weighIn.id, weightKg: 108.6 } });
    const rows = await listWeighIns(c.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ weightKg: 108.6, takenAt: NOW, rogoState: 'pending', rogoError: null });
  });

  it('is a new weigh-in when there is no row from this weigh-in: nothing saved, an older row far away, or one saved long ago', async () => {
    const c = await ctx({ reference: async () => null });
    expect((await captureFinal(c, settle(108.6), false, null)).kind).toBe('saved');
    expect((await captureFinal(c, settle(108.6), false, { id: 1, weightKg: 70, at: NOW })).kind).toBe('saved');
    expect((await captureFinal(c, settle(108.6), false, { id: 1, weightKg: 108, at: NOW - 3_600_000 })).kind).toBe('saved');
    expect(await listWeighIns(c.db)).toHaveLength(3);
  });

  it('a revised row stays out of JoyoRogo when pushing is off', async () => {
    const c = await ctx({ pushToRogo: false, reference: async () => null });
    const first = await captureFinal(c, final(107.9), false, null);
    if (first.kind !== 'saved') throw new Error('unreachable');
    await captureFinal(c, settle(108.6), false, { id: first.weighIn.id, weightKg: 107.9, at: NOW });
    expect((await listWeighIns(c.db))[0]).toMatchObject({ weightKg: 108.6, rogoState: 'skipped' });
  });
});

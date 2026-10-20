/** The owner's real HRTZC01 weigh-in, its recorded values and timing, under a fake key (sn 16 to 21: 107.9, 107.9, 107.9, 107.5, 108.6, 108.6; display locked at 108.6 kg) end to end: one row, 108.6 kg. */
import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';

import { captureFinal, type CaptureContext, type LastSaved } from './capture';
import { FakeScaleNative } from './fakeNative.testkit';
import { ScaleHub } from './hub';
import type { ScaleNative } from './native';
import { tuyaBeaconProtocol } from './protocols/tuyaBeacon';
import { ensureScaleSchema, listWeighIns, type ScaleDb } from './store';
import { WeighSession } from './weigh';

const ID = 'DC:23:53:DC:E1:95';
const KEY = 'TestKey012345678';
/** First sight of each sn in the recording, seconds from sn 16 (the gaps are 37, 19, 71, 58 and 17 s). */
const FRAMES: [number, string][] = [
  [0, '05dc2353dce195000000109394e4ad7a7e974d417c205ac1be1873'],
  [36.9, '05dc2353dce19500000011973590e78716f0662f0d3f3482f9e7dc'],
  [56.0, '05dc2353dce1950000001209e5f063534a71eeddcf5138b00fd75a'],
  [126.6, '05dc2353dce19500000013634307f6b1f76cf27e071f7e605a1dc1'],
  [184.1, '05dc2353dce195000000147ae0e1e1c8536c607b66042e7eac39b1'],
  [200.9, '05dc2353dce195000000150211f8168321f2c38c7e6b28085eb05a'],
];

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

/** What ScaleProvider does with every settled reading, with the clock the recording had. */
async function weighIn(frames: [number, string][], pushToRogo = true) {
  const db = await openDb();
  const t0 = 1_000_000_000_000;
  const clock = { t: t0 };
  const native = new FakeScaleNative();
  const hub = new ScaleHub(() => native as ScaleNative);
  let last: LastSaved | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const session = new WeighSession(
    hub,
    { id: ID, protocol: tuyaBeaconProtocol, secret: KEY },
    { lowLatency: true, user: () => null, now: () => clock.t },
    {
      onStatus: () => {},
      onLive: () => {},
      onTrace: () => {},
      onProblem: () => {},
      onFinal: (reading, upgrade) => {
        const ctx: CaptureContext = {
          db, scaleId: ID, protocolId: tuyaBeaconProtocol.id, user: null, guardPercent: 6, pushToRogo, now: clock.t,
          reference: async () => null,
        };
        chain = chain.then(async () => {
          const result = await captureFinal(ctx, reading, upgrade, last);
          if (result.kind === 'saved' || result.kind === 'revised') last = { id: result.weighIn.id, weightKg: result.weighIn.weightKg, at: ctx.now };
        });
      },
    },
  );
  await session.start();
  for (const [seconds, hex] of frames) {
    clock.t = t0 + seconds * 1000;
    // The scale repeats an advertisement several times a second.
    for (const extra of [0, 300, 600]) {
      clock.t = t0 + seconds * 1000 + extra;
      native.emit('onScaleAdvertisement', {
        id: ID, name: null, rssi: -66, ts: clock.t, serviceUuids: [], serviceData: {}, manufacturerData: { d007: hex },
      });
    }
  }
  await chain;
  session.stop();
  return listWeighIns(db);
}

describe('a real Tuya weigh-in', () => {
  it('saves one row with the final weight, 108.6 kg, and queues it for JoyoRogo', async () => {
    const rows = await weighIn(FRAMES);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ weightKg: 108.6, impedanceOhm: null, reported: null, estimate: null, rogoState: 'pending' });
  });
  it('the first settled value is saved at once: frames up to sn 18 save 107.9 kg, once', async () => {
    const rows = await weighIn(FRAMES.slice(0, 3));
    expect(rows.map((r) => r.weightKg)).toEqual([107.9]);
  });
  it('the rest of the sequence after a silence longer than the weigh-in gap is a second weigh-in, not a revision', async () => {
    const later = FRAMES.slice(3).map(([s, hex]): [number, string] => [s + 300, hex]);
    const rows = await weighIn([...FRAMES.slice(0, 3), ...later]);
    expect(rows.map((r) => r.weightKg)).toEqual([108.6, 107.9]);
  });
  it('with pushing off the revised row stays out of JoyoRogo', async () => {
    const rows = await weighIn(FRAMES, false);
    expect(rows.map((r) => [r.weightKg, r.rogoState])).toEqual([[108.6, 'skipped']]);
  });
});

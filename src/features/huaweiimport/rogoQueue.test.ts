import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';

import { ensureScaleSchema, IMPORTED_SCALE_ID, insertWeighIn, listWeighIns, pendingWeighIns } from '@/features/scale/store';

import { ensureRogoImportQueueSchema, IMPORT_BATCH, pendingImportCounts, pushImportedToRogo, type ImportClient, type QueueDb } from './rogoQueue';

async function openDb(): Promise<{ db: QueueDb; raw: Database }> {
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
  } as unknown as QueueDb;
  await ensureScaleSchema(db);
  await ensureRogoImportQueueSchema(db);
  return { db, raw };
}

// 2026-08-13 12:00 UTC
const T = Date.UTC(2026, 7, 13, 12);

const weighIn = (takenAt: number, weightKg: number, rogoState: 'pending' | 'skipped' = 'pending', reported: object | null = null) => ({
  scaleId: IMPORTED_SCALE_ID,
  takenAt,
  reading: { weightKg },
  reported,
  estimate: null,
  rogoState,
});

const queue = (raw: Database, kind: string, key: string, payload: object, state = 'pending') =>
  raw.query('INSERT INTO rogo_import_queue (kind, key, payload, state) VALUES (?, ?, ?, ?)').run(kind, key, JSON.stringify(payload), state);

function fakeClient(over: Partial<ImportClient> = {}) {
  const calls = { weights: [] as unknown[][], meals: [] as unknown[][], water: [] as unknown[][] };
  const client: ImportClient = {
    importWeights: async (e) => (calls.weights.push(e), { added: e.length, skipped: 0 }),
    importMeals: async (m) => (calls.meals.push(m), { added: m.length, skipped: 0 }),
    importWater: async (d) => (calls.water.push(d), { added: d.length, skipped: 0 }),
    ...over,
  };
  return { client, calls };
}

const online = () => false;

describe('pushImportedToRogo', () => {
  it('sends imported weigh-ins with their day and body values, never as a scale check-in, and marks them sent', async () => {
    const { db } = await openDb();
    await insertWeighIn(db, weighIn(T, 89.24, 'pending', { bodyFatPct: 25.123, bmi: 30.9 }));
    // a Bluetooth scale's own pending weigh-in is not this push's business
    await insertWeighIn(db, { ...weighIn(T + 1000, 70), scaleId: 'AA:BB' });
    const { client, calls } = fakeClient();
    const out = await pushImportedToRogo(db, client, online);
    expect(calls.weights).toEqual([[{ weightKg: 89.2, date: '2026-08-13', bodyFatPct: 25.1 }]]);
    expect(out.weighIns).toEqual({ added: 1, skipped: 0, waiting: 0 });
    expect((await listWeighIns(db)).find((w) => w.scaleId === IMPORTED_SCALE_ID)?.rogoState).toBe('sent');
    expect((await pendingWeighIns(db)).map((w) => w.scaleId)).toEqual(['AA:BB']);
    // and nothing is sent twice
    await pushImportedToRogo(db, client, online);
    expect(calls.weights.length).toBe(1);
  });

  it('treats the first version\'s skipped imported rows as waiting, and a weight JoyoRogo cannot take as skipped with its reason', async () => {
    const { db } = await openDb();
    await insertWeighIn(db, weighIn(T, 80, 'skipped'));
    await insertWeighIn(db, weighIn(T - 86_400_000, 5, 'pending'));
    const { client, calls } = fakeClient();
    const out = await pushImportedToRogo(db, client, online);
    expect(calls.weights[0]).toHaveLength(1);
    expect(out.weighIns.added).toBe(1);
    const rows = await listWeighIns(db);
    expect(rows.find((w) => w.weightKg === 5)).toMatchObject({ rogoState: 'skipped', rogoError: 'out of range' });
  });

  it('counts what JoyoRogo already had as skipped', async () => {
    const { db } = await openDb();
    await insertWeighIn(db, weighIn(T, 80));
    await insertWeighIn(db, weighIn(T - 86_400_000, 81));
    const { client } = fakeClient({ importWeights: async () => ({ added: 1, skipped: 1 }) });
    const out = await pushImportedToRogo(db, client, online);
    expect(out.weighIns).toEqual({ added: 1, skipped: 1, waiting: 0 });
  });

  it('sends meals and water from the queue in batches of at most 100', async () => {
    const { db, raw } = await openDb();
    for (let i = 0; i < 230; i++) queue(raw, 'meal', `r:${String(i).padStart(3, '0')}`, { key: `r:${i}`, date: '2026-08-02', meal: 'sarapan', name: 'x', kcal: 100 });
    queue(raw, 'water', '2026-08-02', { date: '2026-08-02', glasses: 3 });
    const { client, calls } = fakeClient();
    const out = await pushImportedToRogo(db, client, online);
    expect(calls.meals.map((b) => b.length)).toEqual([IMPORT_BATCH, IMPORT_BATCH, 30]);
    expect(calls.water).toEqual([[{ date: '2026-08-02', glasses: 3 }]]);
    expect(out.meals.added).toBe(230);
    expect(await pendingImportCounts(db)).toEqual({ weighIns: 0, meals: 0, water: 0 });
  });

  it('offline or signed out leaves everything pending and quiet', async () => {
    const { db, raw } = await openDb();
    await insertWeighIn(db, weighIn(T, 80));
    queue(raw, 'meal', 'r:0', { key: 'r:0' });
    queue(raw, 'water', '2026-08-02', { date: '2026-08-02', glasses: 1 });
    const down = async () => {
      throw new Error('offline');
    };
    const { client } = fakeClient({ importWeights: down, importMeals: down, importWater: down });
    const out = await pushImportedToRogo(db, client, () => true);
    expect(out.error).toBeNull();
    expect([out.weighIns.waiting, out.meals.waiting, out.water.waiting]).toEqual([1, 1, 1]);
    expect(await pendingImportCounts(db)).toEqual({ weighIns: 1, meals: 1, water: 1 });
  });

  it('a server error is kept with the rows and reported, and the other kinds still go', async () => {
    const { db, raw } = await openDb();
    await insertWeighIn(db, weighIn(T, 80));
    queue(raw, 'water', '2026-08-02', { date: '2026-08-02', glasses: 1 });
    const { client } = fakeClient({
      importWeights: async () => {
        throw new Error('404 not found');
      },
    });
    const out = await pushImportedToRogo(db, client, () => false);
    expect(out.error).toBe('404 not found');
    expect(out.weighIns.waiting).toBe(1);
    expect(out.water.added).toBe(1);
    expect((await listWeighIns(db))[0]).toMatchObject({ rogoState: 'pending', rogoError: '404 not found' });
    expect(await pendingImportCounts(db)).toEqual({ weighIns: 1, meals: 0, water: 0 });
  });

  it('a queue row whose payload is not JSON is set aside instead of blocking the rest', async () => {
    const { db, raw } = await openDb();
    raw.query("INSERT INTO rogo_import_queue (kind, key, payload) VALUES ('meal', 'bad', 'not json')").run();
    queue(raw, 'meal', 'ok', { key: 'ok' });
    const { client, calls } = fakeClient();
    await pushImportedToRogo(db, client, online);
    expect(calls.meals).toEqual([[{ key: 'ok' }]]);
    expect(raw.query("SELECT state FROM rogo_import_queue WHERE key = 'bad'").get()).toEqual({ state: 'invalid' });
  });
});

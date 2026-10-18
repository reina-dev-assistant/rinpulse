import { describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { runSync, type RecordAdapter } from '@/cloud/syncEngine';
import {
  applyRemoteItem,
  clearSyncItems,
  ensureSyncItemSchema,
  getItem,
  listDirtyItems,
  markItemsPushed,
  putLocalItem,
} from '@/cloud/syncItems';
import { FakeSyncServer, openMemoryDb } from '@/cloud/syncTestKit';

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);

async function phone(offset = 0) {
  const { db } = openMemoryDb();
  await ensureSyncItemSchema(db);
  return { db, cursor: 0, now: () => clock.t + offset };
}
const clock = { t: T0 };
const adapter = (db: SQLiteDatabase): RecordAdapter => ({
  kind: 'pref',
  listDirty: (limit) => listDirtyItems(db, 'pref', limit),
  markPushed: (sent, serverTimes) => markItemsPushed(db, sent, serverTimes),
  applyRemote: (remote, skew) => applyRemoteItem(db, remote, skew),
});
const doc = (value: unknown) => JSON.stringify({ value });

describe('sync_item with the engine', () => {
  it('moves a record from phone A to phone B and back, and a delete as a tombstone', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone();
    const b = await phone();
    await putLocalItem(a.db, 'pref', 'theme', doc('dark'), a.now());
    expect((await runSync(server.io(a), [adapter(a.db)])).pushed).toBe(1);
    clock.t += 10_000;
    expect((await runSync(server.io(b), [adapter(b.db)])).applied).toBe(1);
    expect((await getItem(b.db, 'pref', 'theme'))?.json).toBe(doc('dark'));

    clock.t += 10_000;
    await putLocalItem(b.db, 'pref', 'theme', doc('light'), b.now());
    await runSync(server.io(b), [adapter(b.db)]);
    clock.t += 10_000;
    await runSync(server.io(a), [adapter(a.db)]);
    expect((await getItem(a.db, 'pref', 'theme'))?.json).toBe(doc('light'));

    clock.t += 10_000;
    await putLocalItem(a.db, 'pref', 'theme', null, a.now());
    await runSync(server.io(a), [adapter(a.db)]);
    clock.t += 10_000;
    await runSync(server.io(b), [adapter(b.db)]);
    expect((await getItem(b.db, 'pref', 'theme'))?.deletedAt).not.toBeNull();
  });

  it('an edit made while a push was in flight stays dirty', async () => {
    const a = await phone();
    await putLocalItem(a.db, 'pref', 'k', doc(1), T0);
    const sent = await listDirtyItems(a.db, 'pref', 10);
    await putLocalItem(a.db, 'pref', 'k', doc(2), T0 + 5);
    await markItemsPushed(a.db, sent, (r) => ({ updatedAt: r.updatedAt, deletedAt: null }));
    expect((await getItem(a.db, 'pref', 'k'))?.dirty).toBe(true);
    expect((await getItem(a.db, 'pref', 'k'))?.json).toBe(doc(2));
  });

  it('a phone one hour behind still wins with its later edit; a locked account keeps records waiting', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone();
    const b = await phone(-3_600_000);
    clock.t = T0 + 100_000;
    await putLocalItem(a.db, 'pref', 'k', doc('a'), a.now());
    clock.t += 10_000;
    await putLocalItem(b.db, 'pref', 'k', doc('b'), b.now());
    clock.t += 1000;
    await runSync(server.io(a), [adapter(a.db)]);
    clock.t += 1000;
    await runSync(server.io(b), [adapter(b.db)]);
    clock.t += 1000;
    await runSync(server.io(a), [adapter(a.db)]);
    expect((await getItem(a.db, 'pref', 'k'))?.json).toBe(doc('b'));

    server.pro = false;
    await putLocalItem(a.db, 'pref', 'later', doc(1), a.now());
    const report = await runSync(server.io(a), [adapter(a.db)]);
    expect(report.locked).toBe(true);
    expect((await getItem(a.db, 'pref', 'later'))?.dirty).toBe(true);
  });

  it('clearSyncItems forgets everything', async () => {
    const a = await phone();
    await putLocalItem(a.db, 'pref', 'k', doc(1), T0);
    await clearSyncItems(a.db);
    expect(await getItem(a.db, 'pref', 'k')).toBeNull();
  });
});

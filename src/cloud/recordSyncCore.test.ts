import { describe, expect, test } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  RECORDS_CURSOR_KEY,
  RECORDS_CURSOR_USER_KEY,
  countDirtyRecords,
  forgetRecords,
  runRecordSync,
  type RecordCall,
  type RecordSyncDeps,
} from '@/cloud/recordSyncCore';
import { pauseSync, resumeSync } from '@/cloud/syncGate';
import type { PullAnswer, PushAnswer, RecordAdapter, WireRecord } from '@/cloud/syncEngine';
import { applyRemoteItem, ensureSyncItemSchema, getItem, listDirtyItems, markItemsPushed, putLocalItem } from '@/cloud/syncItems';
import { FakeSyncServer, openMemoryDb } from '@/cloud/syncTestKit';
import { getCloudValue, setCloudState } from '@/db/cloud';

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);
const clock = { t: T0 };

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const adapter = (db: SQLiteDatabase): RecordAdapter => ({
  kind: 'pref',
  listDirty: (limit) => listDirtyItems(db, 'pref', limit),
  markPushed: (sent, serverTimes) => markItemsPushed(db, sent, serverTimes),
  applyRemote: (remote, skew) => applyRemoteItem(db, remote, skew),
});

interface Calls {
  paths: string[];
  /** `since` of each pull. */
  since: number[];
  bodies: unknown[];
}

interface RequestBody {
  since: number;
  clientNow: number;
  records: WireRecord[];
}

function callTo(server: FakeSyncServer, calls: Calls = { paths: [], since: [], bodies: [] }): { call: RecordCall; calls: Calls } {
  const call = async <T>(path: string, input: unknown): Promise<T> => {
    calls.paths.push(path);
    calls.bodies.push(input);
    // The bodies `runRecordSync` builds; the fake server has no schema to parse them with.
    const body = input as RequestBody;
    if (path === 'sync/pull') {
      calls.since.push(body.since);
      return server.pull(body.since) satisfies PullAnswer as T;
    }
    return server.push(body.clientNow, body.records) satisfies PushAnswer as T;
  };
  return { call, calls };
}

async function phone(userId: string | null = 'user-1') {
  const { db } = openMemoryDb();
  await ensureSyncItemSchema(db);
  if (userId) await setCloudState(db, { user_id: userId });
  return db;
}

function deps(db: SQLiteDatabase, call: RecordCall, extra: Partial<RecordSyncDeps> = {}): RecordSyncDeps {
  return {
    call,
    isQuiet: (error) => error instanceof HttpError && error.status === 404,
    adapters: () => [adapter(db)],
    stamp: async () => {},
    now: () => clock.t,
    ...extra,
  };
}

describe('runRecordSync', () => {
  test('two phones of one account follow each other, and the pull position is kept per account', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone();
    const b = await phone();
    await putLocalItem(a, 'pref', 'theme', '{"value":"dark"}', clock.t);

    const first = await runRecordSync(a, deps(a, callTo(server).call));
    expect(first).toMatchObject({ pushed: 1, locked: false });
    clock.t += 10_000;
    const second = await runRecordSync(b, deps(b, callTo(server).call));
    expect(second).toMatchObject({ applied: 1 });
    expect((await getItem(b, 'pref', 'theme'))?.json).toBe('{"value":"dark"}');

    expect(await getCloudValue(b, RECORDS_CURSOR_USER_KEY)).toBe('user-1');
    const cursor = Number(await getCloudValue(b, RECORDS_CURSOR_KEY));
    expect(cursor).toBeGreaterThan(0);

    const calls = callTo(server);
    await runRecordSync(b, deps(b, calls.call));
    expect(calls.calls.since[0]).toBe(cursor - 10_000);

    // Another account on the same phone starts from the beginning.
    await setCloudState(b, { user_id: 'user-2' });
    const other = callTo(server);
    await runRecordSync(b, deps(b, other.call));
    expect(other.calls.since[0]).toBe(0);
    expect(await getCloudValue(b, RECORDS_CURSOR_USER_KEY)).toBe('user-2');
  });

  test('pushes exactly the fields the server takes', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone();
    await putLocalItem(a, 'pref', 'k', '{"value":1}', clock.t);
    const { call, calls } = callTo(server);
    await runRecordSync(a, deps(a, call));
    const pushIndex = calls.paths.indexOf('sync/push');
    expect(calls.bodies[pushIndex]).toEqual({
      ns: 'fit',
      clientNow: clock.t,
      records: [{ kind: 'pref', id: 'k', json: '{"value":1}', updatedAt: clock.t, deletedAt: null, rank: 0 }],
    });
    expect(calls.bodies[calls.paths.indexOf('sync/pull')]).toEqual({ ns: 'fit', since: 0 });
  });

  test('a free account is locked: the pull ran, the record keeps waiting', async () => {
    const server = new FakeSyncServer(() => clock.t, false);
    const a = await phone();
    await putLocalItem(a, 'pref', 'k', '{"value":1}', clock.t);
    const report = await runRecordSync(a, deps(a, callTo(server).call));
    expect(report).toMatchObject({ locked: true, pushed: 0 });
    expect((await getItem(a, 'pref', 'k'))?.dirty).toBe(true);
    expect(await countDirtyRecords(a, [])).toBe(1);
  });

  test('is local-only when nobody is bound, the sync is paused, or the server has no endpoint', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const unbound = await phone(null);
    const never = callTo(server);
    expect(await runRecordSync(unbound, deps(unbound, never.call))).toBe('local-only');
    expect(never.calls.paths).toEqual([]);

    const a = await phone();
    pauseSync();
    try {
      expect(await runRecordSync(a, deps(a, never.call))).toBe('local-only');
    } finally {
      resumeSync();
    }
    expect(never.calls.paths).toEqual([]);

    const missing: RecordCall = async () => {
      throw new HttpError(404);
    };
    expect(await runRecordSync(a, deps(a, missing))).toBe('local-only');
  });

  test('another failure is thrown, and a failed stamp does not stop the sync', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone();
    const down: RecordCall = async () => {
      throw new HttpError(503);
    };
    await expect(runRecordSync(a, deps(a, down))).rejects.toThrow('HTTP 503');

    const report = await runRecordSync(
      a,
      deps(a, callTo(server).call, {
        stamp: async () => {
          throw new Error('native module gone');
        },
      }),
    );
    expect(report).not.toBe('local-only');
  });

  test('overlapping calls share one run', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone();
    const { call, calls } = callTo(server);
    const [one, two] = await Promise.all([runRecordSync(a, deps(a, call)), runRecordSync(a, deps(a, call))]);
    expect(one).toBe(two);
    expect(calls.paths.filter((path) => path === 'sync/pull')).toHaveLength(1);
  });

  test('stamping runs before the pull, so an unreported edit is dated before the pulled version replaces it', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone();
    const order: string[] = [];
    const { call } = callTo(server);
    await runRecordSync(
      a,
      deps(a, async (path, input) => {
        order.push(path);
        return call(path, input);
      }, { stamp: async () => void order.push('stamp') }),
    );
    expect(order[0]).toBe('stamp');
    expect(order[1]).toBe('sync/pull');
  });
});

describe('forgetting and counting', () => {
  test('forgetRecords clears every record and the pull position, and not the account', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await phone();
    await putLocalItem(a, 'pref', 'k', '{"value":1}', clock.t);
    await runRecordSync(a, deps(a, callTo(server).call));
    expect(await getCloudValue(a, RECORDS_CURSOR_KEY)).not.toBeNull();
    await forgetRecords(a);
    expect(await getItem(a, 'pref', 'k')).toBeNull();
    expect(await getCloudValue(a, RECORDS_CURSOR_KEY)).toBeNull();
    expect(await getCloudValue(a, RECORDS_CURSOR_USER_KEY)).toBeNull();
    expect(await getCloudValue(a, 'user_id')).toBe('user-1');
  });

  test('counts dirty records of every kind but the excluded ones', async () => {
    const a = await phone();
    await putLocalItem(a, 'pref', 'k', '{"value":1}', clock.t);
    await putLocalItem(a, 'route', 'r', '{"v":1}', clock.t);
    await putLocalItem(a, 'hrv', 'h', '{"x":1}', clock.t);
    await putLocalItem(a, 'metric', 'm', '{"x":1}', clock.t);
    expect(await countDirtyRecords(a, ['hrv', 'metric'])).toBe(2);
    expect(await countDirtyRecords(a, [])).toBe(4);
  });
});

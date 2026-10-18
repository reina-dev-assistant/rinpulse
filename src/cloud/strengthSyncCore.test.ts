import { describe, expect, it } from 'bun:test';

import type { DirtyRecord } from '@/features/strength/store';
import type { StrengthKind } from '@/features/strength/types';

import {
  BATCH_BYTES,
  BATCH_RECORDS,
  META,
  deriveCloudState,
  runStrengthSync,
  sinceFor,
  takeBatch,
  type PullPage,
  type PushAnswer,
  type RemoteRecord,
  type StrengthSyncIo,
} from './strengthSyncCore';

interface Stored extends RemoteRecord {
  serverAt: number;
}

/** A JoyoRogo that behaves like `strength/pull` and `strength/push` (packages/api, strength-record-store.ts). */
class FakeServer {
  rows = new Map<string, Stored>();
  clock = 1000;
  pro = true;
  down: Error | null = null;
  pulls: number[] = [];
  pushes: number[] = [];
  /** Page size, small so paging is exercised. */
  page = 3;

  pull(since: number): PullPage {
    if (this.down) throw this.down;
    this.pulls.push(since);
    const rows = [...this.rows.values()].filter((r) => r.serverAt > since).sort((a, b) => a.serverAt - b.serverAt);
    const taken = rows.slice(0, this.page);
    return {
      records: taken.map(({ serverAt: _serverAt, ...record }) => record),
      cursor: taken.length > 0 ? taken[taken.length - 1]!.serverAt : since,
      hasMore: rows.length > taken.length,
    };
  }

  push(records: readonly DirtyRecord[]): PushAnswer {
    if (this.down) throw this.down;
    this.pushes.push(records.length);
    if (!this.pro) return { status: 'locked' };
    let stored = 0;
    let skipped = 0;
    for (const record of records) {
      const key = `${record.kind}:${record.id}`;
      const have = this.rows.get(key);
      if (have && record.updatedAt < have.updatedAt) {
        skipped += 1;
        continue;
      }
      this.clock += 1;
      this.rows.set(key, { ...record, serverAt: this.clock });
      stored += 1;
    }
    return { status: 'ok', stored, skipped, rejected: [] };
  }

  put(kind: StrengthKind, id: string, updatedAt: number, restSec: number | null = 90, deletedAt: number | null = null) {
    this.clock += 1;
    this.rows.set(`${kind}:${id}`, { kind, id, json: JSON.stringify({ id, restSec, updatedAt, deletedAt }), updatedAt, deletedAt, serverAt: this.clock });
  }
}

interface Local {
  record: RemoteRecord;
  dirty: boolean;
}

class FakePhone {
  records = new Map<string, Local>();
  meta = new Map<string, string>();
  account: string | null = 'user-a';
  afterApplied: string[] = [];
  accountChanges = 0;

  constructor(readonly server: FakeServer) {}

  save(kind: StrengthKind, id: string, updatedAt: number, restSec: number | null = 90, deletedAt: number | null = null) {
    this.records.set(`${kind}:${id}`, {
      record: { kind, id, json: JSON.stringify({ id, restSec, updatedAt, deletedAt }), updatedAt, deletedAt },
      dirty: true,
    });
  }

  rest(kind: StrengthKind, id: string): number | null {
    const local = this.records.get(`${kind}:${id}`);
    return local ? (JSON.parse(local.record.json) as { restSec: number | null }).restSec : null;
  }

  get dirtyCount() {
    return [...this.records.values()].filter((l) => l.dirty).length;
  }

  io(): StrengthSyncIo {
    return {
      accountId: async () => this.account,
      getMeta: async (key) => this.meta.get(key) ?? null,
      setMeta: async (key, value) => {
        if (value === null) this.meta.delete(key);
        else this.meta.set(key, value);
      },
      markAllDirty: async () => {
        for (const local of this.records.values()) local.dirty = true;
      },
      onAccountChanged: async () => {
        this.accountChanges += 1;
      },
      pull: async (since) => this.server.pull(since),
      // Same rule as store.applyRemote: newer replaces, equal only clears the flag, older is ignored.
      applyRemote: async (records) => {
        let applied = 0;
        const workouts = [];
        for (const record of records) {
          const key = `${record.kind}:${record.id}`;
          const local = this.records.get(key);
          if (local && local.record.updatedAt > record.updatedAt) continue;
          if (local && local.record.updatedAt === record.updatedAt) {
            local.dirty = false;
            continue;
          }
          this.records.set(key, { record, dirty: false });
          applied += 1;
          if (record.kind === 'workout') workouts.push(JSON.parse(record.json));
        }
        return { applied, workouts };
      },
      afterApply: async (workouts) => {
        this.afterApplied.push(...workouts.map((w) => (w as { id: string }).id));
      },
      listDirty: async (limit) =>
        [...this.records.values()]
          .filter((l) => l.dirty)
          .sort((a, b) => a.record.updatedAt - b.record.updatedAt)
          .slice(0, limit)
          .map((l) => ({ ...l.record })),
      push: async (records) => this.server.push(records),
      markUploaded: async (records) => {
        for (const r of records) {
          const local = this.records.get(`${r.kind}:${r.id}`);
          if (local && local.record.updatedAt === r.updatedAt) local.dirty = false;
        }
      },
    };
  }
}

const setup = () => {
  const server = new FakeServer();
  return { server, phone: new FakePhone(server) };
};

describe('takeBatch and sinceFor', () => {
  it('takes at most 100 records and stays under the byte budget, but never returns an empty batch', () => {
    const small = Array.from({ length: 150 }, (_, i) => ({ json: `{"i":${i}}` }));
    expect(takeBatch(small)).toHaveLength(BATCH_RECORDS);
    const fat = 'x'.repeat(BATCH_BYTES - 5);
    expect(takeBatch([{ json: fat }, { json: fat }])).toHaveLength(1);
    expect(takeBatch([{ json: 'x'.repeat(BATCH_BYTES + 10) }])).toHaveLength(1);
    expect(takeBatch([])).toEqual([]);
  });

  it('asks from one millisecond before the cursor', () => {
    expect(sinceFor(0)).toBe(0);
    expect(sinceFor(5000)).toBe(4999);
  });
});

describe('deriveCloudState', () => {
  it('names the state of the strength cloud line', () => {
    expect(deriveCloudState({ signedIn: false, locked: false, pending: 3 })).toBe('not-signed-in');
    expect(deriveCloudState({ signedIn: true, locked: true, pending: 3 })).toBe('local-only');
    expect(deriveCloudState({ signedIn: true, locked: false, pending: 3 })).toBe('pending');
    expect(deriveCloudState({ signedIn: true, locked: false, pending: 0 })).toBe('synced');
  });
});

describe('runStrengthSync', () => {
  it('does nothing when both sides are empty', async () => {
    const { phone } = setup();
    expect(await runStrengthSync(phone.io())).toBe('unchanged');
  });

  it('uploads what the phone has and keeps the cursor of what it pulled', async () => {
    const { server, phone } = setup();
    phone.save('pref', 'a', 10);
    phone.save('workout', 'w1', 20);
    expect(await runStrengthSync(phone.io())).toBe('uploaded');
    expect(server.rows.size).toBe(2);
    expect(phone.dirtyCount).toBe(0);
    expect(phone.meta.get(META.locked)).toBeUndefined();
  });

  it('downloads a new phone in pages, in order, and tells the workouts to the caller', async () => {
    const { server, phone } = setup();
    server.put('workout', 'w1', 1);
    for (let i = 0; i < 6; i++) server.put('pref', `p${i}`, 2 + i);
    expect(await runStrengthSync(phone.io())).toBe('downloaded');
    expect(phone.records.size).toBe(7);
    expect(phone.dirtyCount).toBe(0);
    expect(server.pulls).toEqual([0, 1003, 1006]);
    expect(phone.afterApplied).toEqual(['w1']);
    expect(phone.meta.get(META.cursor)).toBe(String(server.clock));
  });

  it('asks again from the cursor minus one millisecond and the repeated row changes nothing', async () => {
    const { server, phone } = setup();
    server.put('pref', 'a', 5);
    await runStrengthSync(phone.io());
    const cursor = Number(phone.meta.get(META.cursor));
    server.pulls.length = 0;
    expect(await runStrengthSync(phone.io())).toBe('unchanged');
    expect(server.pulls).toEqual([cursor - 1]);
    expect(Number(phone.meta.get(META.cursor))).toBe(cursor);
    // A row stored later is found by the same overlapping ask.
    server.put('pref', 'b', 6);
    expect(await runStrengthSync(phone.io())).toBe('downloaded');
    expect(phone.rest('pref', 'b')).toBe(90);
  });

  it('last write wins both ways: the newer side replaces the older', async () => {
    const { server, phone } = setup();
    server.put('pref', 'cloudNewer', 100, 120);
    server.put('pref', 'phoneNewer', 100, 60);
    phone.save('pref', 'cloudNewer', 50, 30);
    phone.save('pref', 'phoneNewer', 200, 45);
    expect(await runStrengthSync(phone.io())).toBe('both');
    expect(phone.rest('pref', 'cloudNewer')).toBe(120);
    expect(JSON.parse(server.rows.get('pref:phoneNewer')!.json).restSec).toBe(45);
    expect(server.rows.get('pref:phoneNewer')!.updatedAt).toBe(200);
    expect(phone.dirtyCount).toBe(0);
  });

  it('a delete on one phone reaches the other', async () => {
    const { server, phone } = setup();
    server.put('workout', 'w9', 100);
    await runStrengthSync(phone.io());
    const other = new FakePhone(server);
    await runStrengthSync(other.io());
    phone.save('workout', 'w9', 300, null, 300);
    await runStrengthSync(phone.io());
    await runStrengthSync(other.io());
    expect(other.records.get('workout:w9')!.record.deletedAt).toBe(300);
  });

  it('a record the phone changes again while uploading is not marked as uploaded and goes up in the same run', async () => {
    const { server, phone } = setup();
    phone.save('pref', 'a', 10);
    const io = phone.io();
    const push = io.push;
    let first = true;
    io.push = async (records) => {
      const answer = await push(records);
      if (first) phone.save('pref', 'a', 11, 70);
      first = false;
      return answer;
    };
    await runStrengthSync(io);
    expect(server.pushes).toEqual([1, 1]);
    expect(server.rows.get('pref:a')!.updatedAt).toBe(11);
    expect(phone.dirtyCount).toBe(0);
  });

  it('a free account keeps working on its own copy: locked, no error, still reads', async () => {
    const { server, phone } = setup();
    server.pro = false;
    server.put('pref', 'fromBefore', 5);
    phone.save('pref', 'mine', 10);
    expect(await runStrengthSync(phone.io())).toBe('downloaded');
    expect(phone.meta.get(META.locked)).toBe('1');
    expect(phone.dirtyCount).toBe(1);
    expect(server.rows.has('pref:mine')).toBe(false);
    expect(phone.rest('pref', 'fromBefore')).toBe(90);
    // Nothing new to read: local-only, and it tries once per sync, not in a loop.
    server.pushes.length = 0;
    expect(await runStrengthSync(phone.io())).toBe('local-only');
    expect(server.pushes).toEqual([1]);
    // Pro arrives: the waiting records go up and the flag clears.
    server.pro = true;
    expect(await runStrengthSync(phone.io())).toBe('uploaded');
    expect(phone.meta.get(META.locked)).toBeUndefined();
    expect(server.rows.has('pref:mine')).toBe(true);
  });

  it('another JoyoRogo account: everything is sent again and the pull starts over', async () => {
    const { server, phone } = setup();
    phone.save('pref', 'a', 10);
    await runStrengthSync(phone.io());
    expect(phone.meta.get(META.user)).toBe('user-a');
    expect(phone.dirtyCount).toBe(0);

    const second = new FakeServer();
    phone.account = 'user-b';
    const switched = new FakePhone(second);
    switched.records = phone.records;
    switched.meta = phone.meta;
    switched.account = 'user-b';
    expect(await runStrengthSync(switched.io())).toBe('uploaded');
    expect(second.rows.has('pref:a')).toBe(true);
    expect(switched.meta.get(META.user)).toBe('user-b');
    expect(switched.accountChanges).toBe(1);
    expect(second.pulls[0]).toBe(0);
    expect(server.rows.size).toBe(1);
  });

  it('the first sync of an account does not reset anything', async () => {
    const { phone } = setup();
    phone.save('pref', 'a', 10);
    await runStrengthSync(phone.io());
    expect(phone.accountChanges).toBe(0);
    expect(phone.meta.get(META.user)).toBe('user-a');
  });

  it('an unknown account (not bound yet) skips the account check', async () => {
    const { phone } = setup();
    phone.account = null;
    phone.save('pref', 'a', 10);
    expect(await runStrengthSync(phone.io())).toBe('uploaded');
    expect(phone.meta.has(META.user)).toBe(false);
  });

  it('sends more than 100 waiting records in several requests', async () => {
    const { server, phone } = setup();
    for (let i = 0; i < 250; i++) phone.save('pref', `p${i}`, 1 + i);
    expect(await runStrengthSync(phone.io())).toBe('uploaded');
    expect(server.pushes).toEqual([100, 100, 50]);
    expect(server.rows.size).toBe(250);
  });

  it('a server error propagates and what was applied stays', async () => {
    const { server, phone } = setup();
    server.put('pref', 'a', 5);
    phone.save('pref', 'mine', 10);
    const io = phone.io();
    io.push = async () => {
      throw new Error('boom');
    };
    await expect(runStrengthSync(io)).rejects.toThrow('boom');
    expect(phone.rest('pref', 'a')).toBe(90);
    expect(phone.dirtyCount).toBe(1);
  });

  it('a missing endpoint (404 from the injected io) propagates for the caller to turn into local-only', async () => {
    const { server, phone } = setup();
    server.down = Object.assign(new Error('not found'), { status: 404 });
    await expect(runStrengthSync(phone.io())).rejects.toMatchObject({ status: 404 });
    expect(phone.meta.size).toBe(1);
  });

  it('records that never fit (rejected as invalid) are not retried, a full account keeps them waiting', async () => {
    const { phone } = setup();
    phone.save('pref', 'bad', 10);
    phone.save('pref', 'full', 11);
    const io = phone.io();
    io.push = async (records) => ({
      status: 'ok',
      stored: records.length - 2,
      skipped: 0,
      rejected: [
        { kind: 'pref', id: 'bad', reason: 'shape' },
        { kind: 'pref', id: 'full', reason: 'full' },
      ],
    });
    await runStrengthSync(io);
    expect(phone.records.get('pref:bad')!.dirty).toBe(false);
    expect(phone.records.get('pref:full')!.dirty).toBe(true);
    expect(phone.meta.get(META.full)).toBe('1');
    expect(phone.meta.get(META.rejected)).toBe('1');
  });
});

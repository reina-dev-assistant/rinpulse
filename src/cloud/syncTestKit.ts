import { Database } from 'bun:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import migrations from '../../modules/huawei-wear/schema/joyofit-db-migrations.json';
import type { PullAnswer, PushAnswer, SyncIo, WireRecord } from '@/cloud/syncEngine';

/** Test helpers only (bun test): the real local schema in memory, and a server that follows the JoyoRogo rules. */

/** The real schema in memory, behind the slice of expo-sqlite the sync code uses. */
export function openMemoryDb() {
  const raw = new Database(':memory:');
  for (const statements of migrations) raw.exec(statements.join(';\n'));
  const flat = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? params[0] : params) as never[];
  const txn = {
    getAllAsync: async (sql: string, ...params: unknown[]) => raw.query(sql).all(...flat(params)),
    getFirstAsync: async (sql: string, ...params: unknown[]) => raw.query(sql).get(...flat(params)),
    runAsync: async (sql: string, ...params: unknown[]) => {
      const r = raw.query(sql).run(...flat(params));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes };
    },
    execAsync: async (sql: string) => raw.exec(sql),
  };
  const db = {
    ...txn,
    withTransactionAsync: async (task: () => Promise<void>) => task(),
    withExclusiveTransactionAsync: async (task: (t: typeof txn) => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await task(txn);
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as SQLiteDatabase;
  return { raw, db };
}

interface Stored extends WireRecord {
  serverAt: number;
}

/**
 * JoyoRogo's `sync/pull` and `sync/push` in memory, with the same rules as `packages/api/src/lib/sync-record-store.ts`:
 * newest `updatedAt` (shifted by the pusher's skew, capped at the server clock) wins, a tombstone is ordered by time,
 * live rows by `rank` first, `server_at` strictly increases, and a free account is `locked`. The real server is exercised
 * by JoyoRogo's `routers/sync.test.ts`; this is the same contract for adapter tests.
 */
export class FakeSyncServer {
  readonly rows = new Map<string, Stored>();
  private serverAt = 0;
  constructor(
    public clock: () => number,
    public pro = true,
  ) {}

  io(phone: { now: () => number; cursor: number }): SyncIo {
    return {
      now: phone.now,
      pull: async (since) => this.pull(since),
      push: async (clientNow, records) => this.push(clientNow, records),
      getCursor: async () => phone.cursor,
      setCursor: async (cursor) => {
        phone.cursor = cursor;
      },
    };
  }

  pull(since: number): PullAnswer {
    const all = [...this.rows.values()].filter((r) => r.serverAt > since).sort((a, b) => a.serverAt - b.serverAt);
    const page = all.slice(0, 200);
    const last = page.at(-1);
    return {
      records: page.map(({ serverAt: _s, ...wire }) => wire),
      cursor: last?.serverAt ?? since,
      hasMore: all.length > page.length,
      now: this.clock(),
    };
  }

  push(clientNow: number, records: WireRecord[]): PushAnswer {
    if (!this.pro) return { status: 'locked' };
    const now = this.clock();
    const skew = now - clientNow;
    const shift = (v: number) => Math.min(now, Math.max(0, v + skew));
    let stored = 0;
    for (const record of records) {
      const next: Stored = {
        ...record,
        updatedAt: shift(record.updatedAt),
        deletedAt: record.deletedAt === null ? null : shift(record.deletedAt),
        serverAt: Math.max(now, this.serverAt + 1),
      };
      const key = `${record.kind}\u0000${record.id}`;
      const current = this.rows.get(key);
      const wins =
        !current ||
        (next.deletedAt !== null || current.deletedAt !== null
          ? next.updatedAt >= current.updatedAt
          : next.rank > current.rank || (next.rank === current.rank && next.updatedAt >= current.updatedAt));
      if (!wins) continue;
      this.serverAt = next.serverAt;
      this.rows.set(key, next);
      stored += 1;
    }
    return { status: 'ok', stored, skipped: records.length - stored, rejected: [], now };
  }
}

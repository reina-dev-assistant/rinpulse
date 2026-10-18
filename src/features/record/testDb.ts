// Test-only: the real schema (the migrations the app and the native side share) in memory, behind the slice of expo-sqlite the stores use.
import { Database } from 'bun:sqlite';

import migrations from '../../../modules/huawei-wear/schema/joyofit-db-migrations.json';
import type { RecordingDb } from './controller';

/** The real schema in memory behind the slice of expo-sqlite the stores use (same shim as the FIT import test). */
export function openDb() {
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
  };
  const all = <T>(sql: string, ...params: unknown[]) => raw.query(sql).all(...(params as never[])) as T[];
  return { raw, db: db as unknown as RecordingDb, all };
}


import type { SQLiteDatabase } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';

import { parseTried, type RefetchRow } from './refetchDynamics';
import { parseSummary } from './summary';

interface RawRow {
  start: number;
  sportName: string;
  summaryJson: string;
}

/**
 * The complete workouts the watch at `address` recorded that do not carry a per-minute running-form series yet (a SQL pre-filter; the
 * exact rule is `canRefetch`), newest first. Phone recordings and imports have another `device` or none.
 */
export async function listRefetchRows(db: SQLiteDatabase, address: string): Promise<RefetchRow[]> {
  const rows = await db.getAllAsync<RawRow>(
    `SELECT start, sport_name AS sportName, summary_json AS summaryJson
     FROM workouts
     WHERE device = ? AND imported = 0 AND complete = 1 AND summary_json NOT LIKE '%"dynamics":%'
     ORDER BY start DESC`,
    address,
  );
  return rows.map(({ summaryJson, ...row }) => ({ ...row, summary: parseSummary(summaryJson) }));
}

const TRIED_KEY = 'workouts.dynamicsRefetchSettled';

/** The workouts a refetch already found without running form or gone from the watch: asking again would give the same answer. */
export function readTried(): Set<number> {
  return parseTried(Storage.getItemSync(TRIED_KEY));
}

export function rememberTried(starts: readonly number[]): Set<number> {
  const tried = readTried();
  for (const start of starts) tried.add(start);
  Storage.setItemSync(TRIED_KEY, JSON.stringify([...tried]));
  return tried;
}

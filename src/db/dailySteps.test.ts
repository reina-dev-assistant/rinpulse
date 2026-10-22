import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import migrationsJson from '../../modules/huawei-wear/schema/joyofit-db-migrations.json';

import { listDailySteps, listStepSamplesBetween } from './queries';

function open() {
  const raw = new Database(':memory:');
  for (const statements of migrationsJson) raw.exec(statements.join(';\n'));
  const db = { getAllAsync: async (sql: string, ...params: unknown[]) => raw.query(sql).all(...(params.flat() as never[])) } as unknown as SQLiteDatabase;
  const put = (ts: number, steps: number) =>
    raw.query('INSERT INTO step_samples (timestamp, steps, calories, distance) VALUES (?, ?, 0, 0)').run(ts, steps);
  return { db, put };
}

const DAY = 86_400;
const D0 = 1_760_000_000 - (1_760_000_000 % DAY);

describe('listDailySteps', () => {
  it('sums the steps of each day between its bounds and leaves out days with no minute', () => {
    const { db, put } = open();
    put(D0 + 60, 10);
    put(D0 + 3600, 20);
    put(D0 + DAY - 60, 5);
    put(D0 + 2 * DAY + 60, 7);
    put(D0 + 5 * DAY, 99);
    return listDailySteps(db, [D0, D0 + DAY, D0 + 2 * DAY, D0 + 3 * DAY]).then((days) => {
      expect(days.get(D0)).toBe(35);
      expect(days.has(D0 + DAY)).toBe(false);
      expect(days.get(D0 + 2 * DAY)).toBe(7);
      expect(days.size).toBe(2);
    });
  });

  it('is empty without bounds', async () => {
    const { db } = open();
    expect((await listDailySteps(db, [])).size).toBe(0);
    expect((await listDailySteps(db, [D0])).size).toBe(0);
  });

  it('reads a year of days in one statement', async () => {
    const { db, put } = open();
    put(D0 + 60, 1);
    const bounds = Array.from({ length: 367 }, (_, i) => D0 + i * DAY);
    const days = await listDailySteps(db, bounds);
    expect(days.get(D0)).toBe(1);
  });
});

describe('listStepSamplesBetween', () => {
  it('returns only the minutes inside the range, oldest first', async () => {
    const { db, put } = open();
    put(D0 + 100, 1);
    put(D0 + 50, 2);
    put(D0 + DAY, 3);
    const rows = await listStepSamplesBetween(db as never, D0, D0 + DAY);
    expect(rows.map((r) => r.steps)).toEqual([2, 1]);
  });
});

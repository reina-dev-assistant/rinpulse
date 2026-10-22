import { describe, expect, it } from 'bun:test';

import { openMemoryDb } from '@/cloud/syncTestKit';

import { listDayTotals } from './queries';

const DAY = 86400;
const D0 = 1_792_000_000 - (1_792_000_000 % DAY);

describe('listDayTotals', () => {
  it('sums steps and the watch own energy per day; imported minutes add steps but no energy; days without samples are absent', async () => {
    const { raw, db } = openMemoryDb();
    const add = raw.query('INSERT INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (?, ?, ?, 0, ?)');
    add.run(D0 + 100, 50, 2000, 0);
    add.run(D0 + 160, 25, 1500, 0);
    add.run(D0 + 220, 10, 9000, 1);
    add.run(D0 + 2 * DAY + 5, 7, 0, 0);
    const totals = await listDayTotals(db, [D0, D0 + DAY, D0 + 2 * DAY, D0 + 3 * DAY]);
    expect(totals.get(D0)).toEqual({ steps: 85, calories: 3500 });
    expect(totals.has(D0 + DAY)).toBe(false);
    expect(totals.get(D0 + 2 * DAY)).toEqual({ steps: 7, calories: 0 });
  });

  it('an empty range is an empty map', async () => {
    const { db } = openMemoryDb();
    expect((await listDayTotals(db, [D0])).size).toBe(0);
  });
});

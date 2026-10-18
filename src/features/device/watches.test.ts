import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import migrationsJson from '../../../modules/huawei-wear/schema/joyofit-db-migrations.json';
import {
  getWorkoutDevice,
  listWatches,
  normalizeAlias,
  removeWatchRow,
  renameWatch,
  setBackgroundSync,
  setPrimaryWatch,
  setTracksHealth,
  sourceName,
  watchLabel,
  MAX_ALIAS_LENGTH,
} from './watches';

/** The slice of expo-sqlite the list uses, over bun:sqlite with the app's real schema. */
function open() {
  const raw = new Database(':memory:');
  for (const statements of migrationsJson) raw.exec(statements.join(';\n'));
  const db = {
    runAsync: async (sql: string, ...params: unknown[]) => raw.query(sql).run(...(params as never[])),
    getAllAsync: async (sql: string, ...params: unknown[]) => raw.query(sql).all(...(params as never[])),
    getFirstAsync: async (sql: string, ...params: unknown[]) => raw.query(sql).get(...(params as never[])),
    withTransactionAsync: async (task: () => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as SQLiteDatabase;
  return { raw, db };
}

/** What the native `upsertDevice` does for a watch that connects (docs/multi-watch.md, rule 1). */
function connectWatch(raw: Database, address: string, name: string, addedAt: number, lastSync: number | null = null) {
  raw
    .query(
      `INSERT INTO device (address, name, last_sync, is_primary, added_at)
       VALUES (?, ?, ?, CASE WHEN EXISTS (SELECT 1 FROM device WHERE is_primary = 1) THEN 0 ELSE 1 END, ?)
       ON CONFLICT(address) DO UPDATE SET name = excluded.name`,
    )
    .run(address, name, lastSync, addedAt);
}

describe('listWatches', () => {
  it('lists the primary first, then the watches in the order they were added', async () => {
    const { raw, db } = open();
    connectWatch(raw, 'AA', 'Huawei Watch Fit 4', 100);
    connectWatch(raw, 'BB', 'Huawei Watch GT 5', 200);
    connectWatch(raw, 'CC', 'Huawei Band 9', 300);
    expect((await listWatches(db)).map((w) => [w.address, w.isPrimary])).toEqual([
      ['AA', true],
      ['BB', false],
      ['CC', false],
    ]);
    await setPrimaryWatch(db, 'CC');
    expect((await listWatches(db)).map((w) => [w.address, w.isPrimary])).toEqual([
      ['CC', true],
      ['AA', false],
      ['BB', false],
    ]);
  });

  it('defaults of a watch that just connected: no alias, stores health data, no background visits', async () => {
    const { raw, db } = open();
    connectWatch(raw, 'AA', 'Huawei Watch Fit 4', 100, 1700000000);
    expect(await listWatches(db)).toEqual([
      { address: 'AA', name: 'Huawei Watch Fit 4', alias: null, productModel: null, lastSync: 1700000000, isPrimary: true, tracksHealth: true, bgSync: false },
    ]);
  });
});

describe('renaming', () => {
  it('keeps the alias across the native upsert on the next connect, and clearing it goes back to the reported name', async () => {
    const { raw, db } = open();
    connectWatch(raw, 'AA', 'Huawei Watch Fit 4', 100);
    await renameWatch(db, 'AA', '  Jam harian  ');
    connectWatch(raw, 'AA', 'Huawei Watch Fit 4', 999);
    let [watch] = await listWatches(db);
    expect(watch.alias).toBe('Jam harian');
    expect(watchLabel(watch)).toBe('Jam harian');
    await renameWatch(db, 'AA', '   ');
    [watch] = await listWatches(db);
    expect(watch.alias).toBeNull();
    expect(watchLabel(watch)).toBe('Huawei Watch Fit 4');
  });

  it('cuts a long name', () => {
    expect(normalizeAlias('x'.repeat(100))).toHaveLength(MAX_ALIAS_LENGTH);
    expect(normalizeAlias('')).toBeNull();
  });

  it('falls back to the address for a watch that reports no name', () => {
    expect(watchLabel({ alias: null, name: ' ', address: 'AA:BB' })).toBe('AA:BB');
  });
});

describe('primary', () => {
  it('there is never more than one, an unknown watch changes nothing, and a second first connect does not take it', async () => {
    const { raw, db } = open();
    connectWatch(raw, 'AA', 'Fit', 100);
    connectWatch(raw, 'BB', 'GT', 200);
    await setPrimaryWatch(db, 'ZZ');
    expect((await listWatches(db)).filter((w) => w.isPrimary).map((w) => w.address)).toEqual(['AA']);
    await setPrimaryWatch(db, 'BB');
    expect((await listWatches(db)).filter((w) => w.isPrimary).map((w) => w.address)).toEqual(['BB']);
    connectWatch(raw, 'AA', 'Fit', 100);
    expect((await listWatches(db)).filter((w) => w.isPrimary).map((w) => w.address)).toEqual(['BB']);
  });
});

describe('flags', () => {
  it('stores the background-visit and health-data switches per watch', async () => {
    const { raw, db } = open();
    connectWatch(raw, 'AA', 'Fit', 100);
    connectWatch(raw, 'BB', 'Band', 200);
    await setBackgroundSync(db, 'BB', true);
    await setTracksHealth(db, 'BB', false);
    const byAddress = Object.fromEntries((await listWatches(db)).map((w) => [w.address, w]));
    expect([byAddress.AA.bgSync, byAddress.AA.tracksHealth]).toEqual([false, true]);
    expect([byAddress.BB.bgSync, byAddress.BB.tracksHealth]).toEqual([true, false]);
  });
});

describe('removing a watch', () => {
  it('keeps the data it recorded and the other watches untouched', async () => {
    const { raw, db } = open();
    connectWatch(raw, 'AA', 'Fit', 100, 5);
    connectWatch(raw, 'BB', 'GT', 200, 9);
    raw.exec("INSERT INTO step_samples (timestamp, steps, calories, distance, device) VALUES (1000, 5, 0, 0, 'BB')");
    await removeWatchRow(db, 'BB');
    expect((await listWatches(db)).map((w) => w.address)).toEqual(['AA']);
    expect(raw.query('SELECT device FROM step_samples').all()).toEqual([{ device: 'BB' }]);
  });

  it('hands the primary to the watch synced most recently, and to the first added when none ever synced', async () => {
    const { raw, db } = open();
    connectWatch(raw, 'AA', 'Fit', 100, 5);
    connectWatch(raw, 'BB', 'GT', 200, 9);
    connectWatch(raw, 'CC', 'Band', 300, 7);
    await removeWatchRow(db, 'AA');
    expect((await listWatches(db)).map((w) => [w.address, w.isPrimary])).toEqual([
      ['BB', true],
      ['CC', false],
    ]);

    const second = open();
    connectWatch(second.raw, 'AA', 'Fit', 100);
    connectWatch(second.raw, 'BB', 'GT', 200);
    connectWatch(second.raw, 'CC', 'Band', 300);
    await removeWatchRow(second.db, 'AA');
    expect((await listWatches(second.db)).find((w) => w.isPrimary)?.address).toBe('BB');
  });

  it('removing the last watch leaves an empty list, and pairing it again makes it primary again', async () => {
    const { raw, db } = open();
    connectWatch(raw, 'AA', 'Fit', 100);
    await removeWatchRow(db, 'AA');
    expect(await listWatches(db)).toEqual([]);
    connectWatch(raw, 'AA', 'Fit', 500);
    expect((await listWatches(db))[0].isPrimary).toBe(true);
  });

  it('removing a non-primary watch does not change the primary', async () => {
    const { raw, db } = open();
    connectWatch(raw, 'AA', 'Fit', 100);
    connectWatch(raw, 'BB', 'GT', 200);
    await removeWatchRow(db, 'BB');
    expect((await listWatches(db)).map((w) => [w.address, w.isPrimary])).toEqual([['AA', true]]);
  });
});

describe('where a workout came from', () => {
  it('names the watch, says removed for a watch no longer listed, and nothing for an unattributed workout', async () => {
    const { raw, db } = open();
    connectWatch(raw, 'AA', 'Fit', 100);
    await renameWatch(db, 'AA', 'Jam harian');
    const insert = (start: number, device: string | null) =>
      raw.exec(
        `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, device)
         VALUES (1, ${start}, ${start + 60}, 1, 'Run', 60, 1, 1, 1, '{}', ${device === null ? 'NULL' : `'${device}'`})`,
      );
    insert(1000, 'AA');
    insert(2000, 'GONE');
    insert(3000, null);
    const watches = await listWatches(db);
    const ids = raw.query<{ id: number }, []>('SELECT id FROM workouts ORDER BY start').all().map((r) => r.id);
    const names = [];
    for (const id of ids) names.push(sourceName(watches, await getWorkoutDevice(db, id), 'removed'));
    expect(names).toEqual(['Jam harian', 'removed', null]);
    expect(await getWorkoutDevice(db, 999)).toBeNull();
  });
});

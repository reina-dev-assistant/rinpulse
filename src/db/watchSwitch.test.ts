import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import migrationsJson from '../../modules/huawei-wear/schema/joyofit-db-migrations.json';
import { removeWatchRow, setPrimaryWatch } from '@/features/device/watches';
import { migrate } from './migrations';

/**
 * One person's watch, then another person's band on the same phone (the borrowed Band 10): what pairing and syncing the band does to the
 * days the first watch stored, what switching back does, and how a day that an older build already lost is brought back from the watch.
 *
 * Every statement is the one the native stores run (`WatchSql.kt`, `SyncStore.swift`), on the schema the app ships. The "watch" is its
 * own history (what it still holds), and `sync` is what `WearLink.syncActivity` does around `SyncStore.save`: the window starts at the
 * watch's own `last_sync` minus an hour, or at 0 for a first sync and for a backfill.
 */
const MINE = 'AA:AA:AA:AA:AA:01';
const BAND = 'BB:BB:BB:BB:BB:02';

const DAY = 86_400;
/** A minute-aligned instant that is a multiple of a day, so day boundaries need no time zone. */
const D0 = 20_000 * DAY;
const OVERLAP = 3_600;

interface Step {
  steps: number;
  hr?: number | null;
}
type History = Map<number, Step>;

const minute = (day: number, m: number) => D0 + day * DAY + m * 60;

let db: Database;

function open() {
  db = new Database(':memory:');
  for (const statements of migrationsJson) db.exec(statements.join(';\n'));
}

beforeEach(open);

/** `SyncStore.upsertDevice`. */
function connect(address: string, name: string) {
  db.query(
    `INSERT INTO device (address, name, product_model, software_version, last_sync, is_primary, added_at)
     VALUES (?, ?, NULL, NULL, NULL,
       CASE WHEN EXISTS (SELECT 1 FROM device WHERE is_primary = 1) THEN 0 ELSE 1 END,
       CAST(strftime('%s', 'now') AS INTEGER))
     ON CONFLICT(address) DO UPDATE SET name = excluded.name`,
  ).run(address, name);
}

/** `SyncStore.save`: the step upsert of one watch and its `last_sync`. */
function save(address: string, samples: [number, Step][], to: number) {
  const upsert = db.query(
    `INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate, device)
     VALUES (?, ?, 0, 0, ?, NULL, NULL, ?)
     ON CONFLICT(timestamp) DO UPDATE SET
       steps = excluded.steps, calories = excluded.calories, distance = excluded.distance,
       heart_rate = excluded.heart_rate, spo2 = excluded.spo2, resting_heart_rate = excluded.resting_heart_rate,
       device = excluded.device, imported = 0`,
  );
  for (const [timestamp, s] of samples) upsert.run(timestamp, s.steps, s.hr ?? null, address);
  db.query('UPDATE device SET last_sync = ? WHERE address = ?').run(to, address);
}

/** One activity sync of a connected watch whose stored history is [history]. */
function sync(address: string, history: History, now: number, backfill = false) {
  const last = db.query<{ last_sync: number | null }, [string]>('SELECT last_sync FROM device WHERE address = ?').get(address)?.last_sync ?? null;
  const from = backfill || last === null ? 0 : Math.max(0, last - OVERLAP);
  save(
    address,
    [...history].filter(([timestamp]) => timestamp >= from),
    now,
  );
}

const total = (day: number) =>
  db
    .query<{ s: number }, [number, number]>('SELECT COALESCE(SUM(steps), 0) AS s FROM step_samples WHERE timestamp >= ? AND timestamp < ?')
    .get(D0 + day * DAY, D0 + (day + 1) * DAY)!.s;

const rowsOf = (address: string) =>
  db.query('SELECT timestamp, steps, heart_rate, device FROM step_samples WHERE device = ? ORDER BY timestamp').all(address);

/** The owner's watch: 12 steps a minute from 08:00 to 18:00, a resting heart rate through the night, three days. */
function ownerHistory(days: number[]): History {
  const h: History = new Map();
  for (const day of days) {
    for (let m = 0; m < 480; m++) h.set(minute(day, m), { steps: 0, hr: 55 });
    for (let m = 480; m < 1080; m++) h.set(minute(day, m), { steps: 12, hr: 90 });
  }
  return h;
}

/**
 * The band in the drawer: a row for every minute with nothing in it (the watch sends them), and on day 1 an hour with the wife's
 * steps over minutes the owner's watch also has, and on day 2 half an hour in the evening the owner's watch has no row for.
 */
function bandHistory(): History {
  const h: History = new Map();
  for (const day of [0, 1, 2]) for (let m = 0; m < 1440; m++) h.set(minute(day, m), { steps: 0 });
  for (let m = 600; m < 660; m++) h.set(minute(1, m), { steps: 30, hr: 100 });
  for (let m = 1200; m < 1230; m++) h.set(minute(2, m), { steps: 20, hr: 95 });
  return h;
}

const DAY_TOTAL = 600 * 12;
const BAND_FILL_DAY2 = 30 * 20;

describe('pairing a second watch', () => {
  it('leaves every day the first watch stored as it was, and adds only what nothing else recorded', () => {
    connect(MINE, 'Huawei Watch Fit 4');
    const mine = ownerHistory([0, 1]);
    sync(MINE, mine, D0 + 2 * DAY + 3_600);
    expect([total(0), total(1)]).toEqual([DAY_TOTAL, DAY_TOTAL]);
    const before = rowsOf(MINE);

    connect(BAND, 'Huawei Band 10');
    expect(db.query<{ is_primary: number }, [string]>('SELECT is_primary FROM device WHERE address = ?').get(BAND)?.is_primary).toBe(0);
    sync(BAND, bandHistory(), D0 + 2 * DAY + 7_200);

    // Day 0 and 1: the band's empty minutes and the wife's steps over the owner's own minutes change nothing.
    expect([total(0), total(1)]).toEqual([DAY_TOTAL, DAY_TOTAL]);
    expect(rowsOf(MINE)).toEqual(before);
    // Day 2: the owner's watch has no row for the evening half hour, so the band fills it.
    expect(total(2)).toBe(BAND_FILL_DAY2);
  });

  it('an owner minute with only a resting heart rate in it is kept too', () => {
    connect(MINE, 'Huawei Watch Fit 4');
    sync(MINE, ownerHistory([0]), D0 + DAY + 3_600);
    connect(BAND, 'Huawei Band 10');
    sync(BAND, bandHistory(), D0 + DAY + 7_200);
    const night = db.query<{ steps: number; heart_rate: number; device: string }, [number]>('SELECT steps, heart_rate, device FROM step_samples WHERE timestamp = ?').get(minute(0, 100));
    expect(night).toEqual({ steps: 0, heart_rate: 55, device: MINE });
  });
});

describe('switching back to the first watch', () => {
  it('restores the totals of every day and goes on from there', () => {
    connect(MINE, 'Huawei Watch Fit 4');
    const mine = ownerHistory([0, 1]);
    sync(MINE, mine, D0 + 2 * DAY + 3_600);
    connect(BAND, 'Huawei Band 10');
    sync(BAND, bandHistory(), D0 + 2 * DAY + 7_200);
    // The owner's watch kept recording while the band was linked; the next sync (window: since its own last sync) brings it in.
    for (let m = 1200; m < 1260; m++) mine.set(minute(2, m), { steps: 25, hr: 110 });
    sync(MINE, mine, D0 + 2 * DAY + 10_800);

    expect([total(0), total(1)]).toEqual([DAY_TOTAL, DAY_TOTAL]);
    // The owner's watch is the primary: its hour takes the band's half hour (the same minutes) and the band does not come back over it.
    expect(total(2)).toBe(60 * 25);
  });

  it('a band that comes back after the owner watch has synced again changes nothing either', () => {
    connect(MINE, 'Huawei Watch Fit 4');
    const mine = ownerHistory([0, 1]);
    sync(MINE, mine, D0 + 2 * DAY + 3_600);
    connect(BAND, 'Huawei Band 10');
    sync(BAND, bandHistory(), D0 + 2 * DAY + 7_200);
    sync(MINE, mine, D0 + 2 * DAY + 10_800);
    const settled = [total(0), total(1), total(2)];
    sync(BAND, bandHistory(), D0 + 3 * DAY, true);
    expect([total(0), total(1), total(2)]).toEqual(settled);
  });
});

describe('a day an older build already lost', () => {
  /** The slice of expo-sqlite the watch list actions use. */
  const appDb = () =>
    ({
      runAsync: async (sql: string, ...params: unknown[]) => db.query(sql).run(...(params as never[])),
      getFirstAsync: async (sql: string, ...params: unknown[]) => db.query(sql).get(...(params as never[])),
      withTransactionAsync: async (task: () => Promise<void>) => {
        db.exec('BEGIN');
        await task();
        db.exec('COMMIT');
      },
    }) as unknown as SQLiteDatabase;

  /** A phone on migration 13 (no device column): the owner's watch synced, then the band's first sync wrote over the same minutes. */
  async function damagedPhone() {
    db = new Database(':memory:');
    for (const statements of migrationsJson.slice(0, 13)) db.exec(statements.join(';\n'));
    db.exec('PRAGMA user_version = 13');
    const oldSave = (history: History, to: number, address: string) => {
      const upsert = db.query(
        `INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate)
         VALUES (?, ?, 0, 0, ?, NULL, NULL)
         ON CONFLICT(timestamp) DO UPDATE SET steps = excluded.steps, calories = excluded.calories, distance = excluded.distance,
           heart_rate = excluded.heart_rate, spo2 = excluded.spo2, resting_heart_rate = excluded.resting_heart_rate, imported = 0`,
      );
      for (const [timestamp, s] of history) upsert.run(timestamp, s.steps, s.hr ?? null);
      db.query('UPDATE device SET last_sync = ? WHERE address = ?').run(to, address);
    };
    db.exec(`INSERT INTO device (address, name, last_sync) VALUES ('${MINE}', 'Huawei Watch Fit 4', NULL), ('${BAND}', 'Huawei Band 10', NULL)`);
    oldSave(ownerHistory([0, 1, 2]), D0 + 3 * DAY, MINE);
    const owner = [total(0), total(1), total(2)];
    // The band, linked for the first time, pulls everything it holds: its empty minutes replace the owner's.
    const band: History = new Map();
    for (const day of [0, 1, 2]) for (let m = 0; m < 1440; m++) band.set(minute(day, m), { steps: 0 });
    oldSave(band, D0 + 3 * DAY + 600, BAND);
    const wrapped = {
      execAsync: async (sql: string) => void db.exec(sql),
      getFirstAsync: async (sql: string) => db.query(sql).get(),
    } as unknown as SQLiteDatabase;
    await migrate(wrapped);
    return { owner };
  }

  it('is zero after the band wrote over it, and an ordinary sync of the owner watch does not bring it back', async () => {
    const { owner } = await damagedPhone();
    expect(owner).toEqual([DAY_TOTAL, DAY_TOTAL, DAY_TOTAL]);
    expect([total(0), total(1), total(2)]).toEqual([0, 0, 0]);

    // The owner reconnects: its own last_sync is long past those days, so the window only reaches the last hour.
    sync(MINE, ownerHistory([0, 1, 2]), D0 + 3 * DAY + 3_600);
    expect([total(0), total(1)]).toEqual([0, 0]);
  });

  it('comes back from the watch when its connect backfills, whatever last_sync says, and then stays when the band syncs again', async () => {
    const { owner } = await damagedPhone();
    // The migration of a phone with two watches cannot tell who owns the old rows: the one synced last (the band) is primary.
    expect(db.query<{ address: string }, []>('SELECT address FROM device WHERE is_primary = 1').get()?.address).toBe(BAND);
    expect(db.query('SELECT COUNT(*) AS n FROM step_samples WHERE device IS NOT NULL').get()).toEqual({ n: 0 });

    sync(MINE, ownerHistory([0, 1, 2]), D0 + 3 * DAY + 3_600, true);
    expect([total(0), total(1), total(2)]).toEqual(owner);
    expect(rowsOf(MINE).length).toBe(3 * 1080);

    // The person makes the owner watch primary (Watch tab, Your watches); the band can no longer replace what was brought back.
    await setPrimaryWatch(appDb(), MINE);
    sync(BAND, bandHistory(), D0 + 4 * DAY, true);
    expect([total(0), total(1)]).toEqual([owner[0], owner[1]]);
  });

  it('a re-paired owner watch (removed, then connected again) has no last sync and pulls everything by itself', async () => {
    const { owner } = await damagedPhone();
    await removeWatchRow(appDb(), MINE);
    connect(MINE, 'Huawei Watch Fit 4');
    expect(db.query<{ last_sync: number | null }, [string]>('SELECT last_sync FROM device WHERE address = ?').get(MINE)?.last_sync).toBeNull();
    sync(MINE, ownerHistory([0, 1, 2]), D0 + 3 * DAY + 3_600);
    expect([total(0), total(1), total(2)]).toEqual(owner);
  });
});

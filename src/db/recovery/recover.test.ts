import { Database, type Statement } from 'bun:sqlite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import migrations from '../../../modules/huawei-wear/schema/joyofit-db-migrations.json';
import { isCorruptionError } from './corruption';
import {
  applyPendingSwap,
  COPY_WINDOW,
  integrityProblems,
  recoverDatabase,
  type RecoveryDb,
  type RecoveryEnv,
} from './recover';

/**
 * Real files, real damage: a database built from the shipped migrations is closed, one b-tree page is overwritten, and the
 * ladder runs on it. The one stand-in is `backup`: bun:sqlite has no online backup API, so it writes the source file over the
 * destination (after checking, as SQLite would, that the destination's header can be read). That the real backup replaces a
 * damaged database in place under an open connection was checked once against SQLite itself (Python's `Connection.backup`).
 */

// bun:sqlite types its bindings as a closed union; the values the repair binds (numbers, text) are in it.
const bind = (params: readonly unknown[]): never[] => [...params] as never[];

class Conn implements RecoveryDb {
  readonly raw: Database;
  constructor(readonly path: string) {
    this.raw = new Database(path, { create: true });
  }
  private run<T>(sql: string, how: (statement: Statement) => T): T {
    const statement = this.raw.prepare(sql);
    try {
      return how(statement);
    } finally {
      statement.finalize();
    }
  }
  async getAllAsync<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const bound = bind(params);
    return this.run(sql, (s) => s.all(...bound)).map((row) => row as T);
  }
  async getFirstAsync<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    const bound = bind(params);
    const row = this.run(sql, (s) => s.get(...bound));
    return row === null || row === undefined ? null : (row as T);
  }
  async runAsync(sql: string, params: readonly unknown[] = []): Promise<{ changes: number }> {
    const bound = bind(params);
    const result = this.run(sql, (s) => s.run(...bound));
    return { changes: result.changes };
  }
  async execAsync(sql: string): Promise<void> {
    this.raw.exec(sql);
  }
  async closeAsync(): Promise<void> {
    this.raw.close();
  }
}

const SCHEMA_VERSION = migrations.length;

async function buildSchema(db: RecoveryDb): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL');
  for (const [i, statements] of migrations.entries()) {
    await db.execAsync(statements.join(';\n'));
    await db.execAsync(`PRAGMA user_version = ${i + 1}`);
  }
  // A table the app creates from JS, outside the shared migrations.
  await db.execAsync('CREATE TABLE IF NOT EXISTS gear_item (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL)');
}

let dir: string;
let clock: number;
const at = (name: string) => join(dir, name);

function makeEnv(overrides: Partial<RecoveryEnv> = {}): RecoveryEnv {
  return {
    open: async (name) => {
      const conn = new Conn(at(name));
      conn.raw.exec('PRAGMA busy_timeout = 1000');
      return conn;
    },
    backup: async (from, to) => {
      if (!(from instanceof Conn) || !(to instanceof Conn)) throw new Error('the test shim only backs up its own connections');
      await to.getFirstAsync('PRAGMA schema_version');
      from.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const bytes = readFileSync(from.path);
      to.raw.close();
      for (const suffix of ['-wal', '-shm']) rmSync(`${to.path}${suffix}`, { force: true });
      writeFileSync(to.path, bytes);
    },
    pathOf: at,
    files: {
      exists: async (name) => existsSync(at(name)),
      copy: async (from, to) => copyFileSync(at(from), at(to)),
      move: async (from, to) => renameSync(at(from), at(to)),
      remove: async (name) => rmSync(at(name), { force: true }),
    },
    now: () => clock++,
    buildSchema,
    ...overrides,
  };
}

const STEP_ROWS = 3000;
const POINT_ROWS = 40_000;
const WORKOUTS = 20;

/** A phone's database: a paired watch, minutes of steps (sparse keys, like unix seconds), workouts with their points. */
async function buildFixture(path: string): Promise<void> {
  const db = new Conn(path);
  await buildSchema(db);
  db.raw.exec(`INSERT INTO device (address, name, last_sync, is_primary) VALUES ('AA:BB', 'Watch GT', 1700000000, 1)`);
  db.raw.exec('BEGIN');
  for (let i = 0; i < STEP_ROWS; i++) {
    db.raw.exec(`INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate, device) VALUES (${1_700_000_000 + i * 60}, ${i}, 1, 1, 60, 'AA:BB')`);
  }
  for (let w = 1; w <= WORKOUTS; w++) {
    db.raw.exec(
      `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, imported, device) VALUES (${w}, ${1_700_000_000 + w * 10_000}, ${1_700_000_000 + w * 10_000 + 3000}, 1, 'Run', 3000, 5000, 300, 0, '{}', 0, 'AA:BB')`,
    );
  }
  const insert = db.raw.prepare('INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr, speed, cadence, stride, power) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < POINT_ROWS; i++) insert.run((i % WORKOUTS) + 1, 1_700_000_000 + i, -6.2 + i / 1e6, 106.8 + i / 1e6, 10, 120 + (i % 40), 3.1, 85, 1.1, 200);
  insert.finalize();
  db.raw.exec(`INSERT INTO gear_item (id, name) VALUES ('g1', 'Road shoes')`);
  db.raw.exec(`INSERT INTO cloud_state (key, value) VALUES ('workout_pull_cursor', '{"after":9}')`);
  db.raw.exec('COMMIT');
  db.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.raw.close();
}

let templateDir: string;

/** Puts a copy of the fixture where the database lives. */
async function populate(name = 'joyofit.db'): Promise<void> {
  copyFileSync(join(templateDir, 'template.db'), at(name));
}

const pageSizeOf = (file: string): number => {
  const probe = new Database(file, { readonly: true });
  try {
    return probe.prepare<{ page_size: number }, []>('PRAGMA page_size').get()?.page_size ?? 4096;
  } finally {
    probe.close();
  }
};

const rootPageOf = (file: string, sql: string, ...params: string[]): number => {
  const probe = new Database(file, { readonly: true });
  try {
    const row = probe.prepare<{ rootpage: number }, string[]>(sql).get(...params);
    if (!row) throw new Error(`no root page for ${params.join(' ')}`);
    return row.rootpage;
  } finally {
    probe.close();
  }
};

/** The leaf pages under page `root` of a b-tree, in key order (interior pages, table 0x05 or index 0x02, list their children first). */
function leavesUnder(bytes: Buffer, pageSize: number, root: number): number[] {
  const base = (root - 1) * pageSize;
  if (bytes[base] !== 0x05 && bytes[base] !== 0x02) return [root];
  const cells = bytes.readUInt16BE(base + 3);
  const children: number[] = [];
  for (let i = 0; i < cells; i++) children.push(bytes.readUInt32BE(base + bytes.readUInt16BE(base + 12 + i * 2)));
  children.push(bytes.readUInt32BE(base + 8));
  return children.flatMap((child) => leavesUnder(bytes, pageSize, child));
}

const leafPagesOf = (file: string, root: number): number[] => leavesUnder(readFileSync(file), pageSizeOf(file), root);

/** The leaf pages of `table`. */
const leafPages = (file: string, table: string): number[] =>
  leafPagesOf(file, rootPageOf(file, 'SELECT rootpage FROM sqlite_master WHERE name = ?', table));

/** An invalid b-tree page type: SQLite reports "database disk image is malformed" for any read that reaches the page. */
function breakPage(file: string, page: number): void {
  const bytes = readFileSync(file);
  bytes[(page - 1) * pageSizeOf(file)] = 0x01;
  writeFileSync(file, bytes);
}

/** Changes one `ts` in a table row without touching the index that holds it: rows and index disagree, every page stays readable. */
function desyncIndex(file: string): void {
  const bytes = readFileSync(file);
  const size = pageSizeOf(file);
  const [leaf] = leafPages(file, 'workout_points');
  const page = bytes.subarray((leaf - 1) * size, leaf * size);
  const found = page.indexOf(Buffer.from([0x65, 0x53, 0xf1, 0x00])); // 1_700_000_000, the first point's ts, as the 4-byte integer the record stores
  expect(found).toBeGreaterThan(0);
  page[found + 3] = 0xff;
  writeFileSync(file, bytes);
}

const scalar = (name: string, sql: string): unknown => {
  const db = new Database(at(name), { readonly: true });
  try {
    return Object.values(db.prepare<Record<string, unknown>, []>(sql).get() ?? {})[0];
  } finally {
    db.close();
  }
};
const rowsOf = (name: string, sql: string): Record<string, unknown>[] => {
  const db = new Database(at(name), { readonly: true });
  try {
    return db.prepare<Record<string, unknown>, []>(sql).all();
  } finally {
    db.close();
  }
};
const count = (name: string, table: string): unknown => scalar(name, `SELECT COUNT(*) FROM ${table}`);
const files = () => readdirSync(dir).sort();

beforeAll(async () => {
  templateDir = mkdtempSync(join(tmpdir(), 'joyofit-recover-template-'));
  await buildFixture(join(templateDir, 'template.db'));
});
afterAll(() => rmSync(templateDir, { recursive: true, force: true }));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'joyofit-recover-'));
  clock = 1_700_000_000_000;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('isCorruptionError', () => {
  it('knows what SQLite and the native writer say', () => {
    expect(isCorruptionError(new Error("Call to function 'NativeStatement.finalizeAsync' has been rejected.\n→ Caused by: Error code : database disk image is malformed"))).toBe(true);
    expect(isCorruptionError(new Error('android.database.sqlite.SQLiteDatabaseCorruptException: database disk image is malformed (code 11 SQLITE_CORRUPT)'))).toBe(true);
    expect(isCorruptionError(new Error('file is not a database'))).toBe(true);
    expect(isCorruptionError(new Error('malformed database schema (workouts) - near "x"'))).toBe(true);
    expect(isCorruptionError('SQLITE_NOTADB')).toBe(true);
  });
  it('looks at the cause chain', () => {
    const inner = new Error('database disk image is malformed');
    expect(isCorruptionError(new Error('import failed', { cause: inner }))).toBe(true);
  });
  it('leaves other database errors alone', () => {
    expect(isCorruptionError(new Error('database is locked'))).toBe(false);
    expect(isCorruptionError(new Error('UNIQUE constraint failed: workouts.start'))).toBe(false);
    expect(isCorruptionError(new Error('no such table: gear_item'))).toBe(false);
    expect(isCorruptionError(undefined)).toBe(false);
    expect(isCorruptionError(null)).toBe(false);
  });
});

describe('recoverDatabase', () => {
  it('touches nothing when the file is fine', async () => {
    await populate();
    const before = files();
    const result = await recoverDatabase(makeEnv(), 'joyofit.db');
    expect(result).toEqual({ kind: 'healthy' });
    expect(files()).toEqual(before);
    expect(count('joyofit.db', 'workout_points')).toBe(POINT_ROWS);
  });

  it('salvages every other leaf when one leaf of a table is damaged, and keeps the damaged file', async () => {
    await populate();
    const pages = leafPages(at('joyofit.db'), 'workout_points');
    breakPage(at('joyofit.db'), pages[Math.floor(pages.length / 2)]);
    expect(await integrityProblems(await makeEnv().open('joyofit.db'))).not.toEqual([]);
    const original = readFileSync(at('joyofit.db'));
    const triggersBefore = rowsOf('joyofit.db', `SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`);
    expect(triggersBefore.length).toBeGreaterThan(0);

    const result = await recoverDatabase(makeEnv(), 'joyofit.db');

    expect(result.kind).toBe('repaired');
    if (result.kind !== 'repaired') return;
    expect(result.method).toBe('salvage');
    expect(result.lost).toBe(true);
    const points = result.tables.find((table) => table.table === 'workout_points');
    expect(points?.unreadable).toBeGreaterThan(0);
    // One leaf of about a hundred rows is gone; the rest (all of the other leaves) is there.
    const kept = count('joyofit.db', 'workout_points');
    expect(kept).toBe(points?.copied);
    expect(kept).toBeGreaterThan(POINT_ROWS - 400);
    expect(kept).toBeLessThan(POINT_ROWS);
    // The other tables are whole.
    expect(count('joyofit.db', 'step_samples')).toBe(STEP_ROWS);
    expect(count('joyofit.db', 'workouts')).toBe(WORKOUTS);
    expect(scalar('joyofit.db', `SELECT name FROM device`)).toBe('Watch GT');
    expect(scalar('joyofit.db', `SELECT name FROM gear_item`)).toBe('Road shoes');
    // A sound database, at the app's schema version, with its triggers back.
    expect(await integrityProblems(await makeEnv().open('joyofit.db'))).toEqual([]);
    expect(scalar('joyofit.db', 'PRAGMA user_version')).toBe(SCHEMA_VERSION);
    expect(rowsOf('joyofit.db', `SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`)).toEqual(triggersBefore);
    // The damaged file is kept byte for byte, and only that and the database are left.
    expect(result.keptAs).toBe('joyofit.db.corrupt-1700000000000');
    expect(readFileSync(at(result.keptAs)).equals(original)).toBe(true);
    expect(files().filter((file) => !file.startsWith('joyofit.db.corrupt-') && !file.startsWith('joyofit.db-'))).toEqual(['joyofit.db']);
  });

  it('copies the cloud bookkeeping the triggers keep as it was, not as the triggers would write it', async () => {
    await populate();
    const stepsBefore = new Database(at('joyofit.db'), { readonly: true }).prepare('SELECT timestamp, rev FROM step_samples ORDER BY timestamp').all();
    const cursorBefore = new Database(at('joyofit.db'), { readonly: true }).prepare('SELECT tbl, seq, uploaded FROM cloud_cursor ORDER BY tbl').all();
    breakPage(at('joyofit.db'), leafPages(at('joyofit.db'), 'workout_points')[3]);

    const result = await recoverDatabase(makeEnv(), 'joyofit.db');

    expect(result.kind).toBe('repaired');
    const read = new Database(at('joyofit.db'), { readonly: true });
    expect(read.prepare('SELECT timestamp, rev FROM step_samples ORDER BY timestamp').all()).toEqual(stepsBefore);
    expect(read.prepare('SELECT tbl, seq, uploaded FROM cloud_cursor ORDER BY tbl').all()).toEqual(cursorBefore);
    // AUTOINCREMENT ids are not handed out twice.
    expect(read.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'workouts'`).get()).toEqual({ seq: WORKOUTS });
    read.close();
  });

  it('skips a damaged stretch of sparse keys without scanning them (step samples are keyed by unix seconds)', async () => {
    await populate();
    const pages = leafPages(at('joyofit.db'), 'step_samples');
    breakPage(at('joyofit.db'), pages[1]);

    const result = await recoverDatabase(makeEnv(), 'joyofit.db');

    expect(result.kind).toBe('repaired');
    if (result.kind !== 'repaired') return;
    const steps = result.tables.find((table) => table.table === 'step_samples');
    expect(steps?.unreadable).toBe(1);
    expect(steps?.copied).toBe(count('joyofit.db', 'step_samples'));
    expect(steps?.copied).toBeGreaterThan(STEP_ROWS - 600);
    expect(steps?.copied).toBeLessThan(STEP_ROWS);
  });

  it('loses a whole table whose root page is damaged and keeps the rest', async () => {
    await populate();
    breakPage(at('joyofit.db'), rootPageOf(at('joyofit.db'), 'SELECT rootpage FROM sqlite_master WHERE name = ?', 'workout_points'));

    const result = await recoverDatabase(makeEnv(), 'joyofit.db');

    expect(result.kind).toBe('repaired');
    if (result.kind !== 'repaired') return;
    expect(result.method).toBe('salvage');
    expect(count('joyofit.db', 'workout_points')).toBe(0);
    expect(count('joyofit.db', 'step_samples')).toBe(STEP_ROWS);
    expect(count('joyofit.db', 'workouts')).toBe(WORKOUTS);
  });

  it('loses no row when an index page is damaged: the new database builds its indexes from the rows', async () => {
    await populate();
    const root = rootPageOf(at('joyofit.db'), `SELECT rootpage FROM sqlite_master WHERE type = 'index' AND tbl_name = ? LIMIT 1`, 'workout_points');
    const leaves = leafPagesOf(at('joyofit.db'), root);
    expect(leaves.length).toBeGreaterThan(2);
    breakPage(at('joyofit.db'), leaves[1]);

    const result = await recoverDatabase(makeEnv(), 'joyofit.db');

    expect(result.kind).toBe('repaired');
    if (result.kind !== 'repaired') return;
    // VACUUM INTO copies index b-trees as they are, so it cannot read this one either.
    expect(result.method).toBe('salvage');
    expect(result.lost).toBe(false);
    expect(count('joyofit.db', 'workout_points')).toBe(POINT_ROWS);
    expect(await integrityProblems(await makeEnv().open('joyofit.db'))).toEqual([]);
  });

  it('only reindexes when the rows and an index disagree and every page is readable', async () => {
    await populate();
    desyncIndex(at('joyofit.db'));
    const before = await integrityProblems(await makeEnv().open('joyofit.db'));
    expect(before.length).toBeGreaterThan(0);
    expect(before.join('\n')).toMatch(/index/);

    const result = await recoverDatabase(makeEnv(), 'joyofit.db');

    expect(result.kind).toBe('repaired');
    if (result.kind !== 'repaired') return;
    expect(result.method).toBe('reindex');
    expect(result.lost).toBe(false);
    expect(count('joyofit.db', 'workout_points')).toBe(POINT_ROWS);
    expect(await integrityProblems(await makeEnv().open('joyofit.db'))).toEqual([]);
    expect(files().filter((file) => file.includes('salvage') || file.includes('vacuum'))).toEqual([]);
  });

  it('runs afterLoss on the repaired database only when rows were lost', async () => {
    await populate();
    const seen: string[] = [];
    const env = makeEnv({
      afterLoss: async (db) => {
        seen.push(String((await db.getFirstAsync<{ value: string }>(`SELECT value FROM cloud_state WHERE key = 'workout_pull_cursor'`))?.value));
        await db.runAsync(`DELETE FROM cloud_state WHERE key = 'workout_pull_cursor'`);
      },
    });
    breakPage(at('joyofit.db'), leafPages(at('joyofit.db'), 'workout_points')[5]);

    await recoverDatabase(env, 'joyofit.db');

    expect(seen).toEqual(['{"after":9}']);
    expect(scalar('joyofit.db', `SELECT COUNT(*) FROM cloud_state WHERE key = 'workout_pull_cursor'`)).toBe(0);
  });

  it('recreates an empty database when the file is not a database any more, swapping the files when allowed', async () => {
    writeFileSync(at('joyofit.db'), Buffer.from('this is not a database '.repeat(500)));

    const result = await recoverDatabase(makeEnv(), 'joyofit.db', { canSwap: true });

    expect(result.kind).toBe('recreated');
    if (result.kind !== 'recreated') return;
    expect(readFileSync(at(result.keptAs)).toString().startsWith('this is not a database')).toBe(true);
    expect(scalar('joyofit.db', 'PRAGMA user_version')).toBe(SCHEMA_VERSION);
    expect(count('joyofit.db', 'workouts')).toBe(0);
    expect(await integrityProblems(await makeEnv().open('joyofit.db'))).toEqual([]);
    expect(files().filter((file) => file.includes('salvage') || file.includes('vacuum'))).toEqual([]);
  });

  it('prepares the new database and leaves the file alone when it may not swap, then applyPendingSwap finishes it', async () => {
    const garbage = Buffer.from('this is not a database '.repeat(500));
    writeFileSync(at('joyofit.db'), garbage);

    const result = await recoverDatabase(makeEnv(), 'joyofit.db');

    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') return;
    expect(result.swapPending).not.toBeNull();
    expect(result.keptAs).not.toBeNull();
    expect(readFileSync(at('joyofit.db')).equals(garbage)).toBe(true);
    expect(existsSync(at(result.swapPending!))).toBe(true);

    expect(await applyPendingSwap(makeEnv(), 'joyofit.db', result.swapPending!)).toBe(true);
    expect(scalar('joyofit.db', 'PRAGMA user_version')).toBe(SCHEMA_VERSION);
    expect(existsSync(at(result.swapPending!))).toBe(false);
    expect(readFileSync(at(result.keptAs!)).equals(garbage)).toBe(true);
    expect(await applyPendingSwap(makeEnv(), 'joyofit.db', result.swapPending!)).toBe(false);
  });

  it('never replaces the database when the damaged file cannot be kept', async () => {
    await populate();
    breakPage(at('joyofit.db'), leafPages(at('joyofit.db'), 'workout_points')[2]);
    const original = readFileSync(at('joyofit.db'));
    const env = makeEnv();
    env.files.copy = async () => {
      throw new Error('No space left on device');
    };

    const result = await recoverDatabase(env, 'joyofit.db');

    expect(result).toEqual({ kind: 'failed', keptAs: null, reason: 'could not keep a copy of the damaged file: No space left on device', swapPending: null });
    expect(readFileSync(at('joyofit.db')).equals(original)).toBe(true);
  });

  it('copies in windows of COPY_WINDOW rows and halves a window it cannot read', async () => {
    expect(COPY_WINDOW).toBeGreaterThan(1);
    await populate();
    // Two damaged leaves far apart: the rows between them are all copied.
    const pages = leafPages(at('joyofit.db'), 'workout_points');
    breakPage(at('joyofit.db'), pages[1]);
    breakPage(at('joyofit.db'), pages[pages.length - 2]);

    const result = await recoverDatabase(makeEnv(), 'joyofit.db');

    expect(result.kind).toBe('repaired');
    if (result.kind !== 'repaired') return;
    const points = result.tables.find((table) => table.table === 'workout_points');
    expect(points?.unreadable).toBe(2);
    expect(points?.copied).toBeGreaterThan(POINT_ROWS - 800);
  });
});

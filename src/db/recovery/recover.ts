import { isCorruptionError } from './corruption';

/**
 * Repair of a damaged `joyofit.db` without losing what can still be read. Written against a small environment
 * (`RecoveryEnv`) so the whole ladder runs under `bun test` on real damaged files; `env.ts` wires it to expo-sqlite.
 *
 * The ladder, each rung only when the one before did not give a database that passes `PRAGMA integrity_check`:
 *
 * 1. **Check.** `integrity_check` says the file is fine: nothing is touched (the error was not the file).
 * 2. **Keep the damaged file.** It is copied, with its WAL, to `<name>.corrupt-<ms>` before anything else happens, and a
 *    failed copy stops the repair. Nothing below deletes user data that this copy does not hold.
 * 3. **REINDEX**, when `integrity_check` only complains that rows and indexes disagree (every page is readable, the indexes
 *    are rebuilt from the rows).
 * 4. **VACUUM INTO** a new file: succeeds when every page of every table *and index* can still be read (SQLite copies each
 *    index b-tree as it is), so it rescues a database whose problem is not in a page; the indexes come out rebuilt.
 * 5. **Row salvage** into a new database made by the app's own schema code (its indexes are built from the rows, so a damaged
 *    index page loses nothing): each table is copied window by window; a
 *    window that cannot be read is cut in half until one row is left, and a row or a stretch of rowids that cannot be read is
 *    skipped (found by an exponential then a binary search, so a damaged b-tree leaf costs about a hundred cheap probes, not a
 *    scan). Triggers are dropped while copying, so the `rev` bookkeeping they keep is copied as it was, and put back after.
 * 6. **Recreate**: nothing could be read, so the new database is just the schema.
 * 7. **Install** the new file over the old one *in place* with SQLite's online backup, which works with the app's and the
 *    native sync's connections open (a rename would leave them writing into the file that was renamed away). When that fails
 *    (the file's header is gone) and no other part of the app has the file open (`canSwap`), the files are swapped;
 *    otherwise the new file is kept and `applyPendingSwap` does it at the next start.
 */

/** What a statement can bind: the values of expo-sqlite's `SQLiteBindValue`. */
export type BindValue = string | number | boolean | null | Uint8Array;

/** The slice of a SQLite connection the repair uses; expo-sqlite's `SQLiteDatabase` has it, and so does the shim the tests use. */
export interface RecoveryDb {
  getAllAsync<T = unknown>(sql: string): Promise<T[]>;
  getAllAsync<T = unknown>(sql: string, params: BindValue[]): Promise<T[]>;
  getFirstAsync<T = unknown>(sql: string): Promise<T | null>;
  getFirstAsync<T = unknown>(sql: string, params: BindValue[]): Promise<T | null>;
  runAsync(sql: string): Promise<{ changes: number }>;
  runAsync(sql: string, params: BindValue[]): Promise<{ changes: number }>;
  execAsync(sql: string): Promise<void>;
  closeAsync(): Promise<void>;
}

export interface RecoveryEnv {
  /** A connection of its own (never the app's shared one) to `name` in the database folder, created when missing; waits for locks. */
  open(name: string): Promise<RecoveryDb>;
  /** SQLite's online backup: all of `from` over `to`, through `to`'s pager, so other connections to `to` see the new content. */
  backup(from: RecoveryDb, to: RecoveryDb): Promise<void>;
  /** The absolute path of `name`, as ATTACH and VACUUM INTO want it. */
  pathOf(name: string): string;
  files: {
    exists(name: string): Promise<boolean>;
    copy(from: string, to: string): Promise<void>;
    move(from: string, to: string): Promise<void>;
    remove(name: string): Promise<void>;
  };
  /** Milliseconds; names the kept file. */
  now(): number;
  /** The app's schema on an empty database: the shared migrations and the tables JS creates itself. */
  buildSchema(db: RecoveryDb): Promise<void>;
  /** Runs on the repaired database when rows could not be saved, e.g. to make the cloud pull start from the beginning. */
  afterLoss?(db: RecoveryDb): Promise<void>;
  /** One line per step and outcome of the repair, for the device log and the repair notice. */
  log?(message: string): void;
}

export interface RecoveryOptions {
  /**
   * False when the native writer may hold a connection to the file (it cannot be released): the repaired copy is never written
   * into the file in use, because that connection keeps its own cache and WAL view of the old content and misreads or damages the
   * new. The copy is swapped in as a file where `canSwap` allows, and otherwise prepared for the next start. Default true.
   */
  inPlace?: boolean;
  /** True where nothing else has the file open (before the database provider mounts): a failed in-place install may then swap the files. */
  canSwap?: boolean;
}

export interface TableReport {
  table: string;
  /** Rows written to the new database. */
  copied: number;
  /** Places where rows could not be read: a damaged leaf, a damaged row, or the whole table. */
  unreadable: number;
}

export type RecoveryMethod = 'reindex' | 'vacuum' | 'salvage';

export type RecoveryResult =
  /** The file passes the integrity check; nothing was changed. */
  | { kind: 'healthy' }
  /** The database was repaired; `lost` says rows could not be read (the cloud and the watch have to refill them). */
  | { kind: 'repaired'; method: RecoveryMethod; keptAs: string; tables: TableReport[]; lost: boolean }
  /** Nothing could be read: the database is the empty schema. */
  | { kind: 'recreated'; keptAs: string }
  /** The repair could not finish. `keptAs` is the copy of the damaged file when one was made; `swapPending` the new file waiting for `applyPendingSwap`. */
  | { kind: 'failed'; keptAs: string | null; reason: string; swapPending: string | null };

/** Rows copied per statement; halved when a window cannot be read. */
export const COPY_WINDOW = 500;
const MIN_ROWID = -Number.MAX_SAFE_INTEGER;
const MAX_ROWID = Number.MAX_SAFE_INTEGER;
const INTEGRITY_LINES = 50;
const SIDE_FILES = ['', '-wal', '-shm', '-journal'] as const;

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const quoteLiteral = (text: string): string => `'${text.replace(/'/g, "''")}'`;
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Tells the environment what the repair is doing (the log of the repair); a log that fails never stops it. */
function say(env: RecoveryEnv, message: string): void {
  try {
    env.log?.(message);
  } catch {
    // Logging is for people reading logs.
  }
}

/** Problems `PRAGMA main.integrity_check` reports (the schema is named so an attached database is not checked too); empty when it says `ok`. A check that itself fails is a problem too. */
export async function integrityProblems(db: RecoveryDb): Promise<string[]> {
  try {
    const rows = await db.getAllAsync<Record<string, unknown>>(`PRAGMA main.integrity_check(${INTEGRITY_LINES})`);
    const lines = rows.map((row) => String(Object.values(row)[0]));
    return lines.length === 1 && lines[0] === 'ok' ? [] : lines;
  } catch (e) {
    return [errorText(e)];
  }
}

/**
 * `PRAGMA quick_check(1)`: reads every page once like `integrity_check` but skips the index/row cross-checks, so it is the
 * cheap test run at a start. `damaged` when it reports anything but `ok` or fails with a corruption error; `unknown` when it
 * could not run for another reason (a lock, a closed connection), which says nothing about the file.
 */
export async function quickCheck(db: RecoveryDb): Promise<'ok' | 'damaged' | 'unknown'> {
  try {
    const rows = await db.getAllAsync<Record<string, unknown>>('PRAGMA main.quick_check(1)');
    return rows.length === 1 && String(Object.values(rows[0])[0]) === 'ok' ? 'ok' : 'damaged';
  } catch (e) {
    return isCorruptionError(e) ? 'damaged' : 'unknown';
  }
}

/** True when every reported problem is about an index: the rows are intact and REINDEX can rebuild what is wrong. */
function onlyIndexProblems(problems: readonly string[]): boolean {
  return problems.length > 0 && problems.every((line) => /\bindex\b/i.test(line) && !/\b(tree|page)\b/i.test(line));
}

async function closeQuietly(db: RecoveryDb | null): Promise<void> {
  try {
    await db?.closeAsync();
  } catch {
    // Closing a damaged connection may fail; it holds nothing the repair still needs.
  }
}

async function removeDatabase(env: RecoveryEnv, name: string): Promise<void> {
  for (const suffix of SIDE_FILES) {
    const file = `${name}${suffix}`;
    if (await env.files.exists(file)) await env.files.remove(file);
  }
}

/** Copies the database file and its WAL aside, so what is about to be repaired is never the only copy. */
async function keepDamagedFile(env: RecoveryEnv, name: string, keptAs: string): Promise<void> {
  await env.files.copy(name, keptAs);
  if (await env.files.exists(`${name}-wal`)) await env.files.copy(`${name}-wal`, `${keptAs}-wal`);
}

/** Makes `intoName` from the readable parts of `from`; null when VACUUM INTO cannot read everything. */
async function vacuumInto(env: RecoveryEnv, from: RecoveryDb, intoName: string): Promise<boolean> {
  try {
    await removeDatabase(env, intoName);
    await from.execAsync(`VACUUM INTO ${quoteLiteral(env.pathOf(intoName))}`);
  } catch (e) {
    say(env, `VACUUM INTO failed: ${errorText(e)}`);
    await removeDatabase(env, intoName);
    return false;
  }
  const copy = await env.open(intoName);
  try {
    const problems = await integrityProblems(copy);
    if (problems.length === 0) return true;
    say(env, `VACUUM INTO result fails its integrity check: ${problems.slice(0, 3).join(' | ')}`);
  } finally {
    await closeQuietly(copy);
  }
  await removeDatabase(env, intoName);
  return false;
}

/**
 * The smallest rowid `>= lo` from which `table` can be read again after a rowid stretch that cannot be read, or null when
 * nothing after `lo` can. A seek for `rowid >= x` fails for every x inside a damaged leaf's range and works for every x beyond
 * it, so the boundary is found by doubling the step and then halving it.
 */
async function resumePoint(db: RecoveryDb, table: string, lo: number): Promise<number | null> {
  const probe = async (from: number): Promise<boolean> => {
    try {
      await db.getFirstAsync(`SELECT rowid FROM old.${table} WHERE rowid >= ? ORDER BY rowid LIMIT 1`, [from]);
      return true;
    } catch (e) {
      if (isCorruptionError(e)) return false;
      throw e;
    }
  };
  let bad = lo;
  let step = 1;
  let good: number;
  for (;;) {
    const candidate = bad + step;
    if (candidate > MAX_ROWID) return null;
    if (await probe(candidate)) {
      good = candidate;
      break;
    }
    bad = candidate;
    step *= 2;
  }
  while (good - bad > 1) {
    const middle = Math.floor(bad + (good - bad) / 2);
    if (await probe(middle)) good = middle;
    else bad = middle;
  }
  return good;
}

/** A row-level failure while copying: the page is damaged, or the row it decodes into breaks a constraint of the new table. */
const isRowError = (e: unknown): boolean => isCorruptionError(e) || /constraint failed|datatype mismatch|string or blob too big|out of order/i.test(errorText(e));

/** Copies one rowid table from `old` to `main`, window by window, skipping what cannot be read. */
async function copyRows(db: RecoveryDb, table: string, columns: readonly string[], required: readonly string[]): Promise<TableReport> {
  const q = quoteIdent(table);
  // Rows a damaged page decoded with NULL in a NOT NULL column are left out; INSERT OR REPLACE would abort on them.
  const present = required.map((column) => ` AND ${quoteIdent(column)} IS NOT NULL`).join('');
  const list = columns.map(quoteIdent).join(', ');
  const report: TableReport = { table, copied: 0, unreadable: 0 };
  let lo = MIN_ROWID;
  let size = COPY_WINDOW;
  for (;;) {
    let hi: number | null;
    try {
      const last = await db.getFirstAsync<{ r: number }>(
        `SELECT rowid AS r FROM old.${q} WHERE rowid >= ? ORDER BY rowid LIMIT 1 OFFSET ?`,
        [lo, size - 1],
      );
      hi = last ? last.r : null;
    } catch (e) {
      if (!isCorruptionError(e)) throw e;
      if (size > 1) {
        size = Math.max(1, size >> 1);
        continue;
      }
      report.unreadable++;
      const resume = await resumePoint(db, q, lo);
      if (resume === null) return report;
      lo = resume;
      size = COPY_WINDOW;
      continue;
    }
    try {
      // LIMIT, not `rowid <= hi`: a scan with an upper bound reads one row past it to see that it is past, and that row may be in the damaged leaf next door.
      const result = await db.runAsync(
        `INSERT OR REPLACE INTO main.${q} (${list}) SELECT ${list} FROM old.${q} WHERE rowid >= ?${present} ORDER BY rowid LIMIT ?`,
        [lo, size],
      );
      report.copied += result.changes;
      const attempted = hi === null ? null : await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM old.${q} WHERE rowid >= ? ORDER BY rowid LIMIT ?)`, [lo, size]);
      if (attempted && attempted.n > result.changes) report.unreadable += attempted.n - result.changes;
    } catch (e) {
      if (!isRowError(e)) throw e;
      if (size > 1) {
        size = Math.max(1, size >> 1);
        continue;
      }
      // One row whose own content (an overflow page) is unreadable, though its place in the tree is.
      report.unreadable++;
      if (hi === null) return report;
      lo = hi + 1;
      size = COPY_WINDOW;
      continue;
    }
    if (hi === null) return report;
    lo = hi + 1;
    size = Math.min(COPY_WINDOW, size * 2);
  }
}

async function columnsOf(db: RecoveryDb, schema: 'main' | 'old', table: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA ${schema}.table_info(${quoteIdent(table)})`);
  return rows.map((row) => row.name);
}

/** The columns of `table` (among `columns`) that must hold a value: NOT NULL with no default, and not the rowid alias. */
async function requiredColumns(db: RecoveryDb, table: string, columns: readonly string[]): Promise<string[]> {
  const info = await db.getAllAsync<{ name: string; notnull: number; dflt_value: string | null; pk: number }>(`PRAGMA main.table_info(${quoteIdent(table)})`);
  const wanted = new Set(columns);
  return info.filter((column) => wanted.has(column.name) && column.notnull === 1 && column.dflt_value === null && column.pk === 0).map((column) => column.name);
}

/**
 * Points of a workout whose row did not survive cannot be shown or exported; they go, so the new database is consistent. The
 * count is taken off `copied` and put in `unreadable`.
 */
async function removeOrphans(db: RecoveryDb, reports: TableReport[]): Promise<void> {
  try {
    const removed = await db.runAsync(`DELETE FROM main.workout_points WHERE workout_id NOT IN (SELECT rowid FROM main.workouts)`);
    const report = reports.find((table) => table.table === 'workout_points');
    if (removed.changes > 0 && report) {
      report.copied = Math.max(0, report.copied - removed.changes);
      report.unreadable++;
    }
  } catch (e) {
    if (!/no such (table|column)/i.test(errorText(e))) throw e;
  }
}

/** The tables the app's schema has, each filled with whatever `old` still holds of it. `db` is the new database with the damaged one attached as `old`. */
async function salvageTables(db: RecoveryDb): Promise<TableReport[]> {
  const targets = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name`,
  );
  const triggers = await db.getAllAsync<{ name: string; sql: string }>(`SELECT name, sql FROM main.sqlite_master WHERE type = 'trigger'`);
  for (const trigger of triggers) await db.execAsync(`DROP TRIGGER ${quoteIdent(trigger.name)}`);
  // Rows are copied as they are, in any order: the new database must not check them against each other.
  await db.execAsync('PRAGMA foreign_keys = OFF');

  const reports: TableReport[] = [];
  for (const { name } of targets) {
    let oldColumns: string[];
    try {
      oldColumns = await columnsOf(db, 'old', name);
    } catch (e) {
      if (!isCorruptionError(e)) throw e;
      reports.push({ table: name, copied: 0, unreadable: 1 });
      continue;
    }
    // A table the damaged database never had (a newer feature) has no columns there: nothing to copy.
    if (oldColumns.length === 0) continue;
    const mine = new Set(await columnsOf(db, 'main', name));
    const columns = oldColumns.filter((column) => mine.has(column));
    if (columns.length === 0) continue;
    const required = await requiredColumns(db, name, columns);
    const where = required.length === 0 ? '' : ` WHERE ${required.map((column) => `${quoteIdent(column)} IS NOT NULL`).join(' AND ')}`;
    const definition = await db.getFirstAsync<{ sql: string | null }>(`SELECT sql FROM old.sqlite_master WHERE type = 'table' AND name = ?`, [name]);
    if (/WITHOUT\s+ROWID/i.test(definition?.sql ?? '')) {
      const list = columns.map(quoteIdent).join(', ');
      try {
        const result = await db.runAsync(`INSERT OR REPLACE INTO main.${quoteIdent(name)} (${list}) SELECT ${list} FROM old.${quoteIdent(name)}${where}`);
        reports.push({ table: name, copied: result.changes, unreadable: 0 });
      } catch (e) {
        if (!isRowError(e)) throw e;
        reports.push({ table: name, copied: 0, unreadable: 1 });
      }
      continue;
    }
    reports.push(await copyRows(db, name, columns, required));
  }

  // AUTOINCREMENT counters: an id that was handed out and deleted must not be handed out again.
  try {
    const sequences = await db.getAllAsync<{ name: string; seq: number }>(`SELECT name, seq FROM old.sqlite_sequence`);
    for (const { name, seq } of sequences) {
      const updated = await db.runAsync(`UPDATE main.sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?`, [seq, name]);
      if (updated.changes === 0) await db.runAsync(`INSERT INTO main.sqlite_sequence (name, seq) VALUES (?, ?)`, [name, seq]);
    }
  } catch (e) {
    if (!isCorruptionError(e) && !/no such table/i.test(errorText(e))) throw e;
  }

  await removeOrphans(db, reports);
  for (const trigger of triggers) await db.execAsync(trigger.sql);
  return reports;
}

/** Builds `intoName` from the schema and the readable rows of the damaged database `name`; null when none of its tables can be listed or the result is not sound. */
async function salvage(env: RecoveryEnv, name: string, intoName: string): Promise<TableReport[] | null> {
  await removeDatabase(env, intoName);
  const fresh = await env.open(intoName);
  try {
    await env.buildSchema(fresh);
    await fresh.execAsync('PRAGMA synchronous = OFF');
    try {
      await fresh.execAsync(`ATTACH DATABASE ${quoteLiteral(env.pathOf(name))} AS old`);
      const reports = await salvageTables(fresh);
      for (const report of reports) say(env, `salvage ${report.table}: copied ${report.copied}, unreadable places ${report.unreadable}`);
      const problems = await integrityProblems(fresh);
      if (problems.length === 0) return reports;
      say(env, `salvaged database fails its integrity check: ${problems.slice(0, 3).join(' | ')}`);
      return null;
    } catch (e) {
      say(env, `salvage stopped: ${errorText(e)}`);
      if (isCorruptionError(e)) return null;
      throw e;
    } finally {
      await fresh.execAsync('DETACH DATABASE old').catch(() => undefined);
    }
  } finally {
    await closeQuietly(fresh);
  }
}

/** The schema alone, in `intoName`. */
async function emptyDatabase(env: RecoveryEnv, intoName: string): Promise<void> {
  await removeDatabase(env, intoName);
  const fresh = await env.open(intoName);
  try {
    await env.buildSchema(fresh);
  } finally {
    await closeQuietly(fresh);
  }
}

/** Replaces `name` with `sourceName` by files: the WAL of the source is folded in, the old files go, the source moves. */
async function swapFiles(env: RecoveryEnv, name: string, sourceName: string): Promise<void> {
  const source = await env.open(sourceName);
  try {
    await source.execAsync('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    await closeQuietly(source);
  }
  for (const suffix of ['-wal', '-shm', '-journal'] as const) {
    if (await env.files.exists(`${sourceName}${suffix}`)) await env.files.remove(`${sourceName}${suffix}`);
  }
  await removeDatabase(env, name);
  await env.files.move(sourceName, name);
}

/**
 * Finishes an install that could only be prepared (`swapPending` of a failed result) at a start where nothing has the file
 * open. True when the swap happened; false when there was nothing to swap in.
 */
export async function applyPendingSwap(env: RecoveryEnv, name: string, sourceName: string): Promise<boolean> {
  if (!(await env.files.exists(sourceName))) return false;
  await swapFiles(env, name, sourceName);
  return true;
}

type Installed = { done: true } | { done: false; reason: string; swapPending: string | null };

async function install(env: RecoveryEnv, name: string, sourceName: string, canSwap: boolean): Promise<Installed> {
  let reason: string;
  let from: RecoveryDb | null = null;
  let to: RecoveryDb | null = null;
  try {
    from = await env.open(sourceName);
    to = await env.open(name);
    await env.backup(from, to);
    say(env, 'in-place backup done');
    return { done: true };
  } catch (e) {
    reason = errorText(e);
    say(env, `in-place backup failed: ${reason}`);
  } finally {
    await closeQuietly(from);
    await closeQuietly(to);
  }
  if (!canSwap) return { done: false, reason, swapPending: sourceName };
  try {
    await swapFiles(env, name, sourceName);
    say(env, 'files swapped');
    return { done: true };
  } catch (e) {
    say(env, `file swap failed: ${errorText(e)}`);
    return { done: false, reason: `${reason}; swap: ${errorText(e)}`, swapPending: null };
  }
}

/** The repaired database must open and pass the integrity check. */
async function verify(env: RecoveryEnv, name: string): Promise<boolean> {
  const db = await env.open(name);
  try {
    const problems = await integrityProblems(db);
    if (problems.length > 0) say(env, `the installed database fails its integrity check: ${problems.slice(0, 3).join(' | ')}`);
    return problems.length === 0;
  } finally {
    await closeQuietly(db);
  }
}

/**
 * Installs and checks the result. A check that fails right after an in-place install means something wrote into the file while
 * it was being replaced (the native writer is a different SQLite library and does not wait for the app's locks): the copy is
 * still there, so the install is done a second time, and when that fails too the files are swapped where that is allowed or the
 * prepared file is left for `applyPendingSwap` at the next start.
 */
async function installAndVerify(env: RecoveryEnv, name: string, sourceName: string, canSwap: boolean, inPlace: boolean): Promise<Installed> {
  if (!inPlace) {
    if (!canSwap) {
      say(env, `${sourceName} prepared: the native writer may hold ${name} open, it goes in at the next start`);
      return { done: false, reason: 'the repaired copy is prepared and goes in when the app is opened again', swapPending: sourceName };
    }
    try {
      await swapFiles(env, name, sourceName);
      say(env, 'files swapped');
    } catch (e) {
      say(env, `file swap failed: ${errorText(e)}`);
      return { done: false, reason: `swap: ${errorText(e)}`, swapPending: null };
    }
    if (await verify(env, name)) return { done: true };
    return { done: false, reason: 'the repaired database did not pass the integrity check after a file swap', swapPending: null };
  }
  let installed = await install(env, name, sourceName, canSwap);
  if (!installed.done) return installed;
  if (await verify(env, name)) return installed;
  say(env, 'second install attempt');
  installed = await install(env, name, sourceName, false);
  if (installed.done && (await verify(env, name))) return installed;
  if (!canSwap) return { done: false, reason: 'the repaired database did not pass the integrity check', swapPending: sourceName };
  try {
    await swapFiles(env, name, sourceName);
    say(env, 'files swapped after the in-place install did not verify');
  } catch (e) {
    return { done: false, reason: `the repaired database did not pass the integrity check; swap: ${errorText(e)}`, swapPending: null };
  }
  if (await verify(env, name)) return { done: true };
  return { done: false, reason: 'the repaired database did not pass the integrity check after a file swap', swapPending: null };
}

/**
 * Runs the ladder (module notes) on `name`. Never throws: whatever happens is in the result, and the damaged file is only
 * ever replaced after a copy of it was made.
 */
export async function recoverDatabase(env: RecoveryEnv, name: string, options: RecoveryOptions = {}): Promise<RecoveryResult> {
  say(env, `repair of ${name} starts`);
  const stamp = env.now();
  const keptAs = `${name}.corrupt-${stamp}`;
  const vacuumName = `${name}.vacuum-${stamp}`;
  const salvageName = `${name}.salvage-${stamp}`;
  let probe: RecoveryDb | null = null;
  let kept = false;
  try {
    let problems: string[];
    try {
      probe = await env.open(name);
      problems = await integrityProblems(probe);
    } catch (e) {
      problems = [errorText(e)];
    }
    say(env, `integrity problems (${problems.length}): ${problems.slice(0, 3).join(' | ')}`);
    if (problems.length === 0) return { kind: 'healthy' };

    try {
      await keepDamagedFile(env, name, keptAs);
      kept = true;
      say(env, `kept a copy of the damaged file as ${keptAs}`);
    } catch (e) {
      say(env, `could not keep a copy of the damaged file: ${errorText(e)}`);
      return { kind: 'failed', keptAs: null, reason: `could not keep a copy of the damaged file: ${errorText(e)}`, swapPending: null };
    }

    let method: RecoveryMethod | null = null;
    let sourceName: string | null = null;
    let tables: TableReport[] = [];
    let recreated = false;
    if (probe && options.inPlace !== false && onlyIndexProblems(problems)) {
      try {
        await probe.execAsync('REINDEX');
        if ((await integrityProblems(probe)).length === 0) method = 'reindex';
      } catch (e) {
        if (!isCorruptionError(e)) throw e;
      }
    }
    if (method === null && probe && (await vacuumInto(env, probe, vacuumName))) {
      say(env, 'VACUUM INTO produced a sound copy');
      method = 'vacuum';
      sourceName = vacuumName;
    }
    if (method === null && probe) {
      await closeQuietly(probe);
      probe = null;
      const reports = await salvage(env, name, salvageName);
      if (reports) {
        method = 'salvage';
        sourceName = salvageName;
        tables = reports;
        // Every table unreadable and nothing copied: the damage is in the file's first pages, and what is left is the empty schema.
        recreated = reports.length > 0 && reports.every((table) => table.copied === 0) && reports.some((table) => table.unreadable > 0);
      }
    }

    if (method === 'reindex') {
      await closeQuietly(probe);
      probe = null;
      return { kind: 'repaired', method, keptAs, tables, lost: false };
    }

    if (sourceName === null) {
      say(env, 'nothing could be read: rebuilding an empty database');
      await emptyDatabase(env, salvageName);
      sourceName = salvageName;
      recreated = true;
    }
    await closeQuietly(probe);
    probe = null;

    say(env, `installing ${sourceName} over ${name} (${method ?? 'recreate'}, canSwap ${options.canSwap === true})`);
    const installed = await installAndVerify(env, name, sourceName, options.canSwap === true, options.inPlace !== false);
    if (!installed.done) return { kind: 'failed', keptAs, reason: installed.reason, swapPending: installed.swapPending };

    const lost = recreated || tables.some((table) => table.unreadable > 0);
    if (lost && env.afterLoss) {
      // The database is installed and sound; failing to reset the cloud cursors must not turn that into a failed repair.
      let db: RecoveryDb | null = null;
      try {
        db = await env.open(name);
        await env.afterLoss(db);
      } catch (e) {
        say(env, `afterLoss failed (ignored): ${errorText(e)}`);
      } finally {
        await closeQuietly(db);
      }
    }
    for (const temp of [vacuumName, salvageName]) await removeDatabase(env, temp);
    say(env, recreated ? 'done: database recreated' : `done: repaired by ${method ?? 'salvage'}${lost ? ', some rows lost' : ''}`);
    return recreated ? { kind: 'recreated', keptAs } : { kind: 'repaired', method: method ?? 'salvage', keptAs, tables, lost };
  } catch (e) {
    say(env, `repair threw: ${errorText(e)}`);
    return { kind: 'failed', keptAs: kept ? keptAs : null, reason: errorText(e), swapPending: null };
  } finally {
    await closeQuietly(probe);
  }
}

/**
 * What a Huawei Health export holds that belongs in JoyoRogo's own history, and the push that sends it once the person is signed in.
 *
 * The native import (`HuaweiImportStore.kt`) writes three kinds of rows: weigh-ins into `scale_reading` (scale id `IMPORTED_SCALE_ID`), and
 * meals and water days into `rogo_import_queue` (`kind` `meal` / `water`, `payload` the JSON the endpoint takes). Nothing is sent from
 * native code: this file sends them through `weight.importHistory`, `food.importHistory` and `water.importHistory`, which are idempotent
 * and never write over what the person has, so a row that was sent but not marked (the app died in between) is harmless the next time.
 * A failed or offline push leaves the rows `pending`; the Huawei import screen offers to send them again.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { RogoImportMeal, RogoImportResult, RogoImportWeight } from '@/cloud/rogo';
import { toRogoCheckIn } from '@/features/scale/rogoMap';
import { markRogo, pendingImportedWeighIns, type ScaleDb } from '@/features/scale/store';

export type QueueDb = ScaleDb & Pick<SQLiteDatabase, 'runAsync' | 'getAllAsync' | 'execAsync'>;

/** `endpoint` calls of `rogo`, passed in so the push runs under `bun test` with no network. */
export interface ImportClient {
  importWeights(entries: RogoImportWeight[]): Promise<RogoImportResult>;
  importMeals(meals: RogoImportMeal[]): Promise<RogoImportResult>;
  importWater(days: { date: string; glasses: number }[]): Promise<RogoImportResult>;
}

/** Most items an `importHistory` call takes. */
export const IMPORT_BATCH = 100;

/** The same statement the native import runs, so either side can be first to create the table. */
export async function ensureRogoImportQueueSchema(db: Pick<SQLiteDatabase, 'execAsync'>): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS rogo_import_queue (
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      payload TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      PRIMARY KEY (kind, key)
    );
  `);
}

interface QueueRow {
  kind: string;
  key: string;
  payload: string;
}

/** Per kind: rows JoyoRogo took (`added`), rows it already had or refused (`skipped`), rows still waiting (`waiting`). */
export interface KindOutcome {
  added: number;
  skipped: number;
  waiting: number;
}

export interface ImportPushOutcome {
  weighIns: KindOutcome;
  meals: KindOutcome;
  water: KindOutcome;
  /** The first answer JoyoRogo gave that was an error (not offline, not signed out): shown so a missing server update is visible. */
  error: string | null;
}

const none = (): KindOutcome => ({ added: 0, skipped: 0, waiting: 0 });

/** How many rows are still waiting for JoyoRogo, per kind. */
export async function pendingImportCounts(db: QueueDb): Promise<{ weighIns: number; meals: number; water: number }> {
  const queued = await db.getAllAsync<{ kind: string; n: number }>("SELECT kind, COUNT(*) AS n FROM rogo_import_queue WHERE state = 'pending' GROUP BY kind");
  const count = (kind: string) => queued.find((r) => r.kind === kind)?.n ?? 0;
  return { weighIns: (await pendingImportedWeighIns(db)).length, meals: count('meal'), water: count('water') };
}

async function setState(db: QueueDb, rows: QueueRow[], state: 'sent' | 'pending', error: string | null): Promise<void> {
  for (const r of rows) {
    await db.runAsync('UPDATE rogo_import_queue SET state = ?, error = ? WHERE kind = ? AND key = ?', state, error, r.kind, r.key);
  }
}

/** Runs [send] over [rows] in batches; a batch that fails stops the kind (the next would fail the same way). */
async function sendBatches<T>(
  rows: T[],
  send: (batch: T[]) => Promise<RogoImportResult>,
  done: (batch: T[], result: RogoImportResult) => Promise<void>,
  failed: (batch: T[], message: string) => Promise<void>,
  isUnavailable: (error: unknown) => boolean,
  out: KindOutcome,
  report: (message: string) => void,
): Promise<void> {
  for (let i = 0; i < rows.length; i += IMPORT_BATCH) {
    const batch = rows.slice(i, i + IMPORT_BATCH);
    let result: RogoImportResult;
    try {
      result = await send(batch);
    } catch (e) {
      out.waiting += rows.length - i;
      if (!isUnavailable(e)) {
        const message = e instanceof Error ? e.message : String(e);
        await failed(batch, message);
        report(message);
      }
      return;
    }
    await done(batch, result);
    out.added += result.added;
    out.skipped += batch.length - result.added;
  }
}

/**
 * Sends what is waiting: weigh-ins, meals, water days, oldest first. Offline or signed out (`isUnavailable`) leaves everything pending and
 * quiet; an answer that is an error leaves that kind pending with the message on its rows and is reported in `error`, and the other kinds
 * still go. A weight JoyoRogo cannot take (outside 25 to 400 kg) is marked `skipped` with its reason.
 */
export async function pushImportedToRogo(db: QueueDb, client: ImportClient, isUnavailable: (error: unknown) => boolean): Promise<ImportPushOutcome> {
  const outcome: ImportPushOutcome = { weighIns: none(), meals: none(), water: none(), error: null };
  const report = (message: string) => {
    outcome.error ??= message;
  };

  const weighIns = await pendingImportedWeighIns(db);
  const sendable: { id: number; entry: RogoImportWeight }[] = [];
  for (const row of weighIns) {
    const input = toRogoCheckIn(row, row.takenAt);
    if (!input) {
      await markRogo(db, row.id, 'skipped', 'out of range');
      outcome.weighIns.skipped++;
      continue;
    }
    const { source: _source, ...entry } = input;
    sendable.push({ id: row.id, entry });
  }
  await sendBatches(
    sendable,
    (batch) => client.importWeights(batch.map((b) => b.entry)),
    async (batch) => {
      for (const b of batch) await markRogo(db, b.id, 'sent', null);
    },
    async (batch, message) => {
      for (const b of batch) await markRogo(db, b.id, 'pending', message);
    },
    isUnavailable,
    outcome.weighIns,
    report,
  );

  for (const [kind, out] of [['meal', outcome.meals], ['water', outcome.water]] as const) {
    const rows = await db.getAllAsync<QueueRow>("SELECT kind, key, payload FROM rogo_import_queue WHERE kind = ? AND state = 'pending' ORDER BY key", kind);
    const parsed: { row: QueueRow; value: unknown }[] = [];
    for (const r of rows) {
      try {
        parsed.push({ row: r, value: JSON.parse(r.payload) as unknown });
      } catch {
        await db.runAsync("UPDATE rogo_import_queue SET state = 'invalid', error = 'payload is not JSON' WHERE kind = ? AND key = ?", r.kind, r.key);
      }
    }
    await sendBatches(
      parsed,
      (batch) => (kind === 'meal' ? client.importMeals(batch.map((b) => b.value as RogoImportMeal)) : client.importWater(batch.map((b) => b.value as { date: string; glasses: number }))),
      (batch) => setState(db, batch.map((b) => b.row), 'sent', null),
      (batch, message) => setState(db, batch.map((b) => b.row), 'pending', message),
      isUnavailable,
      out,
      report,
    );
  }
  return outcome;
}

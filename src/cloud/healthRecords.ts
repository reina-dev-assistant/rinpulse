import type { SQLiteDatabase } from 'expo-sqlite';

import type { RecordAdapter, WireRecord } from '@/cloud/syncEngine';
import { remoteWins } from '@/cloud/syncEngine';
import { getItem, listDirtyItems, markItemsPushed, putLocalItem } from '@/cloud/syncItems';

/**
 * The small health tables as synced records (ns `fit`): `hrv`, `sleepscore`, `cycleperiod`, `cycleday` and `metric`.
 * Steps and sleep segments have their own uploader (`uploader.ts`) and a windowed restore (`healthRestore.ts`).
 *
 * None of these tables has an `imported` column and the native writers (SyncStore, NightHrv, HrvSpot, HealthMetricsStore,
 * CycleStore, on both platforms) write them directly, so what is already known to the cloud is tracked in `sync_item`
 * instead: a row whose document equals the stored one is clean, anything else is a local change and goes up dirty. A
 * restored row is stored clean at the moment it is applied, so it is never pushed back. Scans only look at the rows of
 * the last `SCAN_WINDOW_DAYS` days, starting a few days before the previous scan (a watch sync rewrites recent rows),
 * and the point the previous scan reached lives in `sync_item` too (kind `scanmark`), so forgetting the sync state
 * forgets it as well.
 */

export const HEALTH_KINDS = ['hrv', 'sleepscore', 'cycleperiod', 'cycleday', 'metric'] as const;
export type HealthKind = (typeof HEALTH_KINDS)[number];
export const CYCLE_KINDS = ['cycleperiod', 'cycleday'] as const;

/** Rows older than this are never uploaded by a scan. */
export const SCAN_WINDOW_DAYS = 400;
/** A scan re-reads this many days before the one it follows. */
const SCAN_OVERLAP_DAYS = 3;
/** Two scans of one adapter instance are at least this far apart (the engine asks `listDirty` once per push round). */
const SCAN_MIN_GAP_MS = 60_000;
/** A `metric` bundle above this many characters is split by hour; the server takes 64 KB. */
export const METRIC_BUNDLE_SPLIT_CHARS = 48_000;

const DAY_S = 86_400;
const MARK_KIND = 'scanmark';
const GATE_KIND = 'gate';

export interface Entry {
  id: string;
  /** The document sent to the server: a JSON object. */
  json: string;
  rank: number;
  /** `updatedAt` of a local edit, in the phone's clock (ms). */
  at: number;
}

interface KindSpec {
  kind: HealthKind;
  /** Only the cycle kinds: the person can switch the sync of the kind off. */
  gated: boolean;
  /** Scans read the rows of a time window; false: the whole (small) table every time. */
  windowed: boolean;
  /** A row deleted locally becomes a tombstone. */
  tombstones: boolean;
  /** `sync_item` keeps a digest of the document instead of the document (bundles are big). */
  digest: boolean;
  /** The local rows changed since `fromSec` (all of them when null), as documents. */
  scan(db: SQLiteDatabase, fromSec: number | null, now: number, visit: (entry: Entry) => Promise<void>): Promise<void>;
  /** The document that `id` stands for now; null when there is none (or it would be too big to send as one record). */
  build(db: SQLiteDatabase, id: string, now: number): Promise<Entry | null>;
  /** Every entry the table currently has around `id` (a metric day may be one bundle or 24). */
  around(db: SQLiteDatabase, id: string, now: number): Promise<Entry[]>;
  /** Writes a pulled document into the table; false when the document is not one this build understands. */
  apply(db: SQLiteDatabase, doc: Record<string, unknown>): Promise<boolean>;
  /** Removes what a pulled tombstone deleted. */
  remove(db: SQLiteDatabase, id: string): Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Documents

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const int = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && Number.isInteger(n) ? n : null;
};
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDoc(json: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(json);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

/** A 53-bit string hash (cyrb53): enough to notice that a bundle changed. */
function hash53(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

const digestOf = (json: string) => JSON.stringify({ h: hash53(json), len: json.length });

// ---------------------------------------------------------------------------------------------------------------------
// hrv_readings: PK (start, source). A night row is replaced by the next one that overlaps it (NightHrv), so a pulled
// night that overlaps a local night competes with it: more beats win, then the later end, then the later start. The
// same order on every phone leaves the same winner everywhere.

interface HrvRow {
  start: number;
  end: number;
  source: string;
  rmssd: number;
  sdnn: number | null;
  mean_rr: number | null;
  beats: number;
}

const hrvEntry = (row: HrvRow, now: number): Entry => ({
  id: `${row.start}:${row.source}`,
  json: JSON.stringify({ start: row.start, end: row.end, source: row.source, rmssd: row.rmssd, sdnn: row.sdnn, meanRr: row.mean_rr, beats: row.beats }),
  rank: 0,
  at: now,
});

const hrvBeats = (a: { beats: number; end: number; start: number }, b: { beats: number; end: number; start: number }) =>
  a.beats - b.beats || a.end - b.end || a.start - b.start;

const HRV_COLUMNS = 'start, end, source, rmssd, sdnn, mean_rr, beats';

const hrvSpec: KindSpec = {
  kind: 'hrv',
  gated: false,
  windowed: true,
  tombstones: false,
  digest: false,
  async scan(db, fromSec, now, visit) {
    const rows = await db.getAllAsync<HrvRow>(`SELECT ${HRV_COLUMNS} FROM hrv_readings WHERE end >= ? ORDER BY end`, fromSec ?? 0);
    for (const row of rows) await visit(hrvEntry(row, now));
  },
  async build(db, id, now) {
    const split = id.indexOf(':');
    const start = Number(id.slice(0, split));
    if (split < 0 || !Number.isInteger(start)) return null;
    const row = await db.getFirstAsync<HrvRow>(`SELECT ${HRV_COLUMNS} FROM hrv_readings WHERE start = ? AND source = ?`, start, id.slice(split + 1));
    return row ? hrvEntry(row, now) : null;
  },
  async around(db, id, now) {
    const entry = await this.build(db, id, now);
    return entry ? [entry] : [];
  },
  async apply(db, doc) {
    const start = int(doc.start);
    const end = int(doc.end);
    const source = text(doc.source);
    const rmssd = num(doc.rmssd);
    const beats = int(doc.beats);
    if (start === null || end === null || end < start || (source !== 'night' && source !== 'spot') || rmssd === null || beats === null) return false;
    if (source === 'night') {
      // Another phone's night that overlaps a different local night competes with it; the same start is the same night.
      const others = (
        await db.getAllAsync<{ start: number; end: number; beats: number }>(
          "SELECT start, end, beats FROM hrv_readings WHERE source = 'night' AND start <= ? AND end >= ?",
          end,
          start,
        )
      ).filter((row) => row.start !== start);
      if (others.some((row) => hrvBeats(row, { beats, end, start }) >= 0)) return true;
      for (const row of others) await db.runAsync("DELETE FROM hrv_readings WHERE source = 'night' AND start = ?", row.start);
    }
    // The same (start, source) is replaced: the pulled document already beat the local one by time, and keeping the
    // local row would send it back to the other phone for ever.
    await db.runAsync(
      `INSERT INTO hrv_readings (start, end, source, rmssd, sdnn, mean_rr, beats) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(start, source) DO UPDATE SET end = excluded.end, rmssd = excluded.rmssd, sdnn = excluded.sdnn,
         mean_rr = excluded.mean_rr, beats = excluded.beats`,
      start,
      end,
      source,
      rmssd,
      num(doc.sdnn),
      num(doc.meanRr),
      beats,
    );
    return true;
  },
  async remove() {},
};

// ---------------------------------------------------------------------------------------------------------------------
// sleep_scores: PK start. The watch rewrites a score while the night is still being read, so a pulled one that wins by
// time replaces the local row.

interface ScoreRow {
  start: number;
  end: number;
  score: number;
  efficiency: number | null;
}

const scoreEntry = (row: ScoreRow, now: number): Entry => ({
  id: String(row.start),
  json: JSON.stringify({ start: row.start, end: row.end, score: row.score, efficiency: row.efficiency }),
  rank: 0,
  at: now,
});

const sleepScoreSpec: KindSpec = {
  kind: 'sleepscore',
  gated: false,
  windowed: true,
  tombstones: false,
  digest: false,
  async scan(db, fromSec, now, visit) {
    const rows = await db.getAllAsync<ScoreRow>('SELECT start, end, score, efficiency FROM sleep_scores WHERE end >= ? ORDER BY start', fromSec ?? 0);
    for (const row of rows) await visit(scoreEntry(row, now));
  },
  async build(db, id, now) {
    const start = Number(id);
    if (!Number.isInteger(start)) return null;
    const row = await db.getFirstAsync<ScoreRow>('SELECT start, end, score, efficiency FROM sleep_scores WHERE start = ?', start);
    return row ? scoreEntry(row, now) : null;
  },
  async around(db, id, now) {
    const entry = await this.build(db, id, now);
    return entry ? [entry] : [];
  },
  async apply(db, doc) {
    const start = int(doc.start);
    const end = int(doc.end);
    const score = int(doc.score);
    if (start === null || end === null || score === null) return false;
    await db.runAsync(
      `INSERT INTO sleep_scores (start, end, score, efficiency) VALUES (?, ?, ?, ?)
       ON CONFLICT(start) DO UPDATE SET end = excluded.end, score = excluded.score, efficiency = excluded.efficiency`,
      start,
      end,
      score,
      int(doc.efficiency),
    );
    return true;
  },
  async remove() {},
};

// ---------------------------------------------------------------------------------------------------------------------
// cycle_periods / cycle_days: the menstrual log. Days are local `YYYY-MM-DD` strings, `modified` is unix seconds on the
// phone that edited the row; the newest `modified` wins and is kept as the row's own `modified` on every phone (so the
// watch push, which compares it, also learns of a change made on another phone). A deleted period is a tombstone.

interface PeriodRow {
  start: string;
  end: string | null;
  modified: number;
}

interface DayRow {
  day: string;
  flow: number;
  cramps: number;
  modified: number;
}

const periodEntry = (row: PeriodRow): Entry => ({
  id: row.start,
  json: JSON.stringify({ start: row.start, end: row.end, modified: row.modified }),
  rank: 0,
  at: row.modified * 1000,
});

const dayEntry = (row: DayRow): Entry => ({
  id: row.day,
  json: JSON.stringify({ day: row.day, flow: row.flow, cramps: row.cramps, modified: row.modified }),
  rank: 0,
  at: row.modified * 1000,
});

const periodSpec: KindSpec = {
  kind: 'cycleperiod',
  gated: true,
  windowed: false,
  tombstones: true,
  digest: false,
  async scan(db, _fromSec, _now, visit) {
    for (const row of await db.getAllAsync<PeriodRow>('SELECT start, end, modified FROM cycle_periods ORDER BY start')) await visit(periodEntry(row));
  },
  async build(db, id) {
    const row = await db.getFirstAsync<PeriodRow>('SELECT start, end, modified FROM cycle_periods WHERE start = ?', id);
    return row ? periodEntry(row) : null;
  },
  async around(db, id, now) {
    const entry = await this.build(db, id, now);
    return entry ? [entry] : [];
  },
  async apply(db, doc) {
    const start = text(doc.start);
    const modified = int(doc.modified);
    const end = doc.end === null ? null : text(doc.end);
    if (start === null || !DAY_PATTERN.test(start) || modified === null || (end !== null && !DAY_PATTERN.test(end))) return false;
    await db.runAsync(
      `INSERT INTO cycle_periods (start, end, modified) VALUES (?, ?, ?)
       ON CONFLICT(start) DO UPDATE SET end = excluded.end, modified = excluded.modified WHERE excluded.modified > cycle_periods.modified`,
      start,
      end,
      modified,
    );
    return true;
  },
  async remove(db, id) {
    await db.runAsync('DELETE FROM cycle_periods WHERE start = ?', id);
  },
};

const daySpec: KindSpec = {
  kind: 'cycleday',
  gated: true,
  windowed: false,
  tombstones: true,
  digest: false,
  async scan(db, _fromSec, _now, visit) {
    for (const row of await db.getAllAsync<DayRow>('SELECT day, flow, cramps, modified FROM cycle_days ORDER BY day')) await visit(dayEntry(row));
  },
  async build(db, id) {
    const row = await db.getFirstAsync<DayRow>('SELECT day, flow, cramps, modified FROM cycle_days WHERE day = ?', id);
    return row ? dayEntry(row) : null;
  },
  async around(db, id, now) {
    const entry = await this.build(db, id, now);
    return entry ? [entry] : [];
  },
  async apply(db, doc) {
    const day = text(doc.day);
    const flow = int(doc.flow);
    const cramps = int(doc.cramps);
    const modified = int(doc.modified);
    if (day === null || !DAY_PATTERN.test(day) || flow === null || cramps === null || modified === null) return false;
    await db.runAsync(
      `INSERT INTO cycle_days (day, flow, cramps, modified) VALUES (?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET flow = excluded.flow, cramps = excluded.cramps, modified = excluded.modified
       WHERE excluded.modified > cycle_days.modified`,
      day,
      flow,
      cramps,
      modified,
    );
    return true;
  },
  async remove(db, id) {
    await db.runAsync('DELETE FROM cycle_days WHERE day = ?', id);
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// health_metrics: PK (type, ts). One record per type per UTC day (`<type>:<yyyy-mm-dd>`; UTC so every phone cuts the
// same days whatever its time zone), `rank` = number of rows so a fuller bundle beats a partial one. A day whose bundle
// would pass METRIC_BUNDLE_SPLIT_CHARS is sent as 24 hour bundles (`<type>:<day>:<hh>`). Pulled rows are merged:
// a missing row is inserted, a row the watch is still extending (`last_ts`) takes the larger `last_ts`.

interface MetricRow {
  ts: number;
  last_ts: number;
  value: number | null;
  values_json: string;
}

type MetricCells = [number, number, number | null, string];

const ID_PATTERN = /^(.+?):(\d{4}-\d{2}-\d{2})(?::(\d{2}))?$/;

function metricEntry(id: string, type: string, day: string, hour: number | null, rows: MetricCells[], now: number): Entry {
  const doc = hour === null ? { type, day, rows, n: rows.length } : { type, day, hour, rows, n: rows.length };
  return { id, json: JSON.stringify(doc), rank: rows.length, at: now };
}

async function metricDay(db: SQLiteDatabase, type: string, day: string, now: number): Promise<Entry[]> {
  const from = Date.parse(`${day}T00:00:00Z`) / 1000;
  const rows = await db.getAllAsync<MetricRow>(
    'SELECT ts, last_ts, value, values_json FROM health_metrics WHERE type = ? AND ts >= ? AND ts < ? ORDER BY ts',
    type,
    from,
    from + DAY_S,
  );
  if (rows.length === 0) return [];
  const cells = rows.map((row): MetricCells => [row.ts, row.last_ts, row.value, row.values_json]);
  const whole = metricEntry(`${type}:${day}`, type, day, null, cells, now);
  if (whole.json.length <= METRIC_BUNDLE_SPLIT_CHARS) return [whole];
  const byHour = new Map<number, MetricCells[]>();
  for (const cell of cells) {
    const hour = Math.floor((cell[0] - from) / 3600);
    const list = byHour.get(hour);
    if (list) list.push(cell);
    else byHour.set(hour, [cell]);
  }
  return [...byHour].map(([hour, list]) => metricEntry(`${type}:${day}:${String(hour).padStart(2, '0')}`, type, day, hour, list, now));
}

const metricSpec: KindSpec = {
  kind: 'metric',
  gated: false,
  windowed: true,
  tombstones: false,
  digest: true,
  async scan(db, fromSec, now, visit) {
    const from = Math.floor((fromSec ?? 0) / DAY_S) * DAY_S;
    const days = await db.getAllAsync<{ type: string; day: string }>(
      "SELECT DISTINCT type, strftime('%Y-%m-%d', ts, 'unixepoch') AS day FROM health_metrics WHERE ts >= ? AND instr(type, ':') = 0 ORDER BY day, type",
      from,
    );
    for (const { type, day } of days) for (const entry of await metricDay(db, type, day, now)) await visit(entry);
  },
  async build(db, id, now) {
    const match = ID_PATTERN.exec(id);
    if (!match) return null;
    const [, type, day] = match;
    const entries = await metricDay(db, type, day, now);
    return entries.find((entry) => entry.id === id) ?? null;
  },
  async around(db, id, now) {
    const match = ID_PATTERN.exec(id);
    return match ? metricDay(db, match[1], match[2], now) : [];
  },
  async apply(db, doc) {
    const rows = Array.isArray(doc.rows) ? doc.rows : [];
    const type = text(doc.type);
    if (type === null || type === '' || type.includes(':')) return false;
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const ts = int(row[0]);
      const lastTs = int(row[1]);
      const valuesJson = text(row[3]);
      if (ts === null || lastTs === null || valuesJson === null) continue;
      await db.runAsync(
        `INSERT INTO health_metrics (type, ts, last_ts, value, values_json) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(type, ts) DO UPDATE SET last_ts = excluded.last_ts, value = excluded.value, values_json = excluded.values_json
         WHERE excluded.last_ts > health_metrics.last_ts`,
        type,
        ts,
        Math.max(lastTs, ts),
        num(row[2]),
        valuesJson,
      );
    }
    return true;
  },
  async remove() {},
};

const SPECS: Record<HealthKind, KindSpec> = {
  hrv: hrvSpec,
  sleepscore: sleepScoreSpec,
  cycleperiod: periodSpec,
  cycleday: daySpec,
  metric: metricSpec,
};

// ---------------------------------------------------------------------------------------------------------------------
// Sync state

interface Mark {
  /** Unix seconds when the last scan started. */
  at: number;
  /** Rows older than this are never scanned: set when the phone's existing data is baselined (`baselineHealthSync`). */
  floor: number;
}

async function readMark(db: SQLiteDatabase, kind: HealthKind): Promise<Mark | null> {
  const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM sync_item WHERE kind = ? AND id = ?', MARK_KIND, kind);
  const doc = row ? parseDoc(row.json) : null;
  return doc ? { at: int(doc.at) ?? 0, floor: int(doc.floor) ?? 0 } : null;
}

async function writeMark(db: SQLiteDatabase, kind: HealthKind, mark: Mark): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_item (kind, id, json, updated_at, deleted_at, rank, dirty) VALUES (?, ?, ?, ?, NULL, 0, 0)
     ON CONFLICT (kind, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    MARK_KIND,
    kind,
    JSON.stringify(mark),
    mark.at * 1000,
  );
}

/** Stores a record as known to the cloud (clean), with the server's times. */
async function storeClean(db: SQLiteDatabase, record: Pick<WireRecord, 'kind' | 'id' | 'json' | 'updatedAt' | 'deletedAt' | 'rank'>): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_item (kind, id, json, updated_at, deleted_at, rank, dirty) VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT (kind, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at, rank = excluded.rank, dirty = 0`,
    record.kind,
    record.id,
    record.json,
    record.updatedAt,
    record.deletedAt,
    record.rank,
  );
}

async function deleteKindItems(db: SQLiteDatabase, kinds: readonly string[]): Promise<void> {
  for (const kind of kinds) {
    await db.runAsync('DELETE FROM sync_item WHERE kind = ?', kind);
    await db.runAsync('DELETE FROM sync_item WHERE kind = ? AND id = ?', MARK_KIND, kind);
  }
}

interface Gate {
  on: boolean;
  /** The cloud copies still have to be wiped (the switch went off while offline). */
  wipe: boolean;
}

async function readGate(db: SQLiteDatabase, kind: HealthKind): Promise<Gate | null> {
  const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM sync_item WHERE kind = ? AND id = ?', GATE_KIND, kind);
  const doc = row ? parseDoc(row.json) : null;
  return doc ? { on: doc.on === true, wipe: doc.wipe === true } : null;
}

async function writeGate(db: SQLiteDatabase, kind: HealthKind, gate: Gate): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_item (kind, id, json, updated_at, deleted_at, rank, dirty) VALUES (?, ?, ?, 0, NULL, 0, 0)
     ON CONFLICT (kind, id) DO UPDATE SET json = excluded.json`,
    GATE_KIND,
    kind,
    JSON.stringify(gate),
  );
}

export interface HealthOptions {
  /** Whether the cycle kinds sync (`cycleSyncEnabled()`); the other kinds always do. */
  cycleEnabled: () => boolean;
  /** Hard-deletes the cycle kinds in the cloud (`sync/wipe`). */
  wipeCycle: () => Promise<void>;
  now?: () => number;
}

/**
 * Whether `spec` takes part right now, and the state changes a switch implies: turning the cycle sync on again forgets
 * what the phone knew (the cloud copies were wiped), so every cycle row is a local change again; turning it off forgets
 * it too and retries a wipe that did not go through.
 */
async function gateOpen(db: SQLiteDatabase, spec: KindSpec, options: HealthOptions): Promise<boolean> {
  if (!spec.gated) return true;
  const on = options.cycleEnabled();
  const gate = await readGate(db, spec.kind);
  // A switch flipped by a pulled preference: the phone that flipped it wipes the cloud, this one only forgets.
  if (gate !== null && gate.on !== on) await deleteKindItems(db, [spec.kind]);
  if (gate === null || gate.on !== on) await writeGate(db, spec.kind, { on, wipe: false });
  if (!on) await retryWipe(db, options);
  return on;
}

/** The cycle wipe of a switch turned off here that did not go through (offline, signed out) is tried again. */
async function retryWipe(db: SQLiteDatabase, options: HealthOptions): Promise<void> {
  const pending = await Promise.all(CYCLE_KINDS.map((kind) => readGate(db, kind)));
  if (!pending.some((gate) => gate?.wipe)) return;
  try {
    await options.wipeCycle();
    for (const kind of CYCLE_KINDS) await writeGate(db, kind, { on: false, wipe: false });
  } catch {
    // Tried again on the next run.
  }
}

/**
 * The switch was turned on or off here. On: the cloud copies were wiped while it was off, so the phone forgets what it
 * knew and every cycle row is a local change again. Off: the same forgetting, and the cloud copies are wiped (retried
 * until it works).
 */
export async function setCycleGate(db: SQLiteDatabase, on: boolean, options: HealthOptions): Promise<void> {
  await deleteKindItems(db, CYCLE_KINDS);
  for (const kind of CYCLE_KINDS) await writeGate(db, kind, { on, wipe: !on });
  if (!on) await retryWipe(db, options);
}

async function refresh(db: SQLiteDatabase, spec: KindSpec, entry: Entry, remoteRank: number | null): Promise<void> {
  const state = await getItem(db, spec.kind, entry.id);
  const stored = spec.digest ? digestOf(entry.json) : entry.json;
  if (state !== null && state.deletedAt === null && state.json === stored) return;
  // A pulled bundle the phone merged rows into keeps the local, fuller version (higher rank) as a change; an equal-rank
  // difference (the same row with other values) stays as it is on both sides, or the two phones would send it back and forth.
  if (remoteRank !== null && entry.rank <= remoteRank && state !== null) {
    await storeClean(db, { kind: spec.kind, id: entry.id, json: stored, updatedAt: state.updatedAt, deletedAt: null, rank: state.rank });
    return;
  }
  await putLocalItem(db, spec.kind, entry.id, stored, entry.at, entry.rank);
}

async function scanKind(db: SQLiteDatabase, spec: KindSpec, now: number): Promise<void> {
  const nowSec = Math.floor(now / 1000);
  const mark = await readMark(db, spec.kind);
  const floor = Math.max(nowSec - SCAN_WINDOW_DAYS * DAY_S, mark?.floor ?? 0);
  const from = spec.windowed ? Math.max(floor, mark ? mark.at - SCAN_OVERLAP_DAYS * DAY_S : 0) : null;
  await spec.scan(db, from, now, (entry) => refresh(db, spec, entry, null));
  if (spec.tombstones) {
    const live = await db.getAllAsync<{ id: string }>('SELECT id FROM sync_item WHERE kind = ? AND deleted_at IS NULL', spec.kind);
    for (const { id } of live) if ((await spec.build(db, id, now)) === null) await putLocalItem(db, spec.kind, id, null, now);
  }
  await writeMark(db, spec.kind, { at: nowSec, floor: mark?.floor ?? 0 });
}

function adapterFor(db: SQLiteDatabase, spec: KindSpec, options: HealthOptions): RecordAdapter {
  const clock = options.now ?? Date.now;
  let scannedAt = -Infinity;
  return {
    kind: spec.kind,

    async listDirty(limit) {
      if (!(await gateOpen(db, spec, options))) return [];
      const now = clock();
      if (now - scannedAt >= SCAN_MIN_GAP_MS || now < scannedAt) {
        await scanKind(db, spec, now);
        scannedAt = now;
      }
      const dirty = await listDirtyItems(db, spec.kind, limit);
      if (!spec.digest) return dirty;
      // A bundle is rebuilt from the table at send time: the stored row only holds its digest.
      const out: WireRecord[] = [];
      for (const record of dirty) {
        const entry = await spec.build(db, record.id, now);
        if (entry === null) {
          await db.runAsync('DELETE FROM sync_item WHERE kind = ? AND id = ? AND dirty = 1', spec.kind, record.id);
          continue;
        }
        if (digestOf(entry.json) !== record.json) {
          await putLocalItem(db, spec.kind, record.id, digestOf(entry.json), entry.at, entry.rank);
          out.push({ kind: spec.kind, id: record.id, json: entry.json, updatedAt: entry.at, deletedAt: null, rank: entry.rank });
        } else {
          out.push({ ...record, json: entry.json, rank: entry.rank });
        }
      }
      return out;
    },

    async markPushed(sent, serverTimes) {
      const stored = spec.digest ? sent.map((record) => ({ ...record, json: digestOf(record.json) })) : sent;
      const byStored = new Map(stored.map((record, i) => [record, sent[i]]));
      await markItemsPushed(db, stored, (record) => serverTimes(byStored.get(record) ?? record));
    },

    async applyRemote(remote, skew) {
      if (!(await gateOpen(db, spec, options))) return false;
      const now = clock();
      const doc = remote.deletedAt === null ? parseDoc(remote.json) : null;
      if (remote.deletedAt === null && doc === null) return false;

      // The local row, if the phone has one the scan has not seen yet, takes part in the comparison as a local change.
      for (const entry of await spec.around(db, remote.id, now)) await refresh(db, spec, entry, null);
      const stored = spec.digest ? digestOf(remote.json) : remote.json;
      if (!remoteWins(await getItem(db, spec.kind, remote.id), { ...remote, json: stored }, skew)) return false;

      if (remote.deletedAt !== null) {
        await spec.remove(db, remote.id);
        await storeClean(db, { ...remote, json: stored });
        return true;
      }
      if (!(await spec.apply(db, doc as Record<string, unknown>))) return false;
      await storeClean(db, { ...remote, json: stored });
      for (const entry of await spec.around(db, remote.id, now)) {
        await refresh(db, spec, entry, entry.id === remote.id ? remote.rank : null);
      }
      return true;
    },
  };
}

export function createHealthAdapters(db: SQLiteDatabase, options: HealthOptions): RecordAdapter[] {
  return HEALTH_KINDS.map((kind) => adapterFor(db, SPECS[kind], options));
}

/** Refreshes the sync state of every enabled kind from the tables (what `listDirty` does first). */
export async function scanHealth(db: SQLiteDatabase, options: HealthOptions): Promise<void> {
  const now = (options.now ?? Date.now)();
  for (const kind of HEALTH_KINDS) {
    if (await gateOpen(db, SPECS[kind], options)) await scanKind(db, SPECS[kind], now);
  }
}

/** Changed here and not acknowledged yet, over the enabled kinds. */
export async function countDirtyHealth(db: SQLiteDatabase, options: HealthOptions): Promise<number> {
  const kinds = HEALTH_KINDS.filter((kind) => !SPECS[kind].gated || options.cycleEnabled());
  const marks = kinds.map(() => '?').join(', ');
  const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM sync_item WHERE dirty = 1 AND kind IN (${marks})`, ...kinds);
  return row?.n ?? 0;
}

/**
 * This phone's existing health rows are never uploaded: used when the phone is detached from an account, so the next
 * account does not receive what the previous one's phone held. Scans start from now on, and the cycle log (not
 * windowed) is recorded as known.
 */
export async function baselineHealthSync(db: SQLiteDatabase, now: number = Date.now()): Promise<void> {
  const nowSec = Math.floor(now / 1000);
  for (const kind of HEALTH_KINDS) {
    const spec = SPECS[kind];
    if (spec.windowed) {
      await writeMark(db, kind, { at: nowSec, floor: nowSec });
    } else {
      await spec.scan(db, null, now, (entry) => storeClean(db, { kind, id: entry.id, json: entry.json, updatedAt: entry.at, deletedAt: null, rank: entry.rank }));
      await writeMark(db, kind, { at: nowSec, floor: 0 });
    }
  }
}

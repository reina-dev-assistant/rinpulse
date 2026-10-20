import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * The watches this phone has used: the `device` table, one row per watch, with what migration 14 added (`alias`, `is_primary`,
 * `added_at`, `tracks_health`, `bg_sync`; docs/multi-watch.md). The native module writes the row when a watch connects
 * (`upsertDevice`) and reads `is_primary`, `tracks_health` and `bg_sync`; everything the person edits is written here.
 * Keys and the link are native (`HuaweiWear.forgetDevice`, `connect`).
 */
export interface WatchRow {
  /** The watch's Bluetooth address (a peripheral id on iOS): the id every stored row uses in its `device` column. */
  address: string;
  /** The Bluetooth name the watch reports. */
  name: string;
  /** What the person called it; null until renamed. */
  alias: string | null;
  productModel: string | null;
  /** Unix seconds of the last stored sync; null before the first. */
  lastSync: number | null;
  isPrimary: boolean;
  /** False for a watch whose steps, sleep, workouts and metrics are not stored (somebody else's band). */
  tracksHealth: boolean;
  /** Android: the background service visits this watch between the active watch's syncs. */
  bgSync: boolean;
}

interface RawWatch {
  address: string;
  name: string;
  alias: string | null;
  productModel: string | null;
  lastSync: number | null;
  isPrimary: number;
  tracksHealth: number;
  bgSync: number;
}

/** Longest name a person can give a watch. */
export const MAX_ALIAS_LENGTH = 30;

const COLUMNS = `address, name, alias, product_model AS productModel, last_sync AS lastSync,
  is_primary AS isPrimary, tracks_health AS tracksHealth, bg_sync AS bgSync`;

/** The primary first, then in the order the watches were added. */
export async function listWatches(db: SQLiteDatabase): Promise<WatchRow[]> {
  const rows = await db.getAllAsync<RawWatch>(
    `SELECT ${COLUMNS} FROM device ORDER BY is_primary DESC, COALESCE(added_at, 0), address`,
  );
  return rows.map((r) => ({
    address: r.address,
    name: r.name,
    alias: r.alias,
    productModel: r.productModel,
    lastSync: r.lastSync,
    isPrimary: r.isPrimary !== 0,
    tracksHealth: r.tracksHealth !== 0,
    bgSync: r.bgSync !== 0,
  }));
}

/** What the screens call a watch: the person's name for it, else the name it reports. */
export function watchLabel(watch: Pick<WatchRow, 'alias' | 'name' | 'address'>): string {
  return watch.alias?.trim() || watch.name.trim() || watch.address;
}

/** The alias to store: trimmed and cut to [MAX_ALIAS_LENGTH]; an empty text clears the alias. */
/** "Connect" when no watch is linked at all; "Switch to this watch" only while a different one is. */
export function watchActionKey(activeAddress: string | null, linkState: string): 'connect' | 'switchTo' {
  return activeAddress !== null && linkState !== 'disconnected' ? 'switchTo' : 'connect';
}

export function normalizeAlias(text: string): string | null {
  const alias = text.trim().slice(0, MAX_ALIAS_LENGTH).trim();
  return alias.length > 0 ? alias : null;
}

/** Gives the watch a name of the person's choosing; null or empty goes back to the name it reports. */
export async function renameWatch(db: SQLiteDatabase, address: string, alias: string | null): Promise<void> {
  await db.runAsync('UPDATE device SET alias = ? WHERE address = ?', alias === null ? null : normalizeAlias(alias), address);
}

/** Makes [address] the one watch that owns the all-day data; every other watch stops being primary. No-op for an unknown watch. */
export async function setPrimaryWatch(db: SQLiteDatabase, address: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    const known = await db.getFirstAsync<{ address: string }>('SELECT address FROM device WHERE address = ?', address);
    if (!known) return;
    await db.runAsync('UPDATE device SET is_primary = (address = ?) WHERE is_primary <> (address = ?)', address, address);
  });
}

export async function setBackgroundSync(db: SQLiteDatabase, address: string, on: boolean): Promise<void> {
  await db.runAsync('UPDATE device SET bg_sync = ? WHERE address = ?', on ? 1 : 0, address);
}

export async function setTracksHealth(db: SQLiteDatabase, address: string, on: boolean): Promise<void> {
  await db.runAsync('UPDATE device SET tracks_health = ? WHERE address = ?', on ? 1 : 0, address);
}

/**
 * Takes the watch out of the list. Its stored rows stay (they keep its address, and are shown as "removed watch"); when it was
 * the primary, the watch synced most recently takes over, so there is a primary whenever there is a watch.
 */
export async function removeWatchRow(db: SQLiteDatabase, address: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    const was = await db.getFirstAsync<{ isPrimary: number }>('SELECT is_primary AS isPrimary FROM device WHERE address = ?', address);
    if (!was) return;
    await db.runAsync('DELETE FROM device WHERE address = ?', address);
    if (was.isPrimary === 0) return;
    await db.runAsync(
      `UPDATE device SET is_primary = 1
       WHERE address = (SELECT address FROM device ORDER BY last_sync IS NULL, last_sync DESC, COALESCE(added_at, 0), address LIMIT 1)`,
    );
  });
}

/** The watch a stored workout came from: its address, or null when the row is imported or older than the attribution. */
export async function getWorkoutDevice(db: SQLiteDatabase, workoutId: number): Promise<string | null> {
  const row = await db.getFirstAsync<{ device: string | null }>('SELECT device FROM workouts WHERE id = ?', workoutId);
  return row?.device ?? null;
}

/**
 * The name for a stored row's `device`: the watch's label, "removed" for an address with no `device` row any more, and null for a
 * row without a source.
 */
export function sourceName(watches: readonly WatchRow[], device: string | null, removedLabel: string): string | null {
  if (device === null) return null;
  const known = watches.find((w) => w.address === device);
  return known ? watchLabel(known) : removedLabel;
}

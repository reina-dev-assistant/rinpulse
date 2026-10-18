import type { SQLiteDatabase } from 'expo-sqlite';

import { cloudLog as log } from '@/cloud/log';
import type { RecordAdapter, WireRecord } from '@/cloud/syncEngine';
import { applyRemoteItem, getItem, listDirtyItems, listItems, markItemsPushed, putLocalItem } from '@/cloud/syncItems';
import { restoreItem, setCleanJson, stableStringify, syncItemTable, utf8Bytes } from '@/cloud/syncSnapshot';
import { errorMessage } from '@/format';
import { onRouteChange } from '@/features/routes/routeChanges';
import {
  decodePoints,
  encodePoints,
  isRouteId,
  parseMeta,
  type StoredMeta,
  type StoredPoints,
} from '@/features/routes/routeStorage';
import type { TemplateStore } from '@/features/stickers/core/studio';
import {
  MAX_TEMPLATE_BYTES,
  createLocalTemplateStore,
  hasUserTemplate,
  onTemplateChange,
  readUserTemplate,
  type AsyncKv,
} from '@/features/stickers/studio/localStore';

/**
 * The things a person makes, as synced records (ns `fit`): Sticker Studio templates (`sticker`, id = template id, document =
 * the template as the store keeps it) and saved routes (`route`, id = route id, document = the facts file, thumbnail and the
 * points file's flat array). The things stay where the app keeps them; `sync_item` holds what the server last agreed on.
 *
 * Local edits are found two ways: the stores report each save, rename and delete (`onTemplateChange`, `onRouteChange`),
 * and a scan at sync time compares everything with the stored versions, which also finds what was changed before the first
 * sync of this run. A pulled record is written through the store and its stored version is rewritten from what the store
 * holds, so applying it is never taken for an edit.
 *
 * A route's `lastSentAt` (when it last went to a watch) belongs to this phone: it is left out of the document and a pulled route
 * keeps the local value.
 */

const STICKER = 'sticker';
const ROUTE = 'route';

/** What the server accepts for kind `route`; a route has at most 5 000 points, which is about 150 KB. */
export const MAX_ROUTE_BYTES = 256 * 1024;

export interface TemplateIo {
  store: TemplateStore;
  /** An entry is stored under this id even if `store.get` cannot read it (so it must not be taken for deleted). */
  exists(id: string): Promise<boolean>;
  watch(listener: (id: string) => void): () => void;
}

export interface RouteIo {
  /** Ids of the routes whose facts can be read. */
  ids(): Promise<string[]>;
  /** The facts, and when asked the points; null when either is missing or damaged. */
  read(id: string, withPoints: boolean): { meta: StoredMeta; pts: StoredPoints['pts'] | null } | null;
  /** Files of the route are on disk, readable or not. */
  exists(id: string): boolean;
  write(meta: StoredMeta, pts: StoredPoints['pts']): void;
  remove(id: string): Promise<void>;
  watch(listener: (id: string) => void): () => void;
}

export interface ContentIo {
  templates: TemplateIo;
  routes: RouteIo;
}

let native: Promise<ContentIo> | null = null;

/** The app's own stores. Loaded on first use: the kv-store and the file system are native, so unit tests pass their own `ContentIo`. */
export function nativeContentIo(): Promise<ContentIo> {
  native ??= (async () => {
    const [{ default: Storage }, routes] = await Promise.all([import('expo-sqlite/kv-store'), import('@/features/routes/routeStore')]);
    // The kv-store's `removeItem` answers whether the key existed; the template store does not care.
    const kv: AsyncKv = {
      getItem: (key) => Storage.getItem(key),
      setItem: (key, value) => Storage.setItem(key, value),
      removeItem: async (key) => void (await Storage.removeItem(key)),
    };
    return {
      templates: {
        store: createLocalTemplateStore(kv),
        exists: (id) => hasUserTemplate(kv, id),
        watch: onTemplateChange,
      },
      routes: {
        ids: async () => (await routes.listRoutes()).map((route) => route.id),
        read: routes.readStoredRoute,
        exists: routes.routeFilesExist,
        write: routes.writeStoredRoute,
        remove: routes.deleteRoute,
        watch: onRouteChange,
      },
    };
  })();
  return native;
}

type GetIo = () => Promise<ContentIo>;

/** `<kind>:<id>` of records being applied from the account right now: the stores report those writes too, and they are not edits. */
const applying = new Set<string>();
const reportedSkips = new Set<string>();

function skipOnce(kind: string, id: string, why: string): void {
  if (reportedSkips.has(`${kind}:${id}`)) return;
  reportedSkips.add(`${kind}:${id}`);
  log(`${kind} ${id} stays on this phone: ${why}`, 'error');
}

// Sticker Studio templates

async function scanTemplate(db: SQLiteDatabase, io: TemplateIo, id: string, now: number): Promise<void> {
  const local = await io.store.get(id);
  const row = await getItem(db, STICKER, id);
  if (!local) {
    if (row && row.deletedAt === null && !(await io.exists(id))) await putLocalItem(db, STICKER, id, null, now);
    return;
  }
  const json = stableStringify(local);
  if (row && row.deletedAt === null && row.json === json) return;
  if (utf8Bytes(json) > MAX_TEMPLATE_BYTES) {
    skipOnce(STICKER, id, `over ${MAX_TEMPLATE_BYTES} bytes`);
    return;
  }
  await putLocalItem(db, STICKER, id, json, now);
}

async function scanTemplates(db: SQLiteDatabase, io: TemplateIo, knownOnly: boolean): Promise<void> {
  const now = Date.now();
  const ids = new Set((await listItems(db, STICKER)).filter((row) => row.deletedAt === null).map((row) => row.id));
  if (!knownOnly) for (const template of await io.store.list()) ids.add(template.id);
  for (const id of ids) await scanTemplate(db, io, id, now);
}

async function applyTemplate(db: SQLiteDatabase, io: TemplateIo, remote: WireRecord, skew: number): Promise<boolean> {
  const template = remote.deletedAt === null ? readUserTemplate(remote.json) : null;
  if (remote.deletedAt === null && (!template || template.id !== remote.id)) return false;
  const previous = await getItem(db, STICKER, remote.id);
  if (!(await applyRemoteItem(db, remote, skew))) return false;
  const key = `${STICKER}:${remote.id}`;
  applying.add(key);
  try {
    if (template) {
      await io.store.put(template);
      const stored = await io.store.get(remote.id);
      if (stored) await setCleanJson(db, STICKER, remote.id, stableStringify(stored));
    } else {
      await io.store.remove(remote.id);
    }
    return true;
  } catch (error) {
    await restoreItem(db, STICKER, remote.id, previous);
    log(`sticker ${remote.id} not applied: ${errorMessage(error)}`, 'error');
    return false;
  } finally {
    applying.delete(key);
  }
}

// Routes

/** The route's own facts without what is this phone's alone. */
function syncedFacts(meta: StoredMeta) {
  const { lastSentAt: _lastSentAt, ...route } = meta.route;
  return { route, thumb: meta.thumb };
}

function routeDocument(meta: StoredMeta, pts: StoredPoints['pts']): string {
  return stableStringify({ v: 1, ...syncedFacts(meta), pts });
}

function documentOf(json: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
  } catch {
    return null;
  }
}

function metaOf(doc: Record<string, unknown>): StoredMeta | null {
  return parseMeta({ v: 1, route: doc.route, thumb: doc.thumb });
}

/** The facts part of a stored document, in the form `syncedFacts` gives; null when it is not a route document. */
function factsOf(json: string): string | null {
  const doc = documentOf(json);
  const meta = doc && metaOf(doc);
  return meta ? stableStringify(syncedFacts(meta)) : null;
}

async function scanRoute(db: SQLiteDatabase, io: RouteIo, id: string, now: number): Promise<void> {
  const local = io.read(id, false);
  const row = await getItem(db, ROUTE, id);
  if (!local) {
    if (row && row.deletedAt === null && !io.exists(id)) await putLocalItem(db, ROUTE, id, null, now);
    return;
  }
  if (row && row.deletedAt === null && factsOf(row.json) === stableStringify(syncedFacts(local.meta))) return;
  const whole = io.read(id, true);
  if (!whole?.pts) {
    skipOnce(ROUTE, id, 'its points file cannot be read');
    return;
  }
  const json = routeDocument(whole.meta, whole.pts);
  if (utf8Bytes(json) > MAX_ROUTE_BYTES) {
    skipOnce(ROUTE, id, `over ${MAX_ROUTE_BYTES} bytes`);
    return;
  }
  await putLocalItem(db, ROUTE, id, json, now);
}

async function scanRoutes(db: SQLiteDatabase, io: RouteIo, knownOnly: boolean): Promise<void> {
  const now = Date.now();
  const ids = new Set((await listItems(db, ROUTE)).filter((row) => row.deletedAt === null).map((row) => row.id));
  if (!knownOnly) for (const id of await io.ids()) ids.add(id);
  for (const id of ids) await scanRoute(db, io, id, now);
}

/** A pulled route document as the stores keep it; null when it is not a usable route. */
function parseRoute(remote: WireRecord): { meta: StoredMeta; pts: StoredPoints['pts'] } | null {
  const doc = documentOf(remote.json);
  const meta = doc && metaOf(doc);
  const points = doc && decodePoints({ pts: doc.pts });
  if (!meta || meta.route.id !== remote.id || !isRouteId(remote.id) || !points || points.length < 2) return null;
  return { meta, pts: encodePoints(points) };
}

async function applyRoute(db: SQLiteDatabase, io: RouteIo, remote: WireRecord, skew: number): Promise<boolean> {
  const route = remote.deletedAt === null ? parseRoute(remote) : null;
  if (remote.deletedAt === null && !route) return false;
  if (remote.deletedAt !== null && !isRouteId(remote.id)) return false;
  const previous = await getItem(db, ROUTE, remote.id);
  if (!(await applyRemoteItem(db, remote, skew))) return false;
  const key = `${ROUTE}:${remote.id}`;
  applying.add(key);
  try {
    if (route) {
      const sent = io.read(remote.id, false)?.meta.route.lastSentAt ?? null;
      io.write({ ...route.meta, route: { ...route.meta.route, lastSentAt: sent } }, route.pts);
      await setCleanJson(db, ROUTE, remote.id, routeDocument(route.meta, route.pts));
    } else {
      await io.remove(remote.id);
    }
    return true;
  } catch (error) {
    await restoreItem(db, ROUTE, remote.id, previous);
    log(`route ${remote.id} not applied: ${errorMessage(error)}`, 'error');
    return false;
  } finally {
    applying.delete(key);
  }
}

// Adapters

/** One adapter. `scan` runs before the first `listDirty` of the run; later rounds of the same run skip it. */
function contentAdapter(db: SQLiteDatabase, kind: string, scan: () => Promise<void>, apply: (remote: WireRecord, skew: number) => Promise<boolean>): RecordAdapter {
  let scanned = false;
  return {
    kind,
    async listDirty(limit) {
      await syncItemTable(db);
      if (!scanned) {
        scanned = true;
        await scan();
      }
      return listDirtyItems(db, kind, limit);
    },
    async markPushed(sent, serverTimes) {
      await markItemsPushed(db, sent, serverTimes);
    },
    async applyRemote(remote, skew) {
      await syncItemTable(db);
      return apply(remote, skew);
    },
  };
}

let stopWatching: (() => void)[] = [];
let watching: Promise<void> = Promise.resolve();
const pendingStamps = new Set<Promise<void>>();

/** Resolves once the store listeners are attached and every edit they were told about has been recorded. */
export async function settleContentEdits(): Promise<void> {
  await watching;
  await Promise.all([...pendingStamps]);
}

/** Stamps a reported edit at once; stores' own writes of pulled records are ignored. */
async function watchStores(db: SQLiteDatabase, getIo: GetIo): Promise<void> {
  const io = await getIo();
  const stamp = (kind: string, id: string, scan: (now: number) => Promise<void>) => {
    if (applying.has(`${kind}:${id}`)) return;
    const task: Promise<void> = syncItemTable(db)
      .then(() => scan(Date.now()))
      .catch((error: unknown) => log(`${kind} ${id} edit not recorded: ${errorMessage(error)}`, 'error'))
      .finally(() => pendingStamps.delete(task));
    pendingStamps.add(task);
  };
  for (const stop of stopWatching) stop();
  stopWatching = [
    io.templates.watch((id) => stamp(STICKER, id, (now) => scanTemplate(db, io.templates, id, now))),
    io.routes.watch((id) => stamp(ROUTE, id, (now) => scanRoute(db, io.routes, id, now))),
  ];
}

/** Adapters for Sticker Studio templates and routes; also starts listening to the stores for local edits. */
export function contentAdapters(db: SQLiteDatabase, getIo: GetIo = nativeContentIo): RecordAdapter[] {
  watching = watchStores(db, getIo).catch((error: unknown) => log(`content edits not watched: ${errorMessage(error)}`, 'error'));
  return [
    contentAdapter(
      db,
      STICKER,
      async () => scanTemplates(db, (await getIo()).templates, false),
      async (remote, skew) => applyTemplate(db, (await getIo()).templates, remote, skew),
    ),
    contentAdapter(
      db,
      ROUTE,
      async () => scanRoutes(db, (await getIo()).routes, false),
      async (remote, skew) => applyRoute(db, (await getIo()).routes, remote, skew),
    ),
  ];
}

/**
 * Records the edits made to templates and routes that already have a stored version, before a pull: a pulled version never
 * replaces a local edit nobody had noticed. Things without a stored version are left to the scan after the pull.
 */
export async function stampContentEdits(db: SQLiteDatabase, getIo: GetIo = nativeContentIo): Promise<void> {
  await syncItemTable(db);
  await settleContentEdits();
  const io = await getIo();
  await scanTemplates(db, io.templates, true);
  await scanRoutes(db, io.routes, true);
}

/**
 * Marks every template and route this phone holds as already synced, without ever uploading it: clean, older than any real
 * edit, so the account's version wins on a pull. For "keep this phone's data but do not send it to the account that signs in".
 * A route is baselined by its facts alone (no points): nothing is ever pushed from a clean row.
 */
export async function baselineContent(db: SQLiteDatabase, getIo: GetIo = nativeContentIo): Promise<void> {
  await syncItemTable(db);
  const io = await getIo();
  const put = (kind: string, id: string, json: string) =>
    db.runAsync(
      `INSERT INTO sync_item (kind, id, json, updated_at, deleted_at, rank, dirty) VALUES (?, ?, ?, 0, NULL, 0, 0)
       ON CONFLICT (kind, id) DO UPDATE SET json = excluded.json, updated_at = 0, deleted_at = NULL, rank = 0, dirty = 0`,
      kind,
      id,
      json,
    );
  for (const template of await io.templates.store.list()) {
    const json = stableStringify(template);
    if (utf8Bytes(json) <= MAX_TEMPLATE_BYTES) await put(STICKER, template.id, json);
  }
  for (const id of await io.routes.ids()) {
    const local = io.routes.read(id, false);
    if (local) await put(ROUTE, id, stableStringify({ v: 1, ...syncedFacts(local.meta) }));
  }
}

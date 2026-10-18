import { beforeAll, describe, expect, spyOn, test } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  MAX_ROUTE_BYTES,
  baselineContent,
  contentAdapters,
  settleContentEdits,
  stampContentEdits,
  type ContentIo,
  type RouteIo,
} from '@/cloud/contentSync';
import { runSync } from '@/cloud/syncEngine';
import { ensureSyncItemSchema, getItem } from '@/cloud/syncItems';
import { FakeSyncServer, openMemoryDb } from '@/cloud/syncTestKit';
import { notifyRouteChange, onRouteChange } from '@/features/routes/routeChanges';
import type { RouteDraft, RoutePoint } from '@/features/routes/routeModel';
import { buildRoute, cleanRouteName, encodePoints, newRouteId, type StoredMeta, type StoredPoints } from '@/features/routes/routeStorage';
import { parseTemplate } from '@/features/stickers/core/parse';
import { createUserTemplate, type TemplateStore, type UserTemplate } from '@/features/stickers/core/studio';
import { kit, template } from '@/features/stickers/templates/dsl';
import {
  MAX_TEMPLATE_BYTES,
  createLocalTemplateStore,
  hasUserTemplate,
  onTemplateChange,
  type AsyncKv,
} from '@/features/stickers/studio/localStore';

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);
const clock = { t: T0 };

interface Phone {
  db: SQLiteDatabase;
  cursor: number;
  now: () => number;
  kv: AsyncKv & { map: Map<string, string> };
  templates: TemplateStore;
  routes: Map<string, { meta: StoredMeta; pts: StoredPoints['pts'] }>;
  io: ContentIo;
  /** Route facts as the app's `markRouteSent` changes them: no change report, no edit. */
  markSent(id: string, at: number): void;
}

beforeAll(() => {
  spyOn(Date, 'now').mockImplementation(() => clock.t);
});

async function newPhone(): Promise<Phone> {
  const { db } = openMemoryDb();
  await ensureSyncItemSchema(db);
  const map = new Map<string, string>();
  const kv = {
    map,
    getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: string) => void map.set(key, value),
    removeItem: async (key: string) => void map.delete(key),
  };
  const routes = new Map<string, { meta: StoredMeta; pts: StoredPoints['pts'] }>();
  const routeIo: RouteIo = {
    ids: async () => [...routes.keys()],
    read: (id, withPoints) => {
      const entry = routes.get(id);
      return entry ? { meta: entry.meta, pts: withPoints ? entry.pts : null } : null;
    },
    exists: (id) => routes.has(id),
    write: (meta, pts) => void routes.set(meta.route.id, { meta, pts }),
    remove: async (id) => {
      routes.delete(id);
      notifyRouteChange(id);
    },
    watch: onRouteChange,
  };
  const templates = createLocalTemplateStore(kv);
  return {
    db,
    cursor: 0,
    now: () => clock.t,
    kv,
    templates,
    routes,
    io: {
      templates: { store: templates, exists: (id) => hasUserTemplate(kv, id), watch: onTemplateChange },
      routes: routeIo,
    },
    markSent(id, at) {
      const entry = routes.get(id);
      if (entry) entry.meta = { ...entry.meta, route: { ...entry.meta.route, lastSentAt: at } };
    },
  };
}

const flush = settleContentEdits;

/** Binds the content adapters to this phone (as a sync does) and lets the store listeners attach. */
async function bind(phone: Phone) {
  const adapters = contentAdapters(phone.db, async () => phone.io);
  await flush();
  return adapters;
}

async function sync(server: FakeSyncServer, phone: Phone) {
  const adapters = await bind(phone);
  await stampContentEdits(phone.db, async () => phone.io);
  const report = await runSync(server.io(phone), adapters);
  clock.t += 5_000;
  return report;
}

function baseTemplate() {
  const k = kit('s');
  return parseTemplate(
    template({
      id: 'run.bold.story',
      name: 'Run, bold',
      kind: 'run',
      style: 'bold',
      aspect: 'story',
      background: { kind: 'color', color: '$bg' },
      dark: {},
      light: {},
      layers: [k.text({ x: 72, y: 300, w: 600 }, '{run.sport}')],
    }),
  ).template;
}

let counter = 0;
const fork = (name: string): UserTemplate => createUserTemplate(baseTemplate(), name, clock.t, () => `abcd${String(++counter).padStart(4, '0')}`);

const at = (lat: number, lon: number, alt: number | null = null): RoutePoint => ({ lat, lon, alt });
const draft = (name: string, n = 40): RouteDraft => ({
  name,
  source: 'drawn',
  points: Array.from({ length: n }, (_, i) => at(-8 + i * 0.0004, 112 + Math.sin(i / 5) * 0.001, 500 + (i % 7))),
});

/** What `routeStore.saveRoute` does: build, store, report. */
function saveRoute(phone: Phone, name: string, n = 40) {
  const { meta, points } = buildRoute(draft(name, n), newRouteId(clock.t), clock.t, 'too few', 'Untitled');
  phone.routes.set(meta.route.id, { meta, pts: encodePoints(points) });
  notifyRouteChange(meta.route.id);
  return meta.route.id;
}

/** What `routeStore.renameRoute` does. */
function renameRoute(phone: Phone, id: string, name: string) {
  const entry = phone.routes.get(id);
  if (!entry) return;
  entry.meta = { ...entry.meta, route: { ...entry.meta.route, name: cleanRouteName(name) } };
  notifyRouteChange(id);
}

const dirty = async (phone: Phone, kind: string, id: string) => (await getItem(phone.db, kind, id))?.dirty ?? false;

describe('Sticker Studio templates across two phones', () => {
  test('create, edit and delete on A reach B', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const b = await newPhone();
    await bind(a);
    const first = fork('First');
    await a.templates.put(first);
    await flush();
    // The store reported the save: the edit is stamped before any sync ran.
    expect(await dirty(a, 'sticker', first.id)).toBe(true);

    expect((await sync(server, a)).pushed).toBe(1);
    expect((await sync(server, b)).applied).toBe(1);
    expect((await b.templates.get(first.id))?.name).toBe('First');

    clock.t += 10_000;
    await bind(a);
    await a.templates.put({ ...first, name: 'First, renamed', updatedAt: clock.t });
    await flush();
    await sync(server, a);
    await sync(server, b);
    expect((await b.templates.get(first.id))?.name).toBe('First, renamed');

    clock.t += 10_000;
    await bind(a);
    await a.templates.remove(first.id);
    await flush();
    expect((await getItem(a.db, 'sticker', first.id))?.deletedAt).not.toBeNull();
    await sync(server, a);
    await sync(server, b);
    expect(await b.templates.get(first.id)).toBeUndefined();
    expect(await b.templates.list()).toEqual([]);
  });

  test('applying a pulled template is not an edit', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const b = await newPhone();
    await a.templates.put(fork('Shared'));
    await sync(server, a);
    await sync(server, b);
    await flush();
    const [stored] = await b.templates.list();
    expect(await dirty(b, 'sticker', stored!.id)).toBe(false);
    expect((await sync(server, b)).pushed).toBe(0);
  });

  test('templates made before the first sync go up, and the account lists them on a new phone', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    await a.templates.put(fork('One'));
    await a.templates.put(fork('Two'));
    expect((await sync(server, a)).pushed).toBe(2);
    const b = await newPhone();
    expect((await sync(server, b)).applied).toBe(2);
    expect((await b.templates.list()).map((t) => t.name).sort()).toEqual(['One', 'Two']);
  });

  test('an edit nobody reported is not replaced by an older pulled version', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const b = await newPhone();
    const shared = fork('Shared');
    await a.templates.put(shared);
    await sync(server, a);
    await sync(server, b);

    // B edits straight in its kv-store (no listener attached), A edits earlier and syncs first.
    clock.t += 10_000;
    await a.templates.put({ ...shared, name: 'From A', updatedAt: clock.t });
    await sync(server, a);
    clock.t += 10_000;
    await b.kv.setItem('joyofit.stickers.user.t.' + shared.id, JSON.stringify({ ...shared, name: 'From B', updatedAt: clock.t }));
    await sync(server, b);
    await sync(server, a);
    expect((await a.templates.get(shared.id))?.name).toBe('From B');
  });

  test('a template that no longer parses is not taken for deleted', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const kept = fork('Kept');
    await a.templates.put(kept);
    await sync(server, a);
    await a.kv.setItem('joyofit.stickers.user.t.' + kept.id, '{"id":"' + kept.id + '","template":{"schemaVersion":99}');
    expect(await a.templates.get(kept.id)).toBeUndefined();
    await sync(server, a);
    expect((await getItem(a.db, 'sticker', kept.id))?.deletedAt).toBeNull();
  });

  test('a template over 64 KB of UTF-8 stays on the phone without an error', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const small = fork('Small');
    await a.templates.put(small);
    // The store counts characters, the server bytes: this one passes the store's check but is 80 KB encoded.
    const big: UserTemplate = { ...fork('Big'), name: 'é'.repeat(MAX_TEMPLATE_BYTES / 2 + 8_000) };
    const store: TemplateStore = {
      ...a.templates,
      list: async () => [...(await a.templates.list()), big],
      get: async (id) => (id === big.id ? big : a.templates.get(id)),
    };
    a.io.templates.store = store;
    const report = await sync(server, a);
    expect(report.pushed).toBe(1);
    expect(server.rows.has('sticker\u0000' + small.id)).toBe(true);
    expect(server.rows.has('sticker\u0000' + big.id)).toBe(false);
    expect(await getItem(a.db, 'sticker', big.id)).toBeNull();
  });
});

describe('routes across two phones', () => {
  test('create, rename and delete on A reach B, with the points', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const b = await newPhone();
    await bind(a);
    const id = saveRoute(a, 'Lari sore');
    await flush();
    expect(await dirty(a, 'route', id)).toBe(true);
    expect((await sync(server, a)).pushed).toBe(1);
    expect((await sync(server, b)).applied).toBe(1);
    const onB = b.routes.get(id);
    expect(onB?.meta.route.name).toBe('Lari sore');
    expect(onB?.pts).toEqual(a.routes.get(id)?.pts);
    expect(onB?.meta.thumb).toEqual(a.routes.get(id)?.meta.thumb);

    clock.t += 10_000;
    await bind(a);
    renameRoute(a, id, 'Lari pagi');
    await flush();
    await sync(server, a);
    await sync(server, b);
    expect(b.routes.get(id)?.meta.route.name).toBe('Lari pagi');

    clock.t += 10_000;
    await bind(a);
    await a.io.routes.remove(id);
    await flush();
    await sync(server, a);
    await sync(server, b);
    expect(b.routes.has(id)).toBe(false);
  });

  test('lastSentAt is this phone\'s own: never uploaded, never replaced by a pulled route', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const b = await newPhone();
    const id = saveRoute(a, 'Gowes');
    a.markSent(id, 111);
    await sync(server, a);
    expect(JSON.parse(server.rows.get('route\u0000' + id)!.json).route.lastSentAt).toBeUndefined();

    await sync(server, b);
    expect(b.routes.get(id)?.meta.route.lastSentAt).toBeNull();
    b.markSent(id, 222);
    // Marking a route as sent is not an edit.
    expect((await sync(server, b)).pushed).toBe(0);

    clock.t += 10_000;
    await bind(a);
    renameRoute(a, id, 'Gowes pagi');
    await flush();
    await sync(server, a);
    await sync(server, b);
    expect(b.routes.get(id)?.meta.route.name).toBe('Gowes pagi');
    expect(b.routes.get(id)?.meta.route.lastSentAt).toBe(222);
    expect(a.routes.get(id)?.meta.route.lastSentAt).toBe(111);
  });

  test('applying a pulled route is not an edit', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const b = await newPhone();
    const id = saveRoute(a, 'Satu');
    await sync(server, a);
    await sync(server, b);
    await flush();
    expect(await dirty(b, 'route', id)).toBe(false);
    expect((await sync(server, b)).pushed).toBe(0);
  });

  test('a route over 256 KB is skipped, and the others still go up', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const small = saveRoute(a, 'Kecil');
    // More points than the store ever keeps: a damaged or foreign file.
    const { meta } = buildRoute(draft('Raksasa', 60), 'huge-route', clock.t, 'too few', 'Untitled');
    const pts = Array.from({ length: 3 * 12_000 }, (_, i) => (i % 3 === 2 ? null : 100.123456 + i * 0.000001));
    a.routes.set('huge-route', { meta: { ...meta, route: { ...meta.route, pointCount: 12_000 } }, pts });
    const report = await sync(server, a);
    expect(report.pushed).toBe(1);
    expect(server.rows.has('route\u0000' + small)).toBe(true);
    expect(server.rows.has('route\u0000huge-route')).toBe(false);
    expect(JSON.stringify(pts).length).toBeGreaterThan(MAX_ROUTE_BYTES);
    expect(await getItem(a.db, 'route', 'huge-route')).toBeNull();
  });

  test('a route whose points file is damaged is not uploaded and not taken for deleted', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const id = saveRoute(a, 'Rusak');
    await sync(server, a);
    const entry = a.routes.get(id)!;
    // Points gone, facts still readable: the cloud copy stays as it is.
    a.io.routes.read = (_id, withPoints) => (withPoints ? null : { meta: entry.meta, pts: null });
    renameRoute(a, id, 'Rusak lagi');
    await sync(server, a);
    expect(JSON.parse(server.rows.get('route\u0000' + id)!.json).route.name).toBe('Rusak');
    expect((await getItem(a.db, 'route', id))?.deletedAt).toBeNull();
  });
});

describe('detaching', () => {
  test('a baseline keeps what is on the phone from going up, and later edits still do', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const kept = fork('Old account');
    await a.templates.put(kept);
    const routeId = saveRoute(a, 'Old route');
    await baselineContent(a.db, async () => a.io);
    expect(await dirty(a, 'sticker', kept.id)).toBe(false);
    expect((await sync(server, a)).pushed).toBe(0);
    expect(server.rows.size).toBe(0);

    clock.t += 10_000;
    await bind(a);
    await a.templates.put({ ...kept, name: 'New edit', updatedAt: clock.t });
    renameRoute(a, routeId, 'New name');
    await flush();
    expect((await sync(server, a)).pushed).toBe(2);
  });
});

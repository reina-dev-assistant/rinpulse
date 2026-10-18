import { afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  MAX_PREF_BYTES,
  baselinePrefs,
  listPrefItems,
  notePrefChanged,
  prefsAdapter,
  registerSyncedPref,
  resetSyncedPrefs,
  stampPrefEdits,
  subscribePrefApplied,
  syncedPrefKeys,
} from '@/cloud/prefsSync';
import { runSync } from '@/cloud/syncEngine';
import { ensureSyncItemSchema, getItem } from '@/cloud/syncItems';
import { FakeSyncServer, openMemoryDb } from '@/cloud/syncTestKit';

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);
const clock = { t: T0 };
const HOUR = 3_600_000;

interface Phone {
  db: SQLiteDatabase;
  cursor: number;
  /** This phone's clock minus the server's. */
  offset: number;
  /** The settings as this phone stores them. */
  kv: Map<string, unknown>;
  /** Keys `write` was called with, in order. */
  writes: string[];
  now: () => number;
}

let active: Phone;
let phoneCount = 0;

async function newPhone(offset = 0): Promise<Phone> {
  const { db } = openMemoryDb();
  await ensureSyncItemSchema(db);
  phoneCount += 1;
  return { db, cursor: 0, offset, kv: new Map(), writes: [], now: () => clock.t + offset };
}

/** Every phone shares the module's registry, so each stub reads and writes whichever phone is acting. */
function stub(key: string, options: { moves?: string[]; keepOnReset?: boolean; sideEffect?: (value: unknown, phone: Phone) => void } = {}) {
  registerSyncedPref({
    key,
    moves: options.moves,
    keepOnReset: options.keepOnReset,
    read: async () => (active.kv.has(key) ? active.kv.get(key) : undefined),
    write: async (value) => {
      if (key === 'broken') throw new Error('cannot apply');
      active.writes.push(key);
      active.kv.set(key, value);
      options.sideEffect?.(value, active);
    },
    clear: async () => void active.kv.delete(key),
  });
}

beforeAll(() => {
  spyOn(Date, 'now').mockImplementation(() => clock.t + (active?.offset ?? 0));
  stub('theme', { keepOnReset: true });
  stub('goals', {
    moves: ['profile'],
    // The ring's steps goal is the profile's too: writing one moves the other, as the native module does.
    sideEffect: (value, phone) => {
      if (typeof value === 'object' && value !== null && 'steps' in value) phone.kv.set('profile', { steps: value.steps });
    },
  });
  stub('profile');
  stub('sync.cycle');
  stub('broken');
  stub('big');
  for (let i = 0; i < 12; i++) stub(`flag.${i}`);
});

afterEach(() => {
  clock.t += 60_000;
});

/** One run of the record sync as the app does it for preferences: stamp known edits, then pull and push. */
async function sync(server: FakeSyncServer, phone: Phone) {
  active = phone;
  const adapter = prefsAdapter(phone.db);
  await stampPrefEdits(phone.db);
  const report = await runSync(server.io(phone), [adapter]);
  clock.t += 5_000;
  return report;
}

async function edit(phone: Phone, key: string, value: unknown) {
  active = phone;
  prefsAdapter(phone.db);
  if (value === undefined) phone.kv.delete(key);
  else phone.kv.set(key, value);
  await notePrefChanged(key);
  clock.t += 1_000;
}

const dirty = async (phone: Phone, key: string) => (await getItem(phone.db, 'pref', key))?.dirty ?? false;

describe('preferences across two phones', () => {
  test('a value set on A appears on B, and an edit on B comes back to A', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const b = await newPhone();
    await edit(a, 'theme', 'ocean');
    expect((await sync(server, a)).pushed).toBe(1);
    expect((await sync(server, b)).applied).toBe(1);
    expect(b.kv.get('theme')).toBe('ocean');

    await edit(b, 'theme', 'sport');
    await sync(server, b);
    await sync(server, a);
    expect(a.kv.get('theme')).toBe('sport');
  });

  test('applying a pulled value is not a local edit: the next sync pushes nothing', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const b = await newPhone();
    await edit(a, 'profile', { steps: 8000 });
    await sync(server, a);
    await sync(server, b);
    expect(await dirty(b, 'profile')).toBe(false);
    const again = await sync(server, b);
    expect(again.pushed).toBe(0);
  });

  test('a reset to the default is a tombstone and clears the other phone', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const b = await newPhone();
    await edit(a, 'sync.cycle', false);
    await sync(server, a);
    await sync(server, b);
    expect(b.kv.get('sync.cycle')).toBe(false);

    await edit(a, 'sync.cycle', undefined);
    await sync(server, a);
    expect((await getItem(a.db, 'pref', 'sync.cycle'))?.deletedAt).not.toBeNull();
    await sync(server, b);
    expect(b.kv.has('sync.cycle')).toBe(false);
    expect((await sync(server, b)).pushed).toBe(0);
  });

  test('with two edits of one setting the later one wins on both phones', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const b = await newPhone();
    await edit(a, 'theme', 'ocean');
    await sync(server, a);
    await sync(server, b);

    await edit(a, 'theme', 'classic');
    await edit(b, 'theme', 'sport');
    await sync(server, b);
    await sync(server, a);
    await sync(server, b);
    expect(a.kv.get('theme')).toBe('sport');
    expect(b.kv.get('theme')).toBe('sport');
  });

  test('a phone with its clock an hour behind still loses to a later edit elsewhere, and wins with its own later edit', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const b = await newPhone(-HOUR);
    await edit(a, 'theme', 'ocean');
    await sync(server, a);
    await sync(server, b);

    // B's edit is 3 s after A's sync in real time, but its own clock reads an hour earlier than A's edit.
    await edit(b, 'theme', 'sport');
    await sync(server, b);
    await sync(server, a);
    expect(a.kv.get('theme')).toBe('sport');

    await edit(a, 'theme', 'classic');
    await sync(server, a);
    await sync(server, b);
    expect(b.kv.get('theme')).toBe('classic');
  });

  test('a first sign-in restores every preference the account has, and the phone keeps what the account lacks', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    for (let i = 0; i < 12; i++) await edit(a, `flag.${i}`, i % 2 === 0);
    await sync(server, a);

    const fresh = await newPhone();
    // Set before this phone ever synced: nothing reported them, so the account's copy wins where it has one.
    fresh.kv.set('theme', 'ocean');
    fresh.kv.set('flag.3', 'phone value');
    const report = await sync(server, fresh);
    expect(report.applied).toBe(12);
    for (let i = 0; i < 12; i++) expect(fresh.kv.get(`flag.${i}`)).toBe(i % 2 === 0);
    // The account's value won where it had one; the key it did not have went up.
    expect(fresh.kv.get('flag.3')).toBe(false);
    expect(server.rows.get('pref\u0000theme')).toBeDefined();
    expect(await dirty(fresh, 'flag.3')).toBe(false);
    expect((await sync(server, fresh)).pushed).toBe(0);
  });

  test('defaults are never uploaded', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const report = await sync(server, a);
    expect(report.pushed).toBe(0);
    expect(server.rows.size).toBe(0);
  });

  test('a free account keeps its changes waiting and pushes them once it is Pro', async () => {
    const server = new FakeSyncServer(() => clock.t, false);
    const a = await newPhone();
    await edit(a, 'theme', 'ocean');
    const locked = await sync(server, a);
    expect(locked.locked).toBe(true);
    expect(await dirty(a, 'theme')).toBe(true);
    server.pro = true;
    expect((await sync(server, a)).pushed).toBe(1);
    expect(await dirty(a, 'theme')).toBe(false);
  });

  test('an edit nobody reported is found at sync time, before a pulled value could replace it', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const b = await newPhone();
    await edit(a, 'theme', 'ocean');
    await sync(server, a);
    await sync(server, b);

    // B changes the theme without telling `notePrefChanged`; A changes it earlier.
    await edit(a, 'theme', 'classic');
    await sync(server, a);
    clock.t += 10_000;
    b.kv.set('theme', 'sport');
    await sync(server, b);
    await sync(server, a);
    expect(a.kv.get('theme')).toBe('sport');
  });

  test('a record whose write fails is left alone and the sync goes on', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const b = await newPhone();
    await edit(a, 'broken', 1);
    await edit(a, 'theme', 'ocean');
    await sync(server, a);
    const report = await sync(server, b);
    expect(report.applied).toBe(1);
    expect(b.kv.get('theme')).toBe('ocean');
    expect(await getItem(b.db, 'pref', 'broken')).toBeNull();
  });

  test('a key this build does not register is skipped', async () => {
    const server = new FakeSyncServer(() => clock.t);
    server.push(clock.t, [{ kind: 'pref', id: 'from.the.future', json: '{"value":1}', updatedAt: clock.t, deletedAt: null, rank: 0 }]);
    const b = await newPhone();
    const report = await sync(server, b);
    expect(report.pulled).toBe(1);
    expect(report.applied).toBe(0);
    expect(await listPrefItems(b.db)).toEqual([]);
  });

  test('a value over the 8 KB cap stays on the phone', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    await edit(a, 'big', 'x'.repeat(MAX_PREF_BYTES));
    const report = await sync(server, a);
    expect(report.pushed).toBe(0);
    expect(await getItem(a.db, 'pref', 'big')).toBeNull();
  });

  test('applying one setting that moves another does not turn the other into an edit', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const b = await newPhone();
    await edit(a, 'profile', { steps: 8000 });
    await sync(server, a);
    await sync(server, b);

    // Only the goals record changes on A; on B, writing it also moves the profile (as `setActivityGoals` does).
    a.kv.set('profile', { steps: 9000 });
    await edit(a, 'goals', { steps: 9000 });
    a.kv.set('profile', { steps: 8000 });
    await sync(server, a);
    await sync(server, b);
    expect(b.kv.get('profile')).toEqual({ steps: 9000 });
    expect(await dirty(b, 'profile')).toBe(false);
    expect((await sync(server, b)).pushed).toBe(0);
  });
});

describe('registry helpers', () => {
  test('notePrefChanged stamps the edit as dirty at once, in the phone clock', async () => {
    const a = await newPhone(-HOUR);
    await edit(a, 'theme', 'ocean');
    const row = await getItem(a.db, 'pref', 'theme');
    expect(row?.dirty).toBe(true);
    expect(row?.json).toBe('{"value":"ocean"}');
    expect(row?.updatedAt).toBe(clock.t - 1_000 - HOUR);
  });

  test('the live-apply listener runs for a pulled value, not for a local edit', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const a = await newPhone();
    const b = await newPhone();
    const seen: string[] = [];
    const stop = subscribePrefApplied('theme', () => seen.push(b.kv.get('theme') as string));
    await edit(a, 'theme', 'ocean');
    await sync(server, a);
    expect(seen).toEqual([]);
    await sync(server, b);
    expect(seen).toEqual(['ocean']);
    stop();
  });

  test('reset sends every preference to its default except the ones that stay with the phone', async () => {
    const a = await newPhone();
    active = a;
    a.kv.set('theme', 'ocean');
    a.kv.set('profile', { steps: 1 });
    a.kv.set('sync.cycle', false);
    await resetSyncedPrefs();
    expect([...a.kv.keys()]).toEqual(['theme']);
  });

  test('a baseline marks what the phone holds as synced without uploading it, and the account still wins', async () => {
    const server = new FakeSyncServer(() => clock.t);
    const other = await newPhone();
    await edit(other, 'theme', 'sport');
    await sync(server, other);

    const a = await newPhone();
    await edit(a, 'theme', 'ocean');
    await edit(a, 'profile', { steps: 5000 });
    active = a;
    await baselinePrefs(a.db);
    expect(await dirty(a, 'profile')).toBe(false);
    const report = await sync(server, a);
    expect(report.pushed).toBe(0);
    expect(a.kv.get('theme')).toBe('sport');
    expect(server.rows.has('pref\u0000profile')).toBe(false);

    // Later edits go up as usual.
    await edit(a, 'profile', { steps: 6000 });
    expect((await sync(server, a)).pushed).toBe(1);
  });

  test('the registry lists the stub keys sorted', () => {
    expect(syncedPrefKeys().slice(0, 3)).toEqual(['big', 'broken', 'flag.0']);
    expect(phoneCount).toBeGreaterThan(0);
  });
});

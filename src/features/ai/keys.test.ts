import { describe, expect, test } from 'bun:test';

import { grantConsent } from './consent';
import { createInsightStore } from './insight';
import { cleanPastedKey, createKeyVault, keyName, maskKey } from './keyVault';
import { memoryKv, memorySecrets } from './kv';
import { createChatStore } from './conversations';
import { createNotesStore } from './memory';
import { PERSON_CACHE_KEY } from './person';
import { deleteEverything, deleteMemory, removeProvider, type ResetDeps } from './reset';
import { createSettingsStore } from './settings';
import { PROVIDER_IDS } from './types';
import { createUsageStore } from './usage';

const KEY = 'sk-or-v1-SUPERSECRETKEY0123456789';

function world() {
  const kv = memoryKv();
  const secrets = memorySecrets();
  const deps: ResetDeps = {
    kv,
    settings: createSettingsStore(kv),
    vault: createKeyVault(secrets),
    notes: createNotesStore(kv),
    insights: createInsightStore(kv),
    usage: createUsageStore(kv),
    chats: createChatStore(kv),
  };
  deps.chats.create('hai');
  return { kv, secrets, deps };
}

async function connect(w: ReturnType<typeof world>, provider: 'openrouter' | 'openai' = 'openrouter') {
  await w.deps.vault.set(provider, KEY);
  w.deps.settings.update((s) => ({ engine: 'byok', provider, keySaved: { ...s.keySaved, [provider]: true as const }, insightDaily: true }));
  grantConsent(w.deps.settings, provider, 'https://openrouter.ai/api/v1', 1);
  w.deps.notes.add('Target 10K');
  w.deps.insights.put('daily', { key: '2026-10-22', locale: 'id', text: 'Ringkasan' });
  w.deps.usage.record(1_792_000_000, { inputTokens: 10, outputTokens: 2 });
}

describe('key handling', () => {
  test('the key lives only in the secure store: nothing the app writes to the kv-store contains it', async () => {
    const w = world();
    await connect(w);
    expect(JSON.stringify(w.kv.dump())).not.toContain('SUPERSECRET');
    expect(JSON.stringify(w.deps.settings.get())).not.toContain('SUPERSECRET');
    expect(Object.values(w.secrets.dump())).toEqual([KEY]);
  });

  test('the secure store name is valid for expo-secure-store and per provider', () => {
    for (const p of PROVIDER_IDS) expect(keyName(p)).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(new Set(PROVIDER_IDS.map(keyName)).size).toBe(PROVIDER_IDS.length);
  });

  test('every kv key Joyo AI writes is under joyofit.ai., the namespace the sync code does not register', async () => {
    const w = world();
    await connect(w);
    for (const k of Object.keys(w.kv.dump())) expect(k.startsWith('joyofit.ai.')).toBe(true);
  });

  test('the key is shown masked and pasted keys are cleaned', () => {
    expect(maskKey(KEY)).toBe('sk-...6789');
    expect(maskKey('short')).not.toContain('short');
    expect(cleanPastedKey('  Bearer sk-abc \n def "')).toBe('sk-abcdef');
    expect(cleanPastedKey('"sk-abc"')).toBe('sk-abc');
  });

  test('"Hapus kunci" removes the key, withdraws the consent, clears cached insights and falls back to the hosted engine', async () => {
    const w = world();
    await connect(w);
    await removeProvider('openrouter', w.deps);
    expect(w.secrets.dump()).toEqual({});
    const s = w.deps.settings.get();
    expect(s).toMatchObject({ engine: 'rogo', provider: null, insightDaily: false });
    expect(s.keySaved).toEqual({});
    expect(s.consents).toEqual({});
    expect(w.deps.insights.get('daily', '2026-10-22', 'id')).toBeNull();
    // notes are memory, not the key: they stay until deleted on their own
    expect(w.deps.notes.list()).toHaveLength(1);
  });

  test('removing a provider that is not in use leaves the one in use alone', async () => {
    const w = world();
    await connect(w, 'openai');
    await connect(w, 'openrouter');
    await removeProvider('openai', w.deps);
    expect(w.deps.settings.get()).toMatchObject({ engine: 'byok', provider: 'openrouter' });
    expect(await w.deps.vault.get('openrouter')).toBe(KEY);
    expect(await w.deps.vault.get('openai')).toBeNull();
  });

  test('"Hapus catatan dan percakapan" clears notes, chat and insights but not the key', async () => {
    const w = world();
    await connect(w);
    deleteMemory(w.deps);
    expect(w.deps.notes.list()).toEqual([]);
    expect(w.deps.chats.list()).toEqual([]);
    expect(w.deps.insights.get('daily', '2026-10-22', 'id')).toBeNull();
    expect(await w.deps.vault.get('openrouter')).toBe(KEY);
  });

  test('delete everything leaves no key, no setting, no note, no counter', async () => {
    const w = world();
    await connect(w);
    await deleteEverything(w.deps);
    expect(w.secrets.dump()).toEqual({});
    expect(w.kv.dump()).toEqual({});
    expect(w.deps.settings.get().engine).toBe('rogo');
  });

  test('delete everything also drops the cached JoyoRogo profile (age, goal, targets)', async () => {
    const w = world();
    await connect(w);
    w.kv.setItem(PERSON_CACHE_KEY, '{"at":1,"birthYear":1990}');
    await deleteEverything(w.deps);
    expect(w.kv.getItem(PERSON_CACHE_KEY)).toBeNull();
  });
});

describe('notes (Catatan coach)', () => {
  test('at most 20 notes of 200 characters, flattened, no duplicates, edit and delete', () => {
    const w = world();
    const notes = w.deps.notes;
    expect(notes.add('   ')).toEqual({ ok: false, reason: 'empty' });
    const added = notes.add(`Lutut kiri\nnyeri ${'x'.repeat(300)}`);
    expect(added.ok && added.notes[0]!.text.length).toBe(200);
    expect(notes.list()[0]!.text).not.toContain('\n');
    expect(notes.add('LUTUT KIRI NYERI')).toMatchObject({ ok: true });
    for (let i = 0; i < 25; i++) notes.add(`catatan ${i}`);
    expect(notes.list()).toHaveLength(20);
    expect(notes.add('satu lagi')).toEqual({ ok: false, reason: 'full' });
    const id = notes.list()[1]!.id;
    expect(notes.update(id, 'diubah')).toMatchObject({ ok: true });
    expect(notes.list()[1]!.text).toBe('diubah');
    expect(notes.update('missing', 'x')).toEqual({ ok: false, reason: 'missing' });
    notes.remove(id);
    expect(notes.list().some((n) => n.id === id)).toBe(false);
  });

  test('a damaged stored value is an empty list, not a crash', () => {
    const kv = memoryKv();
    kv.setItem('joyofit.ai.notes', '{oops');
    expect(createNotesStore(kv).list()).toEqual([]);
    kv.setItem('joyofit.ai.notes', JSON.stringify([{ id: 1 }, 'x']));
    expect(createNotesStore(kv).list()).toEqual([]);
  });
});

describe('usage counter', () => {
  test('counts calls and tokens for today and starts again the next day', () => {
    const usage = createUsageStore(memoryKv());
    const day1 = 1_792_000_000;
    usage.record(day1, { inputTokens: 1000, outputTokens: 50 });
    usage.record(day1, null);
    expect(usage.today(day1)).toMatchObject({ calls: 2, inputTokens: 1000, outputTokens: 50 });
    expect(usage.today(day1 + 2 * 86400)).toMatchObject({ calls: 0, inputTokens: 0 });
  });
});

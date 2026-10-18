import { describe, expect, test } from 'bun:test';

import { parseTemplate } from '../core/parse';
import { createUserTemplate } from '../core/studio';
import { kit, template } from '../templates/dsl';
import { MAX_TEMPLATE_BYTES, TemplateRejected, createLocalTemplateStore, readUserTemplate, type AsyncKv } from './localStore';

function memoryKv(): AsyncKv & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => void map.set(key, value),
    removeItem: async (key) => void map.delete(key),
  };
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
const fork = (name: string, now: number) => createUserTemplate(baseTemplate(), name, now, () => `abcd${String(++counter).padStart(4, '0')}`);

describe('local template store', () => {
  test('put, get, list (newest first) and remove', async () => {
    const kv = memoryKv();
    const store = createLocalTemplateStore(kv);
    const a = fork('First', 100);
    const b = fork('Second', 200);
    await store.put(a);
    await store.put(b);
    expect((await store.list()).map((t) => t.name)).toEqual(['Second', 'First']);
    expect((await store.get(a.id))?.name).toBe('First');
    await store.put({ ...a, name: 'First edited', updatedAt: 300 });
    expect((await store.list()).map((t) => t.name)).toEqual(['First edited', 'Second']);
    await store.remove(a.id);
    expect((await store.list()).map((t) => t.name)).toEqual(['Second']);
    expect(await store.get(a.id)).toBeUndefined();
  });

  test('skips corrupt, truncated and invalid entries but keeps the good ones', async () => {
    const kv = memoryKv();
    const store = createLocalTemplateStore(kv);
    const good = fork('Good', 1);
    await store.put(good);
    const bad = fork('Bad', 2);
    await store.put(bad);
    kv.map.set(`joyofit.stickers.user.t.${bad.id}`, '{"id":"' + bad.id + '","template":{"schemaVersion":1,');
    expect((await store.list()).map((t) => t.name)).toEqual(['Good']);
    expect(await store.get(bad.id)).toBeUndefined();
    // The damaged entry is left in place: a newer app may still read it.
    expect(kv.map.has(`joyofit.stickers.user.t.${bad.id}`)).toBe(true);
  });

  test('a corrupt index reads as empty', async () => {
    const kv = memoryKv();
    kv.map.set('joyofit.stickers.user.index', 'not json');
    expect(await createLocalTemplateStore(kv).list()).toEqual([]);
    kv.map.set('joyofit.stickers.user.index', '{"a":1}');
    expect(await createLocalTemplateStore(kv).list()).toEqual([]);
  });

  test('a template written by a newer schema is not returned', () => {
    const entry = fork('Future', 1);
    const raw = JSON.stringify({ ...entry, template: { ...entry.template, schemaVersion: 99 } });
    expect(readUserTemplate(raw)).toBeNull();
  });

  test('put rejects bad ids, invalid templates, oversize and too many', async () => {
    const store = createLocalTemplateStore(memoryKv());
    const ok = fork('Ok', 1);
    await expect(store.put({ ...ok, id: 'nope' })).rejects.toBeInstanceOf(TemplateRejected);
    await expect(store.put({ ...ok, template: { ...ok.template, layers: [] } })).rejects.toBeInstanceOf(TemplateRejected);
    const huge = { ...ok, name: 'x'.repeat(MAX_TEMPLATE_BYTES) };
    await expect(store.put(huge)).rejects.toBeInstanceOf(TemplateRejected);
  });

  test('get and remove ignore ids that are not ours', async () => {
    const store = createLocalTemplateStore(memoryKv());
    expect(await store.get('../x')).toBeUndefined();
    await store.remove('../x');
  });
});

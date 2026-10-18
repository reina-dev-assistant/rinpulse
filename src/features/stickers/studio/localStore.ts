/**
 * Sticker Studio storage, local first: user templates as JSON in the app's key-value store. There is no editor UI yet; this
 * is the persistence the editor ops in `core/studio.ts` will write to. It is defensive on purpose, because the stored value
 * outlives app versions: an entry that no longer parses (hand-edited, truncated, written by a newer schema) is skipped, never
 * thrown, and is left in storage so a later app version can still read it.
 */
import { parseTemplate } from '../core/parse';
import type { TemplateStore, UserTemplate } from '../core/studio';

/** The slice of `expo-sqlite/kv-store` the store needs, so tests run on a Map. */
export interface AsyncKv {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const INDEX_KEY = 'joyofit.stickers.user.index';
const ENTRY_PREFIX = 'joyofit.stickers.user.t.';

/** Most templates a person can keep, and the largest one (bytes of JSON), so a runaway editor cannot fill the store. */
export const MAX_USER_TEMPLATES = 200;
export const MAX_TEMPLATE_BYTES = 64 * 1024;

export class TemplateRejected extends Error {}

/** `u-` + 12 chars of the id charset the schema allows. */
function validId(id: string): boolean {
  return /^u-[a-z0-9]{4,32}$/.test(id);
}

async function readIndex(kv: AsyncKv): Promise<string[]> {
  try {
    const raw = await kv.getItem(INDEX_KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && validId(id)) : [];
  } catch {
    return [];
  }
}

/** A stored entry as a usable `UserTemplate`, or null when it is not one. */
export function readUserTemplate(raw: string | null): UserTemplate | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    if (!('template' in value) || !('id' in value) || typeof value.id !== 'string' || !validId(value.id)) return null;
    const parsed = parseTemplate(value.template);
    if (parsed.degraded) return null;
    const entry = value as Partial<UserTemplate>;
    return {
      id: value.id,
      schemaVersion: parsed.template.schemaVersion,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 80) : parsed.template.name,
      baseId: typeof entry.baseId === 'string' ? entry.baseId : undefined,
      kind: parsed.template.kind,
      template: parsed.template,
      createdAt: typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt) ? entry.createdAt : 0,
      updatedAt: typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
      sync: entry.sync === 'cloud' || entry.sync === 'cloud-pending' ? entry.sync : 'local',
    };
  } catch {
    return null;
  }
}

type ChangeListener = (id: string) => void;
const changeListeners = new Set<ChangeListener>();

/**
 * Calls `listener` with the id of every template a store saved or removed, after the write. The cloud sync uses it to stamp the
 * edit. Returns the function that stops listening.
 */
export function onTemplateChange(listener: ChangeListener): () => void {
  changeListeners.add(listener);
  return () => void changeListeners.delete(listener);
}

function changed(id: string): void {
  for (const listener of changeListeners) listener(id);
}

/** An entry is stored under this id, readable or not: `list` and `get` skip one that does not parse, but it is not deleted. */
export async function hasUserTemplate(kv: AsyncKv, id: string): Promise<boolean> {
  return validId(id) && (await kv.getItem(ENTRY_PREFIX + id)) !== null;
}

export function createLocalTemplateStore(kv: AsyncKv): TemplateStore {
  return {
    async list() {
      const ids = await readIndex(kv);
      const entries = await Promise.all(ids.map(async (id) => readUserTemplate(await kv.getItem(ENTRY_PREFIX + id))));
      return entries.filter((entry): entry is UserTemplate => entry !== null).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async get(id) {
      if (!validId(id)) return undefined;
      return readUserTemplate(await kv.getItem(ENTRY_PREFIX + id)) ?? undefined;
    },
    async put(template) {
      if (!validId(template.id)) throw new TemplateRejected(`bad template id: ${template.id}`);
      if (parseTemplate(template.template).degraded) throw new TemplateRejected('template does not validate');
      const json = JSON.stringify(template);
      if (json.length > MAX_TEMPLATE_BYTES) throw new TemplateRejected('template is too large');
      const ids = await readIndex(kv);
      if (!ids.includes(template.id)) {
        if (ids.length >= MAX_USER_TEMPLATES) throw new TemplateRejected('too many templates');
        ids.push(template.id);
        await kv.setItem(ENTRY_PREFIX + template.id, json);
        await kv.setItem(INDEX_KEY, JSON.stringify(ids));
        changed(template.id);
        return;
      }
      await kv.setItem(ENTRY_PREFIX + template.id, json);
      changed(template.id);
    },
    async remove(id) {
      if (!validId(id)) return;
      const ids = await readIndex(kv);
      await kv.setItem(INDEX_KEY, JSON.stringify(ids.filter((known) => known !== id)));
      await kv.removeItem(ENTRY_PREFIX + id);
      changed(id);
    },
  };
}

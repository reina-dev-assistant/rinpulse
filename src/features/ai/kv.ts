/**
 * The two stores Joyo AI uses, as interfaces so the logic runs in tests without native modules:
 *  - `KvStore`: plain settings and history on the phone (the app binds the SQLite kv-store, see `stores.ts`).
 *  - `SecretStore`: the API key (the app binds expo-secure-store: Keychain / Keystore).
 * Neither is ever read by the sync code (`syncInventory.ts` lists Joyo AI as not synced).
 */
export interface KvStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SecretStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** In-memory stores for tests. */
export function memoryKv(): KvStore & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

export function memorySecrets(): SecretStore & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItemAsync: async (key) => map.get(key) ?? null,
    setItemAsync: async (key, value) => void map.set(key, value),
    deleteItemAsync: async (key) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

/** Reads JSON the app wrote itself; a damaged value is the fallback, never an error. */
export function readJson<T>(kv: KvStore, key: string, fallback: T, valid: (value: unknown) => value is T): T {
  try {
    const raw = kv.getItem(key);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

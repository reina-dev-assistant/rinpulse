import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';

import { createChatStore } from './conversations';
import { clearRogoCache } from './data/rogoData';
import { createInsightStore } from './insight';
import { createKeyVault } from './keyVault';
import type { KvStore, SecretStore } from './kv';
import { createNotesStore } from './memory';
import { deleteEverything, deleteMemory, removeProvider, type ResetDeps } from './reset';
import { createSettingsStore } from './settings';
import { createUsageStore } from './usage';
import type { ProviderId } from './types';

/** The phone's own stores for Joyo AI. `joyofit.ai.*` in the kv-store is not registered with the sync code (`syncInventory.ts`), and the key is only in the secure store. */
const kv: KvStore = {
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
  removeItem: (key) => Storage.removeItemSync(key),
};

/** Keys stay on this device: not in iCloud Keychain, not in a backup, not on a new phone. */
const secrets: SecretStore = {
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
};

export const aiKv = kv;
export const aiSettings = createSettingsStore(kv);
export const aiVault = createKeyVault(secrets);
export const aiNotes = createNotesStore(kv);
export const aiUsage = createUsageStore(kv);
export const aiInsights = createInsightStore(kv);
export const aiChats = createChatStore(kv);

const resetDeps: ResetDeps = { kv, settings: aiSettings, vault: aiVault, notes: aiNotes, insights: aiInsights, usage: aiUsage, chats: aiChats };

/** "Hapus kunci" for one provider (also withdraws its consent and clears cached insights). */
export const aiRemoveProvider = (provider: ProviderId): Promise<void> => removeProvider(provider, resetDeps);
/** "Hapus catatan dan percakapan". */
export const aiDeleteMemory = (): void => deleteMemory(resetDeps);
/** Everything Joyo AI keeps on the phone. */
export const aiDeleteEverything = async (): Promise<void> => {
  clearRogoCache();
  await deleteEverything(resetDeps);
};

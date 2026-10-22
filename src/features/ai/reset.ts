import type { ChatStore } from './conversations';
import type { KeyVault } from './keyVault';
import type { KvStore } from './kv';
import type { NotesStore } from './memory';
import { revokeConsent } from './consent';
import type { InsightStore } from './insight';
import { PERSON_CACHE_KEY } from './person';
import type { SettingsStore } from './settings';
import { PROVIDER_IDS, type ProviderId } from './types';
import type { UsageStore } from './usage';

export interface ResetDeps {
  kv: KvStore;
  settings: SettingsStore;
  vault: KeyVault;
  notes: NotesStore;
  insights: InsightStore;
  usage: UsageStore;
  /** Every saved conversation. */
  chats: ChatStore;
}

/**
 * Removes one provider: its key from the secure store, the consent for it and the cached insights (withdrawing the consent deletes
 * what was generated from it). When it was the provider in use, the chat goes back to the hosted engine until a new one is set up.
 */
export async function removeProvider(provider: ProviderId, deps: ResetDeps): Promise<void> {
  await deps.vault.delete(provider);
  revokeConsent(deps.settings, provider);
  deps.insights.clear();
  deps.settings.update((s) => {
    const { [provider]: _key, ...keySaved } = s.keySaved;
    const active = s.provider === provider;
    return { keySaved, provider: active ? null : s.provider, engine: active ? 'rogo' : s.engine, insightDaily: active ? false : s.insightDaily, insightWeekly: active ? false : s.insightWeekly };
  });
}

/** "Hapus kunci": same as removing the provider in use. */
export const deleteKey = removeProvider;

/** The notes, the saved conversation and the cached insights, kept apart from the key so "forget my notes" does not log the person out of their provider. */
export function deleteMemory(deps: Pick<ResetDeps, 'notes' | 'insights' | 'chats'>): void {
  deps.notes.clear();
  deps.insights.clear();
  deps.chats.clearAll();
}

/** Everything Joyo AI keeps on this phone: every key, consent, setting, note, conversation, insight, counter and the cached JoyoRogo profile. */
export async function deleteEverything(deps: ResetDeps): Promise<void> {
  await Promise.all(PROVIDER_IDS.map((p) => deps.vault.delete(p)));
  deleteMemory(deps);
  deps.usage.clear();
  deps.kv.removeItem(PERSON_CACHE_KEY);
  deps.settings.reset();
}

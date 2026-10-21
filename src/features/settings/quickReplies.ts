import Storage from 'expo-sqlite/kv-store';

import { notePrefChanged } from '@/cloud/prefsSync';
import { getLocale } from '@/i18n';
import { FALLBACK_LIMITS, defaultReplies, normalizeReplies, parseReplies, type QuickReplyLimits } from '@/features/settings/quickRepliesList';
import { HuaweiWear, hasNative } from '@/wear';

/** The list the user saved; absent while they never edited it (the screen shows the defaults, the watch keeps what it has). */
const KEY = 'joyofit.quickReplies';
/** The synced preference's key: never renamed once released (`syncInventory.ts`). */
export const QUICK_REPLIES_PREF = 'quickreplies';

export async function getSavedReplies(): Promise<string[] | null> {
  const raw = await Storage.getItem(KEY);
  if (raw === null) return null;
  try {
    return parseReplies(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** What the editor starts with: the saved list or the defaults of the app's language. */
export async function currentReplies(): Promise<string[]> {
  return (await getSavedReplies()) ?? defaultReplies(getLocale());
}

/** The connected watch's limits and whether it takes quick replies at all; false on a binary without the feature and on iOS. */
export function quickRepliesSupport(): { supported: boolean; limits: QuickReplyLimits } {
  if (!hasNative('getQuickReplies')) return { supported: false, limits: FALLBACK_LIMITS };
  const status = HuaweiWear.getQuickReplies();
  return {
    supported: status.supported,
    limits: status.slots > 0 && status.maxLength > 0 ? { slots: status.slots, maxLength: status.maxLength } : FALLBACK_LIMITS,
  };
}

/** Hands the list to the native side, which sends it now or at the next connect. A binary without the function does nothing. */
async function pushToWatch(replies: string[]): Promise<boolean> {
  if (!hasNative('setQuickReplies')) return false;
  return HuaweiWear.setQuickReplies(replies);
}

/** Saves (already validated) replies, follows the account and sends them to the watch. Resolves true when they reached the watch now. */
export async function saveReplies(replies: readonly string[]): Promise<boolean> {
  const list = normalizeReplies(replies);
  await Storage.setItem(KEY, JSON.stringify(list));
  void notePrefChanged(QUICK_REPLIES_PREF);
  return pushToWatch(list);
}

/** Back to the defaults of the app's language: forgets the saved list and sends the defaults. */
export async function resetReplies(): Promise<boolean> {
  await Storage.removeItem(KEY);
  void notePrefChanged(QUICK_REPLIES_PREF);
  return pushToWatch(defaultReplies(getLocale()));
}

/** Applies a list pulled from another phone: stored and sent, a failure to send (no watch, old binary) is not an error. */
export async function applyPulledReplies(value: unknown): Promise<void> {
  const list = normalizeReplies(parseReplies(value));
  await Storage.setItem(KEY, JSON.stringify(list));
  await pushToWatch(list).catch(() => false);
}

export async function clearPulledReplies(): Promise<void> {
  await Storage.removeItem(KEY);
}

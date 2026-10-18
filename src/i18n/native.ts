import Storage from 'expo-sqlite/kv-store';

import { notePrefChanged } from '@/cloud/prefsSync';

import { applyLocale } from './core';
import { deviceLanguages, isLocalePref, resolveLocale, type LocalePref } from './locale';

// Native-only half of i18n (the kv-store is not importable in unit tests). Language, first match wins:
//   1. the "Bahasa" choice in Settings (Indonesia / English), stored on the device,
//   2. the phone's language,
//   3. Indonesian.
// "Otomatis" stores nothing, so people who never chose follow the phone, even after they change it.

const KEY = 'joyofit.locale';

/** The stored Settings choice; `auto` when none. Synchronous: the kv-store reads without a round trip. */
export function getLocalePref(): LocalePref {
  try {
    const value = Storage.getItemSync(KEY);
    return isLocalePref(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

/** Applies the stored choice (or the phone language). Runs once at startup, before the first screen. */
export function initLocale(): void {
  const pref = getLocalePref();
  void applyLocale(resolveLocale({ pref, device: deviceLanguages() }));
}

/** Settings: pin a language or follow the phone. Applies at once and is remembered. */
export function setLocalePref(pref: LocalePref): void {
  try {
    if (pref === 'auto') Storage.removeItemSync(KEY);
    else Storage.setItemSync(KEY, pref);
  } catch {
    // Applied for this session even when the write fails.
  }
  void applyLocale(resolveLocale({ pref, device: deviceLanguages() }));
  void notePrefChanged('locale');
}

/** Re-resolves after the phone language changed (app returns to the foreground). No-op when pinned. */
export function refreshAutoLocale(): void {
  if (getLocalePref() === 'auto') void applyLocale(resolveLocale({ device: deviceLanguages() }));
}

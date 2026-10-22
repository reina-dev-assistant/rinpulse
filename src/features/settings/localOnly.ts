import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

/**
 * Local-only mode: this phone is the whole app.
 *
 * Rinpulse is used by one person on one phone. Everything it does — watch sync, health, sleep, workouts,
 * plans, Coach, the own-key AI — runs on this device, so the JoyoRogo account is only ever needed for the
 * parts that are *stored on their server* (cloud backup, the hosted AI engine, Family, the social feed).
 *
 * With this on, every sign-in surface is hidden: the account rows, the "Masuk" buttons in Settings, the
 * setup guide, the social/family gates, and the Coach gate (Coach itself is rule-based and lives on the
 * phone, so there is nothing to unlock). It does not fake a session.
 *
 * Default: **on.** A self-built APK is a local app; turning it off is for someone who wants the account
 * features back, and the switch is in Settings > Advanced.
 */
const KEY = 'rinpulse.localOnly';

const listeners = new Set<() => void>();
let cached = true;
let read = false;

export function localOnlyMode(): boolean {
  if (!read) {
    try {
      cached = Storage.getItemSync(KEY) !== '0';
    } catch {
      cached = true;
    }
    read = true;
  }
  return cached;
}

export function setLocalOnlyMode(enabled: boolean): void {
  cached = enabled;
  read = true;
  Storage.setItemSync(KEY, enabled ? '1' : '0');
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The live value. The tab bar and the Settings rows hide themselves with this, so flipping the switch in
 * Settings > Advanced takes effect at once instead of on the next launch.
 */
export function useLocalOnlyMode(): boolean {
  return useSyncExternalStore(subscribe, localOnlyMode, localOnlyMode);
}

/** Tests only: forget the cached value and drop every subscriber so the next read hits the store. */
export function resetLocalOnlyCache(): void {
  read = false;
  listeners.clear();
}

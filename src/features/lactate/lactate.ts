/** The saved time-trial result (kv store `joyofit.lactateTest`), shown in Kebugaran and offered to the zones. */
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import { parseLactateTest, type LactateValue } from './values';

const KEY = 'joyofit.lactateTest';

const listeners = new Set<() => void>();
let cache: { raw: string | null; value: LactateValue | null } | null = null;

/** The saved time-trial result; null when none (or something unreadable) is stored. */
export function getLactateTest(): LactateValue | null {
  const raw = Storage.getItemSync(KEY);
  if (cache?.raw !== raw) cache = { raw, value: parseLactateTest(raw) };
  return cache.value;
}

export function saveLactateTest(value: Omit<LactateValue, 'source'>): void {
  Storage.setItemSync(KEY, JSON.stringify({ lthr: value.lthr, paceSecKm: value.paceSecKm, at: value.at, workoutId: value.workoutId }));
  for (const listener of listeners) listener();
}

export function clearLactateTest(): void {
  Storage.removeItemSync(KEY);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLactateTest(): LactateValue | null {
  return useSyncExternalStore(subscribe, getLactateTest);
}

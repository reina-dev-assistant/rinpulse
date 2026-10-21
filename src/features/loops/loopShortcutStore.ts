/** Whether the Workouts tab still shows the "New loop from home" card. Local only: it is a choice about this phone's screen. */
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

const KEY = 'joyofit.workouts.loopShortcutDismissed';

let current: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  current ??= Storage.getItemSync(KEY) === '1';
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function dismiss(): void {
  if (read()) return;
  current = true;
  Storage.setItemSync(KEY, '1');
  for (const l of [...listeners]) l();
}

/** `[dismissed, dismiss]`; the card stays gone once closed, and Loop remains in the Start workout sheet. */
export function useLoopShortcutDismissed(): [boolean, () => void] {
  return [useSyncExternalStore(subscribe, read, read), dismiss];
}

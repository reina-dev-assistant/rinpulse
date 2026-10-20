/** Storage of `homeCards.ts` in the phone's key-value store. Local only: the arrangement of this phone's Today is not part of the account sync. */
import Storage from 'expo-sqlite/kv-store';
import { useCallback, useSyncExternalStore } from 'react';

import {
  DEFAULT_HOME_CARDS,
  isDefaultHomeCards,
  moveHomeCard,
  parseHomeCards,
  serializeHomeCards,
  setHomeCardHidden,
  type HomeCardId,
  type HomeCardPrefs,
} from './homeCards';

const KEY = 'joyofit.today.cards';

let current: HomeCardPrefs | null = null;
const listeners = new Set<() => void>();

function read(): HomeCardPrefs {
  current ??= parseHomeCards(Storage.getItemSync(KEY));
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function write(next: HomeCardPrefs): void {
  if (next === read()) return;
  current = next;
  if (isDefaultHomeCards(next)) Storage.removeItemSync(KEY);
  else Storage.setItemSync(KEY, serializeHomeCards(next));
  for (const l of [...listeners]) l();
}

/** The arrangement of the Today cards, and the ways to change it. Changes show at once on every screen that uses it. */
export function useHomeCards() {
  const prefs = useSyncExternalStore(subscribe, read, read);
  const setHidden = useCallback((id: HomeCardId, hide: boolean) => write(setHomeCardHidden(read(), id, hide)), []);
  const move = useCallback((id: HomeCardId, delta: number) => write(moveHomeCard(read(), id, delta)), []);
  const reset = useCallback(() => write(DEFAULT_HOME_CARDS), []);
  return { prefs, setHidden, move, reset };
}

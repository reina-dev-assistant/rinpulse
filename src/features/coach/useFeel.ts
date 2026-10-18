import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { parseFeel, serializeFeel, type Feel } from './feel';
import { localDay } from './time';

const KEY = 'joyofit.coach.feel';

interface Held {
  day: string;
  feel: Feel | null;
}

let held: Held | null = null;
const listeners = new Set<() => void>();

const today = (): string => localDay(Math.floor(Date.now() / 1000));

function publish(next: Held): void {
  held = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Today's answer, read from the phone once and shared by every screen that shows it; null until answered. */
export function useFeel(): { feel: Feel | null; setFeel: (feel: Feel | null) => void } {
  const snapshot = useSyncExternalStore(subscribe, () => held);
  const day = today();
  useEffect(() => {
    if (held && held.day === day) return;
    let live = true;
    void Storage.getItem(KEY)
      .catch(() => null)
      .then((raw) => {
        if (live) publish({ day, feel: parseFeel(raw, day) });
      });
    return () => {
      live = false;
    };
  }, [day]);

  const setFeel = useCallback((feel: Feel | null) => {
    const now = today();
    publish({ day: now, feel });
    void (feel ? Storage.setItem(KEY, serializeFeel(now, feel)) : Storage.removeItem(KEY)).catch(() => {});
  }, []);

  return { feel: snapshot && snapshot.day === day ? snapshot.feel : null, setFeel };
}

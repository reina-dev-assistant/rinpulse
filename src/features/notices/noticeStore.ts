/** Storage of `noticeState.ts` in the phone's key-value store. Local only: how a notice is shown is not part of the account sync. */
import { useCallback, useSyncExternalStore } from 'react';
import Storage from 'expo-sqlite/kv-store';

import { isNoticeExpanded, parseExpandedNotices, withNoticeExpanded, type ExpandedNotices } from './noticeState';

const KEY = 'joyofit.notices.expanded';

let current: ExpandedNotices | null = null;
const listeners = new Set<() => void>();

function read(): ExpandedNotices {
  current ??= parseExpandedNotices(Storage.getItemSync(KEY));
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setExpanded(id: string, open: boolean): void {
  const before = read();
  const next = withNoticeExpanded(before, id, open);
  if (next === before) return;
  current = next;
  Storage.setItemSync(KEY, JSON.stringify(next));
  for (const l of [...listeners]) l();
}

/** Whether notice `id` is open, and a setter that remembers the choice. Collapsed until opened. */
export function useNoticeExpanded(id: string): [boolean, (open: boolean) => void] {
  const getSnapshot = useCallback(() => isNoticeExpanded(read(), id), [id]);
  const open = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const set = useCallback((value: boolean) => setExpanded(id, value), [id]);
  return [open, set];
}

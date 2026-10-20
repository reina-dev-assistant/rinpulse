import { useSyncExternalStore } from 'react';

import type { SleepInsightsStatus } from '@/cloud/sleepInsightsClient';

/**
 * The server's Wawasan tidur switch as this app last saw it, shared by the push hook and the Settings switch so a toggle in
 * Settings reaches the hook at once. The server is the only source of truth; this is a cache of its last answer.
 */
let current: SleepInsightsStatus | null = null;
const listeners = new Set<() => void>();

export function publishSleepInsightsStatus(status: SleepInsightsStatus | null): void {
  current = status;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function useSleepInsightsStatus(): SleepInsightsStatus | null {
  return useSyncExternalStore(subscribe, () => current);
}

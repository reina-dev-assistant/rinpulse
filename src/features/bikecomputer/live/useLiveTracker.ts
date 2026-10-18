import { useSyncExternalStore } from 'react';

import { liveTracker } from './liveConfig';
import type { LiveState } from './tracker';

/** The live tracking state as React state; the ride screen and `ShareSection` re-render on every change of it. */
export function useLiveTracker(): LiveState {
  return useSyncExternalStore(
    (listener) => liveTracker.subscribe(listener),
    () => liveTracker.getState(),
  );
}

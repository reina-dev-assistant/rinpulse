import { useSyncExternalStore } from 'react';

import { bikeSettingsStore } from '../settings';
import type { BikeLayout, BikeSettings } from '../types';

/** The bike computer settings as React state; every `bikeSettingsStore.set` re-renders the screens that read it. */
export function useBikeSettings(): BikeSettings {
  return useSyncExternalStore(bikeSettingsStore.subscribe, () => bikeSettingsStore.get());
}

/** The page layout as React state. */
export function useBikeLayout(): BikeLayout {
  return useSyncExternalStore(bikeSettingsStore.subscribe, () => bikeSettingsStore.getLayout());
}

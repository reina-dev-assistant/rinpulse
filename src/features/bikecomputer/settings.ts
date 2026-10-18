/**
 * Bike computer settings and page layout in the key-value store: read synchronously (the ride screen needs them on its first frame),
 * written on every change, with a subscription for `useSyncExternalStore`. The model and repair rules are in `settingsModel.ts`.
 */
import Storage from 'expo-sqlite/kv-store';

import { notePrefChanged } from '@/cloud/prefsSync';

import { normalizeLayout } from './fields/layout';
import { DEFAULT_BIKE_SETTINGS, mergeSettings, sanitizeSettings } from './settingsModel';
import type { BikeLayout, BikeSettings } from './types';

export { DEFAULT_BIKE_SETTINGS } from './settingsModel';

const SETTINGS_KEY = 'joyofit.bike.settings';
const LAYOUT_KEY = 'joyofit.bike.layout';
const ROUTE_KEY = 'joyofit.bike.route';

function readJson(key: string): unknown {
  try {
    const text = Storage.getItemSync(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    Storage.setItemSync(key, JSON.stringify(value));
  } catch {
    // The change still applies for this session.
  }
}

let settings: BikeSettings | null = null;
let layout: BikeLayout | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** The key-value entries behind the synced preferences `bike.settings` and `bike.layout` (src/cloud/syncInventory.ts). */
export const BIKE_SETTINGS_KEY = SETTINGS_KEY;
export const BIKE_LAYOUT_KEY = LAYOUT_KEY;

export const bikeSettingsStore = {
  get(): BikeSettings {
    settings ??= sanitizeSettings(readJson(SETTINGS_KEY) ?? DEFAULT_BIKE_SETTINGS);
    return settings;
  },
  set(patch: Partial<BikeSettings>): void {
    settings = mergeSettings(this.get(), patch);
    writeJson(SETTINGS_KEY, settings);
    emit();
    void notePrefChanged('bike.settings');
  },
  /** Stores settings pulled from another phone (any shape: repaired). Not an edit, so nothing is stamped. */
  replace(raw: unknown): void {
    settings = sanitizeSettings(raw);
    writeJson(SETTINGS_KEY, settings);
    emit();
  },
  /** Back to the defaults (another phone reset them). */
  clear(): void {
    settings = null;
    try {
      Storage.removeItemSync(SETTINGS_KEY);
    } catch {
      // the defaults apply from memory
    }
    emit();
  },
  getLayout(hasRoute = false): BikeLayout {
    layout ??= normalizeLayout(readJson(LAYOUT_KEY), hasRoute);
    return layout;
  },
  setLayout(next: BikeLayout): void {
    layout = normalizeLayout(next, false);
    writeJson(LAYOUT_KEY, layout);
    emit();
    void notePrefChanged('bike.layout');
  },
  /** Stores a layout pulled from another phone (repaired). Not an edit. */
  replaceLayout(raw: unknown): void {
    layout = normalizeLayout(raw, false);
    writeJson(LAYOUT_KEY, layout);
    emit();
  },
  clearLayout(): void {
    layout = null;
    try {
      Storage.removeItemSync(LAYOUT_KEY);
    } catch {
      // the default layout applies from memory
    }
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** The route (library id) the rider chose for the next ride; null for none. Kept so an app restart during a ride keeps following it. */
export const chosenRoute = {
  get(): string | null {
    const value = Storage.getItemSync(ROUTE_KEY);
    return value && value.length > 0 ? value : null;
  },
  set(id: string | null): void {
    if (id === null) Storage.removeItemSync(ROUTE_KEY);
    else Storage.setItemSync(ROUTE_KEY, id);
  },
};

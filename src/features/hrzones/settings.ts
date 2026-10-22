import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import { notePrefChanged } from '@/cloud/prefsSync';
import { DEFAULT_AGE } from '@/features/workouts/substrate';
import { hasNative, HuaweiWear } from '@/wear';

import { DEFAULT_HR_ZONE_SETTINGS, isDefaultSettings, parseHrZoneSettings, resolveHrZones, watchConfig, type HrZoneSettings, type HrZones } from './zones';

const KEY = 'joyofit.hrZones';
/** Record id of the synced preference (`syncInventory.ts`); never renamed. */
export const HR_ZONES_PREF = 'hrzones';

const listeners = new Set<() => void>();
let cache: { key: string; zones: HrZones } | null = null;

/** The profile's age (this year minus the birth year), or the default age when no profile is saved. */
export function userAge(): number {
  const birthYear = HuaweiWear.getUserProfile()?.birthYear;
  return birthYear ? new Date().getFullYear() - birthYear : DEFAULT_AGE;
}

/** The stored settings; all defaults when nothing (or something unreadable) is stored. */
export function getHrZoneSettings(): HrZoneSettings {
  const raw = Storage.getItemSync(KEY);
  if (raw === null) return DEFAULT_HR_ZONE_SETTINGS;
  try {
    return parseHrZoneSettings(JSON.parse(raw)) ?? DEFAULT_HR_ZONE_SETTINGS;
  } catch {
    return DEFAULT_HR_ZONE_SETTINGS;
  }
}

/** The settings as a JSON value for the account document, or `undefined` while all defaults (defaults are never uploaded). */
export function hrZoneSettingsDocument(): HrZoneSettings | undefined {
  const settings = getHrZoneSettings();
  return isDefaultSettings(settings) ? undefined : settings;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Stores the settings without telling the account or the watch (a value pulled from the account, or a clear). */
export function storeHrZoneSettings(settings: HrZoneSettings): void {
  if (isDefaultSettings(settings)) Storage.removeItemSync(KEY);
  else Storage.setItemSync(KEY, JSON.stringify(settings));
  notify();
}

/** Result of handing the zones to the native module: `sent` reached the watch, `stored` is kept for the next connect, `unsupported` is a build without the function. */
export type WatchZonesOutcome = 'sent' | 'stored' | 'unsupported' | 'failed';

/**
 * Hands the zones as computed here to the watch (all defaults: null, the native module then sends Gadgetbridge's defaults for the profile's age).
 * Safe to call at any time: with no native function, no watch or a failure it only reports the outcome.
 */
export async function syncHrZonesToWatch(): Promise<WatchZonesOutcome> {
  // Open screens show the zones of the profile's age, which may have just changed.
  notify();
  if (!hasNative('setHeartRateZones')) return 'unsupported';
  const settings = getHrZoneSettings();
  try {
    const sent = await HuaweiWear.setHeartRateZones(isDefaultSettings(settings) ? null : watchConfig(resolveHrZones(settings, userAge())));
    return sent ? 'sent' : 'stored';
  } catch {
    return 'failed';
  }
}

/**
 * At launch: hands zones the person set to the native module, which keeps the last it was given. A build that gained the function after
 * the setting was made (or a pulled setting applied while the old build ran) has none yet. All defaults: nothing to hand over.
 */
export function syncHrZonesAtLaunch(): void {
  if (!isDefaultSettings(getHrZoneSettings())) void syncHrZonesToWatch();
}

/** A setting changed on this phone: store it, tell the account, send it to the watch. Resolves with what the watch did. */
export async function saveHrZoneSettings(settings: HrZoneSettings): Promise<WatchZonesOutcome> {
  storeHrZoneSettings(settings);
  void notePrefChanged(HR_ZONES_PREF);
  return syncHrZonesToWatch();
}

/** The zones in force: the person's settings at the profile's age. Cached until the stored settings or the age change. */
export function userHrZones(): HrZones {
  const age = userAge();
  const key = `${Storage.getItemSync(KEY) ?? ''}|${age}`;
  if (cache?.key !== key) cache = { key, zones: resolveHrZones(getHrZoneSettings(), age) };
  return cache.zones;
}

/**
 * The maximum heart rate (the person's entry, or 220 - age): the only part of the zone settings strain, the strain-based load and the
 * intensity minutes read. They count in Edwards' fixed percent-of-maximum zones whatever method, resting rate, LTHR or limits are set.
 */
export function userMaxHr(): number {
  return userHrZones().maxHr;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `userHrZones()` for a component: re-renders when the settings change, also when a sync pulls new ones. */
export function useHrZones(): HrZones {
  return useSyncExternalStore(subscribe, userHrZones);
}

/** `userMaxHr()` for a component. */
export function useMaxHr(): number {
  return useSyncExternalStore(subscribe, userMaxHr);
}

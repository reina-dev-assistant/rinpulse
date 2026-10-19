import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Linking } from 'react-native';

import { CLOUD_CONFIGURED, CLOUD_URL } from '@/cloud/config';
import {
  GATE_FETCH_TIMEOUT_MS,
  needsFetch,
  parseCachedConfig,
  parseGateConfig,
  resolveGateConfig,
  type CachedGateConfig,
  type GateConfig,
} from '@/features/updates/forceUpdatePolicy';
import { parseVersionCode } from '@/features/updates/updatePolicy';

/** Native build of this binary: Android versionCode, iOS CFBundleVersion. 0 when it cannot be read (the gate then stays off). */
export const NATIVE_BUILD = parseVersionCode(Constants.nativeBuildVersion);

/** Android application id; the `market://` link needs it. */
export const ANDROID_PACKAGE = 'com.joyodigitama.joyofit';

const CACHE_KEY = 'joyofit_gate_config';

let memory: CachedGateConfig | null = null;

async function readCache(): Promise<CachedGateConfig | null> {
  if (memory) return memory;
  memory = parseCachedConfig(await SecureStore.getItemAsync(CACHE_KEY).catch(() => null));
  return memory;
}

async function fetchConfig(force: boolean): Promise<GateConfig | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATE_FETCH_TIMEOUT_MS);
  try {
    // The edge caches the answer for a minute; "Cek lagi" asks past it.
    const url = `${CLOUD_URL}/v1/app-config${force ? `?t=${Date.now()}` : ''}`;
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) return null;
    return parseGateConfig(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The gate config: a fresh cache (5 min) as is, else the server; when the server cannot be reached a fresh cache
 * is still used, anything else is null and never blocks. Never throws. `force` skips the cache ("Cek lagi").
 */
export async function loadGateConfig(force: boolean): Promise<GateConfig | null> {
  if (!CLOUD_CONFIGURED) return null;
  const cached = await readCache();
  const now = Date.now();
  let fetched: GateConfig | null = null;
  if (needsFetch(cached, now, force)) {
    fetched = await fetchConfig(force);
    if (fetched !== null) {
      memory = { fetchedAt: Date.now(), config: fetched };
      void SecureStore.setItemAsync(CACHE_KEY, JSON.stringify(memory)).catch(() => {});
    }
  }
  return resolveGateConfig({ cached, fetched, now: Date.now() });
}

/** Opens the first of `urls` the phone can handle; false when none opens. */
export async function openFirst(urls: string[]): Promise<boolean> {
  for (const url of urls) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      // No handler for this scheme (no Play app, no TestFlight): try the next link.
    }
  }
  return false;
}

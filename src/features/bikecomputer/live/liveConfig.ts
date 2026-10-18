/**
 * The non-pure edge of live tracking: wires the pure client and tracker to the app's cloud URL, the JoyoRogo session cookie,
 * `fetch` and the key-value store. Nothing else in `live/` imports React Native or the cloud modules.
 */
import Storage from 'expo-sqlite/kv-store';

import { authClient } from '@/cloud/auth';
import { CLOUD_URL } from '@/cloud/config';

import { createLiveClient } from './liveClient';
import { LiveTracker } from './tracker';

const CONSENT_KEY = 'joyofit.bike.liveConsent';

export const liveClient = createLiveClient({
  baseUrl: CLOUD_URL,
  fetch: (url, init) => fetch(url, init),
  sessionHeaders: async () => {
    const cookie = await authClient.getCookie();
    return cookie ? { Cookie: cookie } : null;
  },
});

/** The one tracker of the app: the ride screen calls `begin`, `addPoint`, `flush` (every second) and `end` on it. */
export const liveTracker = new LiveTracker({ client: liveClient, store: Storage, now: Date.now });

/** True once the rider has accepted the first-use explanation ("Lanjut"). */
export function hasLiveConsent(): boolean {
  try {
    return Storage.getItemSync(CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setLiveConsent(): void {
  try {
    Storage.setItemSync(CONSENT_KEY, '1');
  } catch {
    // Asked again next time.
  }
}

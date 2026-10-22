import type { SecretStore } from '@/features/scale/secret';

/**
 * How the app reads a paired thermometer:
 *  - `advert`: its advertisements (community firmware: ATC1441, PVVX, BTHome);
 *  - `bindkey`: the stock firmware's encrypted MiBeacon advertisements, opened with the bind key the person typed in;
 *  - `gatt`: a short connection every few minutes that reads one sample (stock firmware, no key; only while the app is open).
 * A thermometer with no entry is `advert`: every pairing made before the stock firmware was supported.
 */
export type RoomLink = 'advert' | 'bindkey' | 'gatt';

/** A key-value store of strings (the app passes `expo-sqlite/kv-store`), injected so this runs under bun test. */
export interface KvStore {
  getItemSync(key: string): string | null;
  setItemSync(key: string, value: string): void;
  removeItemSync(key: string): boolean | void;
}

const safe = (id: string): string => id.replace(/[^A-Za-z0-9._-]/g, '_');

export const linkKey = (sensorId: string): string => `joyofit.room.link.${safe(sensorId)}`;

/** The secure store key of a sensor's bind key (letters, digits, `.`, `-`, `_` only). Never written anywhere else. */
export const bindkeyKey = (sensorId: string): string => `joyofit.room.bindkey.${safe(sensorId)}`;

export function getLink(kv: KvStore, sensorId: string): RoomLink {
  const value = kv.getItemSync(linkKey(sensorId));
  return value === 'bindkey' || value === 'gatt' ? value : 'advert';
}

export function setLink(kv: KvStore, sensorId: string, link: RoomLink): void {
  if (link === 'advert') kv.removeItemSync(linkKey(sensorId));
  else kv.setItemSync(linkKey(sensorId), link);
}

export const loadBindkey = (store: SecretStore, sensorId: string): Promise<string | null> => store.getItemAsync(bindkeyKey(sensorId));

export const saveBindkey = (store: SecretStore, sensorId: string, bindkey: string): Promise<void> => store.setItemAsync(bindkeyKey(sensorId), bindkey);

export const deleteBindkey = (store: SecretStore, sensorId: string): Promise<void> => store.deleteItemAsync(bindkeyKey(sensorId));

/** Removes everything kept for a forgotten thermometer: its link and its bind key. */
export async function forgetLink(kv: KvStore, store: SecretStore, sensorId: string): Promise<void> {
  kv.removeItemSync(linkKey(sensorId));
  await deleteBindkey(store, sensorId).catch(() => {});
}

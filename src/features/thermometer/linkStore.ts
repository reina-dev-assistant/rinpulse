import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';

import {
  deleteBindkey,
  forgetLink,
  getLink,
  loadBindkey,
  saveBindkey,
  setLink,
  type RoomLink,
} from './link';

/** The app's bindings of `link.ts`: kv-store for the link of each thermometer, the platform's secure store for its bind key. */
export const roomLink = {
  get: (sensorId: string): RoomLink => getLink(Storage, sensorId),
  set: (sensorId: string, link: RoomLink): void => setLink(Storage, sensorId, link),
  loadBindkey: (sensorId: string): Promise<string | null> => loadBindkey(SecureStore, sensorId),
  saveBindkey: (sensorId: string, bindkey: string): Promise<void> => saveBindkey(SecureStore, sensorId, bindkey),
  deleteBindkey: (sensorId: string): Promise<void> => deleteBindkey(SecureStore, sensorId),
  forget: (sensorId: string): Promise<void> => forgetLink(Storage, SecureStore, sensorId),
};

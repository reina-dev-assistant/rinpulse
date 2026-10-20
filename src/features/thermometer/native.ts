import { PermissionsAndroid, Platform } from 'react-native';

import { BleSensors } from '@/ble';

import { pickRoomCapture, type RoomCaptureNative } from './roomNative';

/** The overnight scan of this app build, null when this build has none (iOS, or an Android binary from before it existed). */
export function roomCaptureNative(): RoomCaptureNative | null {
  return Platform.OS === 'android' ? pickRoomCapture(BleSensors) : null;
}

/** Android below 12 needs location to scan; 12 and later BLUETOOTH_SCAN + BLUETOOTH_CONNECT. */
const RUNTIME_BLUETOOTH_API = 31;

/**
 * Whether the scan permissions are already granted, without asking: what the app starts a scan by itself on. Asking is done by the
 * Settings screen (`ensureSensorPermissions`), which explains first. iOS answers true: its Bluetooth prompt was raised when the
 * thermometer was paired, and a scan without it ends with an error the caller ignores.
 */
export async function scanPermissionsGranted(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const p = PermissionsAndroid.PERMISSIONS;
  if (Number(Platform.Version) < RUNTIME_BLUETOOTH_API) return PermissionsAndroid.check(p.ACCESS_FINE_LOCATION);
  const [scan, connect] = await Promise.all([PermissionsAndroid.check(p.BLUETOOTH_SCAN), PermissionsAndroid.check(p.BLUETOOTH_CONNECT)]);
  return scan && connect;
}

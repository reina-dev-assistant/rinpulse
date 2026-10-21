/**
 * Permissions for sensors and phone-recorded workouts. Android asks through PermissionsAndroid (the module's own location request
 * exists on iOS only); iOS raises its system prompts from the native module (Bluetooth with the first scan or connect, location from
 * `requestLocationPermission`). Callers explain first (a "Lanjut" button), then call these.
 */
import { PermissionsAndroid, Platform } from 'react-native';

import { BleSensors, type LocationPermission, type StepCounterPermission } from '@/ble';
import { ensureBluetoothConnect, ensureBluetoothScan, type PermissionStatus } from '@/features/device/useBluetoothPermission';

export type Granted = Exclude<PermissionStatus, 'checking'>;

/** Android below 12 needs location to scan for Bluetooth LE devices at all; 12 and later use BLUETOOTH_SCAN (declared neverForLocation). */
const NEEDS_LOCATION_TO_SCAN_BELOW = 31;

/** What scanning and connecting to sensors need: BLUETOOTH_SCAN + BLUETOOTH_CONNECT on Android 12+, location below. */
export async function ensureSensorPermissions(): Promise<Granted> {
  if (Platform.OS === 'android' && Number(Platform.Version) < NEEDS_LOCATION_TO_SCAN_BELOW) {
    return ensureAndroidFineLocation();
  }
  const scan = await ensureBluetoothScan();
  if (scan !== 'granted') return scan;
  return ensureBluetoothConnect();
}

async function ensureAndroidFineLocation(): Promise<Granted> {
  const permission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  if (await PermissionsAndroid.check(permission)) return 'granted';
  const result = await PermissionsAndroid.request(permission);
  if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
}

/** Precise location for the GPS of an outdoor workout. */
export async function ensureLocation(): Promise<Granted> {
  if (Platform.OS === 'android') return ensureAndroidFineLocation();
  const answer: LocationPermission = await BleSensors.requestLocationPermission();
  return answer === 'granted' ? 'granted' : 'denied';
}

/** The location permission without asking. */
export async function locationGranted(): Promise<boolean> {
  return (await BleSensors.locationPermission()) === 'granted';
}

/**
 * The phone's step counter for cadence and steps of a run, walk or hike: ACTIVITY_RECOGNITION on Android 10+ (granted below it), the motion
 * prompt on iOS. Optional: a refusal never stops a recording, it just has no phone cadence.
 */
export async function ensureStepCounter(): Promise<Granted> {
  if (Platform.OS === 'android') {
    const permission = PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION;
    if (await PermissionsAndroid.check(permission)) return 'granted';
    const result = await PermissionsAndroid.request(permission);
    if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
    return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
  }
  if (typeof BleSensors.requestStepCounterPermission !== 'function') return 'denied';
  const answer: StepCounterPermission = await BleSensors.requestStepCounterPermission();
  return answer === 'granted' ? 'granted' : 'denied';
}

/** The step counter permission without asking; `unavailable` when the phone has no step counter. */
export async function stepCounterState(): Promise<StepCounterPermission> {
  if (typeof BleSensors.stepCounterPermission !== 'function') return 'unavailable';
  return BleSensors.stepCounterPermission();
}

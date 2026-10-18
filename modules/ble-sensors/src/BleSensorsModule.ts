import { NativeModule, requireNativeModule } from 'expo';
import type {
  BleSensorsModuleEvents,
  BluetoothState,
  ConnectionEvent,
  LocationPermission,
  WorkoutSessionOptions,
  WorkoutSessionState,
} from './BleSensors.types';

declare class BleSensorsModule extends NativeModule<BleSensorsModuleEvents> {
  /**
   * The radio state. On iOS the first call creates the CBCentralManager, which is what raises the system Bluetooth prompt, so call it
   * from a screen that explains why first. Android never prompts here (the app asks for BLUETOOTH_SCAN / BLUETOOTH_CONNECT through
   * PermissionsAndroid first, see features/sensors/permissions.ts).
   */
  bluetoothState(): Promise<BluetoothState>;

  /**
   * Scans for sensors that advertise the Heart Rate (180D), Cycling Speed and Cadence (1816), Cycling Power (1818) or Running Speed
   * and Cadence (1814) service, filtered by those UUIDs in the radio so it keeps working with the screen off. Every advertisement
   * arrives as `onScanResult` (repeats included; the JS side de-duplicates by id). Stops by itself after 20 s (`onScanState`).
   * Rejects with ERR_BLUETOOTH_PERMISSION, ERR_BLUETOOTH_OFF or ERR_BLUETOOTH_UNAVAILABLE.
   */
  startScan(): Promise<void>;
  stopScan(): Promise<void>;

  /**
   * Starts connecting to a sensor and KEEPS it connected: when the link drops (out of range, strap taken off, sensor asleep) the
   * module reconnects by itself with a growing delay until `disconnect` or `disconnectAll`. Resolves as soon as the request is accepted;
   * progress arrives as `onConnection`. A connected sensor streams every characteristic of the supported table (see
   * BleSensors.types.ts `SENSOR_CHARACTERISTICS`) as `onValue`, and the module reads the battery level and the device information once
   * after each (re)connect. `id` is what `onScanResult` reported (Android: the MAC address; iOS: the CBPeripheral identifier UUID).
   * Rejects with ERR_BLUETOOTH_PERMISSION, ERR_BLUETOOTH_OFF, ERR_BLUETOOTH_UNAVAILABLE or ERR_INVALID_ARGUMENT (unknown id).
   */
  connect(id: string): Promise<void>;
  /** Drops the link and stops reconnecting. Resolves even when the sensor was not connected. */
  disconnect(id: string): Promise<void>;
  disconnectAll(): Promise<void>;
  /** The current state of every sensor `connect` was called for, so a screen that mounts later can show it. */
  connectionStates(): Promise<ConnectionEvent[]>;

  /** `granted` means precise location while in use. Android: ACCESS_FINE_LOCATION. iOS: authorizedWhenInUse or authorizedAlways. */
  locationPermission(): Promise<LocationPermission>;
  /**
   * iOS only: raises the system "while using the app" prompt and resolves with the answer. Android asks through PermissionsAndroid
   * (features/sensors/permissions.ts), so this function does not exist there.
   */
  requestLocationPermission(): Promise<LocationPermission>;

  /**
   * Starts the phone side of a recorded workout so it survives a locked screen:
   * - Android: a foreground service (type location when `gps`, plus connectedDevice) with an ongoing notification and a partial wake lock.
   * - iOS: background location updates when `gps` (blue status-bar pill), nothing else; Bluetooth keeps running through the
   *   `bluetooth-central` background mode.
   * With `gps` it also starts GPS fixes, delivered as `onLocation` about once a second. Calling it while a session runs only updates
   * the options. Rejects with ERR_LOCATION_PERMISSION (`gps` without precise location), ERR_SERVICE_NOT_ALLOWED (Android refused
   * the foreground service: GPS fixes and the wake lock run anyway and the promise rejects only after they started, so the caller
   * continues and warns that the recording may stop with the screen locked).
   */
  startWorkoutSession(options: WorkoutSessionOptions): Promise<void>;
  /** Android: reports the recorder's numbers to the notification (it counts the time itself between reports). iOS: no-op. */
  updateWorkoutSession(state: WorkoutSessionState): Promise<void>;
  /** Stops GPS, the foreground service and the wake lock. Sensor links stay up (disconnect them yourself). */
  endWorkoutSession(): Promise<void>;
  isWorkoutSessionActive(): boolean;
}

export default requireNativeModule<BleSensorsModule>('BleSensors');

import type { RoomAdvert, RoomCaptureOptions, RoomCaptureState } from '../../../modules/ble-sensors/src/BleSensors.types';

/** The slice of the `BleSensors` native module the overnight scan uses (Android, store build only); injected so everything runs under bun test. */
export interface RoomCaptureNative {
  startRoomCapture(options: RoomCaptureOptions): Promise<void>;
  stopRoomCapture(): Promise<void>;
  roomCaptureState(): Promise<RoomCaptureState>;
  roomAdverts(): Promise<RoomAdvert[]>;
  clearRoomAdverts(upToTs: number): Promise<void>;
  /** Absent on a build from before the stock-firmware thermometer support. */
  roomCaptureServices?(): string[];
}

const FUNCTIONS = ['startRoomCapture', 'stopRoomCapture', 'roomCaptureState', 'roomAdverts', 'clearRoomAdverts'] as const;

/**
 * The overnight scan of a native module, or null when it has none: iOS never has it, and an Android binary built before it existed
 * (an over-the-air update reaches those too) lacks the functions. Callers treat null as "foreground scanning only", never as an error.
 */
export function pickRoomCapture(module: unknown): RoomCaptureNative | null {
  if (typeof module !== 'object' || module === null) return null;
  const record = module as Record<string, unknown>;
  return FUNCTIONS.every((name) => typeof record[name] === 'function') ? (module as RoomCaptureNative) : null;
}

/** Whether the overnight scan of this build keeps MiBeacon frames (`fe95`), so a stock-firmware thermometer is heard with the app closed. */
export function keepsMiBeacon(native: Pick<RoomCaptureNative, 'roomCaptureServices'>): boolean {
  try {
    return typeof native.roomCaptureServices === 'function' && native.roomCaptureServices().includes('fe95');
  } catch {
    return false;
  }
}

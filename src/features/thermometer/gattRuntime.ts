import type { GattPoller } from './gattPoller';
import type { GattResult } from './gattRead';

let current: GattPoller | null = null;

/** The app's poller (`useRoomCapture` makes it and drops it), so a screen's "read now" and the pairing share the schedule's one-at-a-time queue. */
export function setGattPoller(poller: GattPoller | null): void {
  current = poller;
}

/** Reads one sensor now through the app's poller; null when the app has none (it is being set up or torn down). */
export function readGattNow(sensorId: string): Promise<GattResult> | null {
  return current ? current.readNow(sensorId) : null;
}

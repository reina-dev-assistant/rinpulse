import Storage from 'expo-sqlite/kv-store';

const AUTO_KEY = 'joyofit.room.autoArm';
const WAKE_KEY = 'joyofit.room.wakeHour';

/** The hours the overnight scan can be told to run until (local time next morning). */
export const WAKE_HOURS = [6, 8, 10] as const;
export const DEFAULT_WAKE_HOUR = 8;

/** Start the overnight scan by itself when the app is opened in the evening. On unless the person turned it off. */
export function getAutoArm(): boolean {
  return Storage.getItemSync(AUTO_KEY) !== '0';
}

export function setAutoArm(on: boolean): void {
  Storage.setItemSync(AUTO_KEY, on ? '1' : '0');
}

/** The local hour the overnight scan ends at. */
export function getWakeHour(): number {
  const value = Number(Storage.getItemSync(WAKE_KEY));
  return (WAKE_HOURS as readonly number[]).includes(value) ? value : DEFAULT_WAKE_HOUR;
}

export function setWakeHour(hour: number): void {
  Storage.setItemSync(WAKE_KEY, String(hour));
}

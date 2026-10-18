import Storage from 'expo-sqlite/kv-store';

import { measuredPctPerHour, profileKey, type BatteryHistoryEntry, type BatteryProfile } from './batteryEstimate';
import { appendHistory, parseHistory } from './batteryHistory';

const KEY = 'joyofit.bike.battery';

export function loadBatteryHistory(): BatteryHistoryEntry[] {
  try {
    const text = Storage.getItemSync(KEY);
    return parseHistory(text ? JSON.parse(text) : null);
  } catch {
    return [];
  }
}

/** Stores the drain of a finished ride when it says something (see `measuredPctPerHour`); returns whether it did. */
export function recordRideDrain(profile: BatteryProfile, startPct: number | null, endPct: number | null, movingSec: number, charged: boolean): boolean {
  if (startPct === null || endPct === null) return false;
  const rate = measuredPctPerHour(startPct, endPct, movingSec, charged);
  if (rate === null) return false;
  const next = appendHistory(loadBatteryHistory(), { profileKey: profileKey(profile), pctPerHour: rate, weight: 1 });
  try {
    Storage.setItemSync(KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  return true;
}

/**
 * The rider's own battery drain per ride, which replaces the model in `estimateBattery` (batteryEstimate.ts). Pure: parse, repair and
 * append; the key-value store is in `batteryStore.ts`.
 */
import type { BatteryHistoryEntry } from './batteryEstimate';

/** Rides kept; older ones fall off (the profile may have changed with the phone's age). */
export const MAX_HISTORY = 12;

const MIN_PCT_PER_HOUR = 1;
const MAX_PCT_PER_HOUR = 60;

/** A stored history made safe: wrong shapes and implausible rates dropped, at most `MAX_HISTORY` newest kept. */
export function parseHistory(raw: unknown): BatteryHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: BatteryHistoryEntry[] = [];
  for (const item of raw) {
    const e = item as { profileKey?: unknown; pctPerHour?: unknown; weight?: unknown } | null;
    if (!e || typeof e.profileKey !== 'string' || typeof e.pctPerHour !== 'number' || !Number.isFinite(e.pctPerHour)) continue;
    if (e.pctPerHour < MIN_PCT_PER_HOUR || e.pctPerHour > MAX_PCT_PER_HOUR) continue;
    const weight = typeof e.weight === 'number' && Number.isFinite(e.weight) && e.weight > 0 ? e.weight : 1;
    out.push({ profileKey: e.profileKey, pctPerHour: e.pctPerHour, weight });
  }
  return out.slice(-MAX_HISTORY);
}

/** `history` plus one finished ride, newest last; a rate outside the plausible range is not recorded. */
export function appendHistory(history: readonly BatteryHistoryEntry[], entry: BatteryHistoryEntry): BatteryHistoryEntry[] {
  return parseHistory([...history, entry]);
}

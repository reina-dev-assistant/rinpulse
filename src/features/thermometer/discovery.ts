import { decodeThermometerAdvert, hasThermometerService, isThermometerName, type ThermometerReading } from '@/features/sensors/thermometerAdvert';
import type { AdFrame } from '@/features/scale/types';

export interface FoundThermometer {
  /** Android: MAC address. iOS: peripheral UUID. */
  id: string;
  name: string | null;
  rssi: number;
  seenAt: number;
  /** The newest reading its advertisements carried; null while none was readable. */
  reading: ThermometerReading | null;
  /** At least one advertisement was readable: only these can be paired. A stock-firmware unit is listed but is not readable. */
  readable: boolean;
}

/** A device not heard from for this long is gone from the list. */
export const STALE_MS = 20_000;

/**
 * Folds one advertisement into the picker's list (returns a new map). Listed: anything that decodes, anything carrying thermometer
 * service data, and anything named like a Xiaomi/ATC/PVVX thermometer (the stock firmware advertises under that name but in an encrypted
 * payload nobody here can read).
 */
export function foldThermometer(devices: ReadonlyMap<string, FoundThermometer>, frame: AdFrame, now: number): Map<string, FoundThermometer> {
  const reading = decodeThermometerAdvert(frame);
  const before = devices.get(frame.id);
  if (!reading && !before && !hasThermometerService(frame) && !isThermometerName(frame.name)) return new Map(devices);
  const next = new Map(devices);
  next.set(frame.id, {
    id: frame.id,
    name: frame.name ?? before?.name ?? null,
    rssi: frame.rssi,
    seenAt: now,
    reading: reading ?? before?.reading ?? null,
    readable: reading !== null || (before?.readable ?? false),
  });
  return next;
}

/** Readable thermometers first, then the others; each by signal strength. Devices that went quiet are dropped. */
export function visibleThermometers(devices: ReadonlyMap<string, FoundThermometer>, now: number): FoundThermometer[] {
  return [...devices.values()]
    .filter((d) => now - d.seenAt <= STALE_MS)
    .sort((a, b) => Number(b.readable) - Number(a.readable) || b.rssi - a.rssi || a.id.localeCompare(b.id));
}

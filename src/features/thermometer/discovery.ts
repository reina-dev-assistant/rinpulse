import { decodeMiBeacon, isMiThermometerAdvert, SERVICE_MIBEACON } from '@/features/sensors/miBeacon';
import { MiBeaconTracker } from '@/features/sensors/miBeaconTracker';
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
  /** The last MiBeacon payloads (hex) the unit broadcast, newest last: what a typed-in bind key is checked against before it is kept. Empty for community firmware. */
  miFrames: string[];
}

/** How many distinct MiBeacon payloads a listed unit remembers. */
export const MI_FRAMES_KEPT = 8;

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
  const mi = frame.serviceData[SERVICE_MIBEACON];
  const stock = isMiThermometerAdvert(mi);
  if (!reading && !before && !hasThermometerService(frame) && !isThermometerName(frame.name) && !stock) return new Map(devices);
  const next = new Map(devices);
  const frames = before?.miFrames ?? [];
  const miFrames = mi !== undefined && !frames.includes(mi) ? [...frames, mi].slice(-MI_FRAMES_KEPT) : frames;
  next.set(frame.id, {
    id: frame.id,
    name: frame.name ?? before?.name ?? null,
    rssi: frame.rssi,
    seenAt: now,
    reading: reading ?? before?.reading ?? null,
    readable: reading !== null || (before?.readable ?? false),
    miFrames,
  });
  return next;
}

/** Readable thermometers first, then the others; each by signal strength. Devices that went quiet are dropped. */
export function visibleThermometers(devices: ReadonlyMap<string, FoundThermometer>, now: number): FoundThermometer[] {
  return [...devices.values()]
    .filter((d) => now - d.seenAt <= STALE_MS)
    .sort((a, b) => Number(b.readable) - Number(a.readable) || b.rssi - a.rssi || a.id.localeCompare(b.id));
}

export type BindkeyCheck =
  /** At least one frame opened with the key (or needed none). */
  | 'ok'
  /** Every frame that could be tried failed its integrity check: not this unit's key. */
  | 'wrongKey'
  /** No frame carrying an object was heard yet (the unit has not advertised since the search began, or sent only idle frames). */
  | 'noFrames'
  /** The unit uses MiBeacon version 2 or 3 (a 12 byte key) or sends no MAC where the phone cannot supply one. */
  | 'unsupported';

/** Checks a bind key against the frames a listed unit broadcast: the MiBeacon integrity tag makes a wrong key fail, so a "yes" is proof. */
export function checkBindkey(device: Pick<FoundThermometer, 'id' | 'miFrames'>, bindkey: string): BindkeyCheck {
  let wrong = false;
  let unsupported = false;
  for (const frame of device.miFrames) {
    const result = decodeMiBeacon(frame, bindkey, device.id);
    if (result.ok) return 'ok';
    if (result.reason === 'wrongKey') wrong = true;
    else if (result.reason === 'unsupported' || result.reason === 'noMac') unsupported = true;
  }
  return wrong ? 'wrongKey' : unsupported ? 'unsupported' : 'noFrames';
}

/** The reading the frames a unit broadcast so far make under a bind key (the first card of a fresh pairing), or null while they are one half only. */
export function readingFromFrames(device: Pick<FoundThermometer, 'id' | 'miFrames'>, bindkey: string, ts: number): ThermometerReading | null {
  const tracker = new MiBeaconTracker();
  let reading: ThermometerReading | null = null;
  for (const hex of device.miFrames) {
    const frame = decodeMiBeacon(hex, bindkey, device.id);
    if (frame.ok) reading = tracker.feed(device.id, frame, ts) ?? reading;
  }
  return reading;
}

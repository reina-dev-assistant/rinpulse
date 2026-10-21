/**
 * The calendar zone JoyoRogo files a person's days under: their profile zone (`profile.timezone`, null = Asia/Jakarta). The zones it
 * supports have no daylight saving, so each is a fixed offset. No React Native imports, so bun tests it.
 */

export const ROGO_ZONE_OFFSET_MIN = {
  'Asia/Jakarta': 7 * 60,
  'Asia/Kuala_Lumpur': 8 * 60,
  'Asia/Singapore': 8 * 60,
} as const;

export type RogoZone = keyof typeof ROGO_ZONE_OFFSET_MIN;

export const DEFAULT_ROGO_ZONE: RogoZone = 'Asia/Jakarta';

function isRogoZone(zone: unknown): zone is RogoZone {
  return typeof zone === 'string' && Object.prototype.hasOwnProperty.call(ROGO_ZONE_OFFSET_MIN, zone);
}

/** The device's IANA zone, or undefined when the runtime cannot tell. */
export function deviceZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** The zone JoyoRogo counts days in: the profile's when it is a known one, else the device's when it is, else Jakarta. */
export function resolveRogoZone(profileZone: string | null | undefined, device: string | undefined = deviceZone()): RogoZone {
  if (isRogoZone(profileZone)) return profileZone;
  if (profileZone == null && isRogoZone(device)) return device;
  return DEFAULT_ROGO_ZONE;
}

let current: RogoZone = resolveRogoZone(null);

/** Remembers the person's JoyoRogo profile zone (`profile.timezone`, null when unset) for every day key computed after it. */
export function setRogoProfileZone(profileZone: string | null | undefined): void {
  current = resolveRogoZone(profileZone);
}

/** `+07:00` / `+08:00`, the offset suffix of an ISO timestamp in the zone. */
function rogoOffsetSuffix(zone: RogoZone): string {
  const min = ROGO_ZONE_OFFSET_MIN[zone];
  return `+${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** The `YYYY-MM-DD` day of an instant in the JoyoRogo zone, the key its diary, weight and workouts are filed under. */
export function rogoDay(epochMs: number, zone: RogoZone = current): string {
  return new Date(epochMs + ROGO_ZONE_OFFSET_MIN[zone] * 60_000).toISOString().slice(0, 10);
}

/** Noon of a JoyoRogo `YYYY-MM-DD` day in the zone, epoch ms. */
export function rogoNoon(date: string, zone: RogoZone = current): number {
  return Date.parse(`${date}T12:00:00${rogoOffsetSuffix(zone)}`);
}

/**
 * Decoders for the Xiaomi LYWSD03MMC bedroom thermometer running the community firmware (pvvx/ATC_MiThermometer), read from the
 * advertisement only: no connection, no bind key. Pure TypeScript with no React Native imports, so it is unit tested with byte
 * fixtures and a new format ships over the air. The native module hands over service data as lowercase hex without the UUID
 * (`ScaleAdvertisementEvent.serviceData`, UUIDs normalised by `features/scale/uuid.ts`).
 *
 * Formats, by service data UUID:
 *  - `181a` ATC1441, 13 bytes: MAC (6, big-endian), temperature int16 BE 0.1 C, humidity u8 %, battery u8 %, battery u16 BE mV, counter u8.
 *  - `181a` PVVX custom, 15 bytes: MAC (6, little-endian), temperature int16 LE 0.01 C, humidity u16 LE 0.01 %, battery u16 LE mV,
 *    battery u8 %, counter u8, flags u8.
 *  - `fcd2` BTHome v2: device info byte, then objects `[id][value]` in ascending id order: 0x01 battery u8 %, 0x02 temperature sint16
 *    0.01 C, 0x03 humidity u16 0.01 %. An encrypted payload (info bit 0) is skipped.
 *
 * The stock Xiaomi firmware is NOT decodable here: it advertises its readings in a 0xFE95 payload encrypted with a per-device bind key
 * (or not at all) [INFERENCE: from the firmware's documentation, not tested on a stock unit]. The sensor needs the community firmware.
 */

/** Bluetooth SIG "Environmental Sensing" service, the UUID the ATC1441 and PVVX formats put their service data under. */
export const SERVICE_ENVIRONMENT = '181a';
/** BTHome's service UUID (assigned to Allterco / BTHome). */
export const SERVICE_BTHOME = 'fcd2';

/** The service data UUIDs a thermometer scan filters on. */
export const THERMOMETER_SERVICES: readonly string[] = [SERVICE_ENVIRONMENT, SERVICE_BTHOME];

/** Readings outside these bounds are decoder or sensor glitches, not rooms. */
export const TEMP_MIN_C = -20;
export const TEMP_MAX_C = 60;
export const RH_MIN_PCT = 0;
export const RH_MAX_PCT = 100;

/** `mibeacon`: the stock Xiaomi firmware (bind key or plaintext), `gatt`: a sample read over a connection. Neither comes through `decodeThermometerAdvert`. */
export type ThermometerFormat = 'atc1441' | 'pvvx' | 'bthome' | 'mibeacon' | 'gatt';

export interface ThermometerReading {
  format: ThermometerFormat;
  /** `A4:C1:38:8D:18:B2`, from the payload (ATC1441, PVVX); null for BTHome, which carries none. On iOS the scan id is a UUID, so this is the sensor's real address. */
  mac: string | null;
  /** Degrees Celsius, within -20..60. */
  tempC: number;
  /** Relative humidity, within 0..100. */
  rhPct: number;
  /** 0..100, null when the frame has none or says something else. */
  batteryPct: number | null;
  batteryMv: number | null;
  /** Rolls over every new measurement; null when the format has none. Repeats of the same value are the same measurement. */
  counter: number | null;
}

/** Just what the decoder reads of a scan result (an `AdFrame` or a `ScaleAdvertisementEvent` both satisfy it). */
export interface ThermometerFrame {
  serviceData: Readonly<Record<string, string>>;
}

const HEX = /^(?:[0-9a-f]{2})*$/;

function toBytes(hex: string | undefined): Uint8Array | null {
  if (hex === undefined) return null;
  const lower = hex.toLowerCase();
  if (!HEX.test(lower)) return null;
  const out = new Uint8Array(lower.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(lower.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const u16le = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8);
const u16be = (b: Uint8Array, i: number): number => (b[i]! << 8) | b[i + 1]!;
const signed16 = (v: number): number => (v >= 0x8000 ? v - 0x10000 : v);

const macText = (bytes: readonly number[]): string => bytes.map((v) => v.toString(16).padStart(2, '0')).join(':').toUpperCase();

const round = (n: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const inRange = (tempC: number, rhPct: number): boolean =>
  Number.isFinite(tempC) && Number.isFinite(rhPct) && tempC >= TEMP_MIN_C && tempC <= TEMP_MAX_C && rhPct >= RH_MIN_PCT && rhPct <= RH_MAX_PCT;

const batteryOrNull = (pct: number): number | null => (pct >= 0 && pct <= 100 ? pct : null);

/** ATC1441: 13 bytes. */
function decodeAtc1441(b: Uint8Array): ThermometerReading | null {
  if (b.length !== 13) return null;
  const tempC = round(signed16(u16be(b, 6)) / 10, 1);
  const rhPct = b[8]!;
  if (!inRange(tempC, rhPct)) return null;
  return {
    format: 'atc1441',
    mac: macText([...b.subarray(0, 6)]),
    tempC,
    rhPct,
    batteryPct: batteryOrNull(b[9]!),
    batteryMv: u16be(b, 10),
    counter: b[12]!,
  };
}

/** PVVX custom: 15 bytes. */
function decodePvvx(b: Uint8Array): ThermometerReading | null {
  if (b.length !== 15) return null;
  const tempC = round(signed16(u16le(b, 6)) / 100, 2);
  const rhPct = round(u16le(b, 8) / 100, 2);
  if (!inRange(tempC, rhPct)) return null;
  return {
    format: 'pvvx',
    mac: macText([...b.subarray(0, 6)].reverse()),
    tempC,
    rhPct,
    batteryPct: batteryOrNull(b[12]!),
    batteryMv: u16le(b, 10),
    counter: b[13]!,
  };
}

/**
 * Byte length of a BTHome v2 object's value by id, for the ids that can sit in front of or behind the three we read. An id not listed
 * ends the walk: objects come in ascending id order, so what was read before it stays valid, and what follows is unreachable.
 */
function bthomeLength(id: number): number | null {
  if (id === 0x00 || id === 0x01 || id === 0x09 || id === 0x46) return 1; // packet id, battery, count, UV index
  if (id >= 0x0f && id <= 0x11) return 1; // generic boolean, power, opening
  if (id >= 0x15 && id <= 0x2f) return 1; // booleans, humidity u8, moisture u8
  if (id === 0x3a) return 1; // button event
  switch (id) {
    case 0x02: // temperature
    case 0x03: // humidity
    case 0x06: // mass kg
    case 0x07: // mass lb
    case 0x08: // dew point
    case 0x0c: // voltage
    case 0x0d: // PM2.5
    case 0x0e: // PM10
    case 0x12: // CO2
    case 0x13: // TVOC
    case 0x14: // moisture
    case 0x3d: // count 16 bit
    case 0x3f: // rotation
    case 0x40: // distance mm
    case 0x41: // distance m
    case 0x43: // current
    case 0x44: // speed
    case 0x45: // temperature 0.1
    case 0x47: // volume
    case 0x48: // volume mL
    case 0x49: // volume flow rate
    case 0x4a: // voltage 0.1
      return 2;
    case 0x04: // pressure
    case 0x05: // illuminance
    case 0x0a: // energy
    case 0x0b: // power
    case 0x42: // duration
    case 0x4b: // gas
    case 0x4c: // gas total
      return 3;
    case 0x3e: // count 32 bit
    case 0x4d: // energy 32 bit
    case 0x4e: // volume 32 bit
    case 0x4f: // water
    case 0x50: // timestamp
      return 4;
    default:
      return null;
  }
}

/** BTHome v2. Needs temperature and humidity in the same frame (a sensor sending one of them per frame is not this thermometer). */
function decodeBthome(b: Uint8Array): ThermometerReading | null {
  if (b.length < 2) return null;
  const info = b[0]!;
  if (info & 0x01) return null; // encrypted: no key here
  if (info >> 5 !== 2) return null; // BTHome version 2 only
  let tempC: number | null = null;
  let rhPct: number | null = null;
  let batteryPct: number | null = null;
  let counter: number | null = null;
  let i = 1;
  while (i < b.length) {
    const id = b[i]!;
    const length = bthomeLength(id);
    if (length === null || i + 1 + length > b.length) break;
    const at = i + 1;
    if (id === 0x00) counter = b[at]!;
    else if (id === 0x01) batteryPct = batteryOrNull(b[at]!);
    else if (id === 0x02) tempC = round(signed16(u16le(b, at)) / 100, 2);
    else if (id === 0x03) rhPct = round(u16le(b, at) / 100, 2);
    i = at + length;
  }
  if (tempC === null || rhPct === null || !inRange(tempC, rhPct)) return null;
  return { format: 'bthome', mac: null, tempC, rhPct, batteryPct, batteryMv: null, counter };
}

/**
 * The reading an advertisement carries, or null when it carries none this decoder can read: no thermometer service data, a length that
 * fits neither format, an encrypted BTHome frame, or a temperature outside -20..60 C or humidity outside 0..100 %.
 * Never throws.
 */
export function decodeThermometerAdvert(frame: ThermometerFrame): ThermometerReading | null {
  const environment = toBytes(frame.serviceData[SERVICE_ENVIRONMENT]);
  if (environment) {
    const reading = decodeAtc1441(environment) ?? decodePvvx(environment);
    if (reading) return reading;
  }
  const bthome = toBytes(frame.serviceData[SERVICE_BTHOME]);
  return bthome ? decodeBthome(bthome) : null;
}

/** Whether an advertisement carries service data under a thermometer UUID (readable or not): the filter of the scan. */
export function hasThermometerService(frame: ThermometerFrame): boolean {
  return THERMOMETER_SERVICES.some((uuid) => frame.serviceData[uuid] !== undefined);
}

/** Names the community firmware and the stock units advertise: `ATC_8D18B2`, `LYWSD03MMC`, `MJ_HT_V1`, ... */
const THERMOMETER_NAME = /^(?:(?:ATC|PVVX|BTH)_[0-9A-F]{4,6}|LYWSD03MMC|MHO-C401|MHO-C303|LYWSDCGQ(?:\/01ZM)?|MJ_HT_V1|CGG1|CGDK2|CGD1|CGP1W|LYWSD02|XMWSDJ04MMC)$/i;

/** Whether an advertised name looks like a Xiaomi/ATC/PVVX thermometer. */
export function isThermometerName(name: string | null | undefined): boolean {
  return !!name && THERMOMETER_NAME.test(name.trim());
}

/** The same measurement seen again: dedupe state per sensor by its counter. A frame without a counter is always new. */
export class CounterDeduper {
  private readonly last = new Map<string, number>();

  /** True the first time a (sensor, counter) pair is seen after a different one; false for a repeat. */
  isNew(sensorId: string, counter: number | null): boolean {
    if (counter === null) return true;
    if (this.last.get(sensorId) === counter) return false;
    this.last.set(sensorId, counter);
    return true;
  }

  forget(sensorId: string): void {
    this.last.delete(sensorId);
  }
}

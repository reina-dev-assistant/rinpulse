import type { ScaleNative } from '@/features/scale/native';
import { nativeErrorCode } from '@/features/scale/native';
import { RH_MAX_PCT, RH_MIN_PCT, TEMP_MAX_C, TEMP_MIN_C } from '@/features/sensors/thermometerAdvert';

/**
 * The connected read of a stock-firmware Xiaomi thermometer (LYWSD03MMC and units with the same GATT table, no key). The sensor
 * notifies a 5 byte value on `ebe0ccc1` about every 6 s while someone listens: temperature int16 LE in 0.01 C, humidity u8 in %, battery
 * voltage u16 LE in mV (the notification shape the MiTemperature2 and LYWSD03MMC community projects document). This module connects through
 * the scale transport (`scaleConnect`, `scaleSubscribe`: the native side only moves bytes), waits for the first value, and lets go again,
 * because the sensor serves one connection at a time: while the app holds it, the Xiaomi app cannot, and a unit the Xiaomi app holds
 * cannot be connected here.
 */
export const LYWSD_SERVICE = 'ebe0ccb0-7a0a-4b0c-8a1a-6ff2997da3a6';
export const LYWSD_DATA = 'ebe0ccc1-7a0a-4b0c-8a1a-6ff2997da3a6';

export interface GattSample {
  tempC: number;
  rhPct: number;
  batteryMv: number;
  /** 0..100 from the cell voltage: 2.1 V is empty, 3.1 V full (the formula MiTemperature2 uses). */
  batteryPct: number;
}

/** The battery percentage of a CR2032 cell voltage in mV, the rough linear scale the community projects use. */
export const batteryPctFromMv = (mv: number): number => Math.max(0, Math.min(100, Math.round((mv - 2100) / 10)));

/** One notification of `ebe0ccc1` (hex), or null when it is not one or is outside what a room can be. */
export function parseLywsdNotification(hex: string): GattSample | null {
  const lower = hex.toLowerCase();
  if (lower.length < 10 || lower.length % 2 !== 0 || !/^[0-9a-f]+$/.test(lower)) return null;
  const byte = (i: number): number => parseInt(lower.slice(i * 2, i * 2 + 2), 16);
  const rawTemp = byte(0) | (byte(1) << 8);
  const tempC = Math.round(((rawTemp >= 0x8000 ? rawTemp - 0x10000 : rawTemp) / 100) * 100) / 100;
  const rhPct = byte(2);
  const batteryMv = byte(3) | (byte(4) << 8);
  if (tempC < TEMP_MIN_C || tempC > TEMP_MAX_C || rhPct < RH_MIN_PCT || rhPct > RH_MAX_PCT) return null;
  if (batteryMv < 1500 || batteryMv > 4000) return null;
  return { tempC, rhPct, batteryMv, batteryPct: batteryPctFromMv(batteryMv) };
}

export type GattFailure =
  /** Bluetooth is off. */
  | 'bluetooth'
  /** The Bluetooth permission is missing. */
  | 'permission'
  /** No link: out of range, asleep, or held by the Xiaomi app (the sensor takes one connection). */
  | 'unreachable'
  /** Connected, but the unit has no `ebe0ccb0` service: not a thermometer of this family (or running community firmware). */
  | 'noService'
  /** Connected and subscribed, but no value arrived in time. */
  | 'noData'
  | 'error';

export type GattResult = { ok: true; sample: GattSample; ts: number } | { ok: false; reason: GattFailure; detail: string | null };

/** The whole connection may take this long before it counts as unreachable (the native side gives up after 20 s itself). */
export const CONNECT_TIMEOUT_MS = 25_000;
/** After subscribing, the sensor notifies within about 6 s. */
export const DATA_TIMEOUT_MS = 15_000;

export interface ReadOptions {
  connectTimeoutMs?: number;
  dataTimeoutMs?: number;
}

const failure = (reason: GattFailure, detail: string | null = null): GattResult => ({ ok: false, reason, detail });

function fromNativeError(error: unknown): GattResult {
  const code = nativeErrorCode(error);
  if (code === 'ERR_BLUETOOTH_OFF') return failure('bluetooth', code);
  if (code === 'ERR_BLUETOOTH_PERMISSION') return failure('permission', code);
  if (code === 'ERR_SCALE_NO_CHARACTERISTIC') return failure('noService', code);
  return failure('error', code ?? (error instanceof Error ? error.message : String(error)));
}

/**
 * Connects, reads the first valid sample and disconnects. Never rejects: every way it can fail is a {@link GattFailure}. Nothing is written
 * to the sensor. The link is always dropped before this resolves.
 */
export function readLywsdOnce(native: ScaleNative, id: string, options: ReadOptions = {}): Promise<GattResult> {
  const connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  const dataTimeoutMs = options.dataTimeoutMs ?? DATA_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    let connected = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const subscriptions: { remove(): void }[] = [];

    const finish = (result: GattResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      for (const s of subscriptions) s.remove();
      void native.scaleDisconnect(id).catch(() => {});
      resolve(result);
    };

    const arm = (ms: number, result: GattResult): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish(result), ms);
    };

    subscriptions.push(
      native.addListener('onScaleLink', (event) => {
        if (event.id !== id || settled) return;
        if (event.state === 'disconnected') {
          finish(connected ? failure('noData', event.error) : failure('unreachable', event.error));
          return;
        }
        if (event.state !== 'connected' || connected) return;
        connected = true;
        const service = event.services.find((s) => s.uuid.toLowerCase() === LYWSD_SERVICE);
        if (!service?.characteristics.some((c) => c.uuid.toLowerCase() === LYWSD_DATA)) {
          finish(failure('noService', event.services.map((s) => s.uuid).join(',')));
          return;
        }
        arm(dataTimeoutMs, failure('noData'));
        native.scaleSubscribe(id, LYWSD_SERVICE, LYWSD_DATA).catch((e: unknown) => finish(fromNativeError(e)));
      }),
      native.addListener('onScaleValue', (event) => {
        if (event.id !== id || settled || event.service.toLowerCase() !== LYWSD_SERVICE || event.characteristic.toLowerCase() !== LYWSD_DATA) return;
        const sample = parseLywsdNotification(event.value);
        if (sample) finish({ ok: true, sample, ts: event.ts });
      }),
    );
    arm(connectTimeoutMs, failure('unreachable', 'connect timed out'));
    native.scaleConnect(id).catch((e: unknown) => finish(fromNativeError(e)));
  });
}

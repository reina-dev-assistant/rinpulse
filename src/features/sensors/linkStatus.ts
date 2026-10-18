/**
 * What a sensor row and a recording's status line say about one sensor, decided from the hub's `LinkInfo` and the clock. Pure (no React
 * Native imports): runs under bun test. The words live in i18n (`watch:sensors.status.*`).
 */
import type { CscMode } from './gatt';
import type { LinkInfo } from './hub';

/** Why a connect attempt or a link ended, from the English text the native module reports (Android and iOS word it alike). */
export type FailureKind = 'notFound' | 'lost' | 'bluetoothOff' | 'permission' | 'other';

/**
 * `notFound`: the attempt never reached the sensor (it timed out, or Android reported a failed connect: a sensor that sleeps until its
 * crank turns does exactly this). `lost`: a link that was up ended (the sensor went to sleep, or moved out of range). Null for no error.
 */
export function failureKind(error: string | null): FailureKind | null {
  if (error === null || error === '') return null;
  if (/bluetooth (turned )?off/i.test(error)) return 'bluetoothOff';
  if (/permission/i.test(error)) return 'permission';
  if (/connecting timed out|GATT status (133|62)\b|connection failed|did not create a GATT client|connectGatt failed/i.test(error)) return 'notFound';
  if (/GATT status (8|19|22)\b|connection timeout|disconnected by the sensor|timed out/i.test(error)) return 'lost';
  return 'other';
}

/**
 * A crank or wheel sensor sends nothing while the part stands still, so a connected sensor with no new value for this many seconds is
 * "quiet" (it is waiting for the pedals), not broken.
 */
export const QUIET_AFTER_S = 5;

/**
 * `idle`: not connected and nothing asked for. `connecting`: the first attempt is running. `searching`: an attempt failed and the link keeps
 * trying in the background (sensor asleep or away). `failed`: an error trying again will not fix (Bluetooth off, no permission, other).
 * `waiting`: connected, no value yet. `receiving`: connected with a recent value. `quiet`: connected, last value older than `QUIET_AFTER_S`.
 */
export type SensorPhase = 'idle' | 'connecting' | 'searching' | 'failed' | 'waiting' | 'receiving' | 'quiet';

export interface SensorStatus {
  phase: SensorPhase;
  failure: FailureKind | null;
  /** Whole seconds since the last value from the sensor, null when it never sent one. */
  ageSec: number | null;
  /** What its CSC frames carry, null before the first one and for other sensors. */
  mode: CscMode | null;
}

/** Link-level fields of `LinkInfo` the status needs; a sensor the radio does not know yet is `undefined`. */
export type StatusLink = Pick<LinkInfo, 'state' | 'frames' | 'lastValueAt' | 'cscMode' | 'lastFailure' | 'error'>;

export function sensorStatus(link: StatusLink | undefined, now: number): SensorStatus {
  const failure = failureKind(link?.lastFailure ?? link?.error ?? null);
  const ageSec = link && link.lastValueAt !== null ? Math.max(0, Math.floor((now - link.lastValueAt) / 1000)) : null;
  const mode = link?.cscMode ?? null;
  const state = link?.state ?? 'disconnected';
  const retrying = failure === 'notFound' || failure === 'lost';
  let phase: SensorPhase;
  if (state === 'connected') {
    phase = !link || link.frames === 0 ? 'waiting' : ageSec !== null && ageSec > QUIET_AFTER_S ? 'quiet' : 'receiving';
  } else if (state === 'connecting') {
    phase = retrying ? 'searching' : failure !== null ? 'failed' : 'connecting';
  } else {
    phase = retrying ? 'searching' : failure !== null ? 'failed' : 'idle';
  }
  return { phase, failure: state === 'connected' ? null : failure, ageSec, mode };
}

/** The sensor is not connected right now (what "Sambungkan" is for). */
export const isDown = (status: SensorStatus): boolean => status.phase === 'idle' || status.phase === 'searching' || status.phase === 'failed';

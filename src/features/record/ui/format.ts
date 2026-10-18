/**
 * What the recording screens decide and format, without React Native: which figure suits a sport, how good the GPS is, which
 * permission still has to be asked, which tiles a recording shows. Runs under bun test.
 */
import { fmtDecimal } from '@/i18n';

import { SPORT_ROWS, type ManualSport } from '../../workouts/manual';
import { GPS_SPORTS } from '../controller';
import { MAX_FIX_ACCURACY_M, type LiveStats, type RecordedLap } from '../recorder';

export type GpsStatus = 'searching' | 'ready' | 'fair' | 'weak';

/** A fix older than this (seconds) is not the position any more: the signal is gone. */
export const GPS_STALE_SEC = 10;

/** A fix this accurate (metres) is "ready" at once; the recorder accepts up to 35 m, and accuracy keeps improving while it records. */
export const GPS_READY_ACCURACY_M = 25;

/** A fix between 25 and 35 m is "ready" too once the fixes have been that good for this long (seconds): waiting longer rarely helps. */
export const GPS_SETTLE_SEC = 4;

/** A GPS fix as the snapshot (`fix`) and the live numbers (`fixAccuracyM`, `fixAgeSec`) report it. */
export interface FixInfo {
  accuracyM: number | null;
  ageSec: number | null;
  /**
   * Seconds the fixes have been good enough for the recorder in a row, null while the newest is not. Left out (undefined) where nobody
   * measures it (while recording): the signal counts as settled then.
   */
  usableSec?: number | null;
}

/**
 * `searching` until a fresh fix arrives, `weak` while the newest fix is worse than the recorder accepts (35 m, it ignores those),
 * `fair` while it is usable (25-35 m) but has not held for `GPS_SETTLE_SEC` yet, `ready` otherwise. A fix without an accuracy figure is
 * used by the recorder, so it counts as ready.
 */
export function gpsStatus(fix: FixInfo | null): GpsStatus {
  if (!fix || fix.ageSec === null || fix.ageSec > GPS_STALE_SEC) return 'searching';
  if (fix.accuracyM !== null && fix.accuracyM > MAX_FIX_ACCURACY_M) return 'weak';
  if (fix.accuracyM === null || fix.accuracyM <= GPS_READY_ACCURACY_M || fix.usableSec === undefined) return 'ready';
  return (fix.usableSec ?? 0) >= GPS_SETTLE_SEC ? 'ready' : 'fair';
}

export type SpeedKind = 'pace' | 'speed';

/** Pace (min/km) for the foot sports, speed (km/h) for the rest. */
export function speedKind(sport: ManualSport): SpeedKind {
  return SPORT_ROWS[sport].foot ? 'pace' : 'speed';
}

/** Slower than this (m/s, a 33:20 min/km pace) is standing still, not a pace worth printing. */
const MIN_PACE_SPEED_MPS = 0.5;

/** Seconds per kilometre for a ground speed, null when standing still or unknown. */
export function paceSecPerKm(speedMps: number | null): number | null {
  if (speedMps === null || !Number.isFinite(speedMps) || speedMps < MIN_PACE_SPEED_MPS) return null;
  return 1000 / speedMps;
}

/** `5:32` for seconds per kilometre. */
export function paceText(secPerKm: number): string {
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The figure a live screen shows for `speedMps`: `5:32` (min/km) on foot, `19,8` (km/h) on wheels; null value = no reading. */
export function speedFigure(sport: ManualSport, speedMps: number | null): { kind: SpeedKind; value: string | null } {
  const kind = speedKind(sport);
  if (kind === 'pace') {
    const pace = paceSecPerKm(speedMps);
    return { kind, value: pace === null ? null : paceText(pace) };
  }
  return { kind, value: speedMps === null || !Number.isFinite(speedMps) ? null : fmtDecimal(Math.max(0, speedMps) * 3.6, 1) };
}

export type PermissionAnswer = 'unknown' | 'granted' | 'denied' | 'blocked';

export interface PermissionPlan {
  /** An outdoor sport records the phone's GPS. */
  location: boolean;
  /** Paired sensors will be connected. */
  bluetooth: boolean;
}

/** What the recording of `sport` asks the person for: precise location outdoors, Bluetooth when a paired sensor will connect. */
export function permissionPlan(sport: ManualSport, autoSensors: number): PermissionPlan {
  return { location: GPS_SPORTS.includes(sport), bluetooth: autoSensors > 0 };
}

/**
 * Whether "Mulai" may call `prepare`. An outdoor sport cannot record without precise location, so that must be granted first. A
 * Bluetooth refusal does not stop a recording (it runs without the sensors, the next screen says so), but the question has to
 * have been asked, so the explanation card comes first.
 */
export function canPrepare(plan: PermissionPlan, location: PermissionAnswer, bluetooth: PermissionAnswer): boolean {
  if (plan.location && location !== 'granted') return false;
  if (plan.bluetooth && bluetooth === 'unknown') return false;
  return true;
}

export type SensorErrorKind = 'off' | 'permission' | 'unavailable' | 'other';

/** The failure of a sensor connect (`snapshot.sensorError`, a native error code) as the kind of message to show. */
export function sensorErrorKind(code: string): SensorErrorKind {
  if (code === 'ERR_BLUETOOTH_OFF') return 'off';
  if (code === 'ERR_BLUETOOTH_PERMISSION') return 'permission';
  if (code === 'ERR_BLUETOOTH_UNAVAILABLE') return 'unavailable';
  return 'other';
}

/** The channels a sensor can deliver (see `kindChannels`). */
export type SensorChannel = 'hr' | 'speed' | 'cadence' | 'power' | 'pod';

export interface LiveTiles {
  hr: boolean;
  cadence: boolean;
  power: boolean;
}

/**
 * Which optional figures a recording shows: those a connected sensor can deliver (so a dropout reads `--`, not a vanished tile) and
 * those that have a reading.
 */
export function liveTiles(live: Pick<LiveStats, 'hr' | 'cadence' | 'watts'>, channels: ReadonlySet<SensorChannel>): LiveTiles {
  return {
    hr: channels.has('hr') || live.hr !== null,
    cadence: channels.has('cadence') || channels.has('pod') || live.cadence !== null,
    power: channels.has('power') || live.watts !== null,
  };
}

export interface LapRow {
  number: number;
  distanceM: number;
  movingSec: number;
  avgHr: number | null;
}

/** The finished laps, the latest first, numbered the way the recorder numbers them. */
export function lapRows(laps: readonly RecordedLap[]): LapRow[] {
  return laps
    .map((l, i) => ({ number: i + 1, distanceM: l.distanceM, movingSec: l.movingSec, avgHr: l.avgHr }))
    .reverse();
}

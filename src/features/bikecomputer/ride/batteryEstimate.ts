/**
 * How long the phone battery lasts for a ride, shown on the Ready screen before the start.
 *
 * hours left = (battery % - reserve %) / (drain in % per hour). The drain comes from a model of the ride profile (screen, map,
 * sensors, live tracking, GPS) until the rider has rides on record with the same profile: their measured drain then replaces the
 * model, blended in as the number of rides grows and fully used from three rides on. Pure: no clock, no storage; the caller keeps the
 * history (`measuredPctPerHour` turns a finished ride into one entry).
 */

/**
 * Percent of the battery per hour that each part of a ride costs. All of these are [INFERENCE]: unmeasured defaults picked so a dim
 * screen with GPS lands near the 8 to 12 %/h and a bright screen with the map near the 15 to 25 %/h that docs/bike-computer.md
 * section 9 guesses. The rider's own rides (`history`) replace them.
 */
export const BATTERY_MODEL = {
  /** The phone idling with the app in the foreground and the Bluetooth radio on. */
  base: 3,
  gps: 4,
  screen: { off: 0, dim: 2.5, bright: 9 },
  map: 3,
  /** Per connected sensor, up to `maxSensors`. */
  perSensor: 0.7,
  maxSensors: 3,
  /** Mobile data for the live tracking link. */
  liveShare: 2.5,
} as const;

export interface BatteryProfile {
  screen: 'off' | 'dim' | 'bright';
  map: boolean;
  /** Connected sensors (strap, power meter, speed and cadence, ...). */
  sensors: number;
  liveShare: boolean;
  gps: true;
}

export interface BatteryHistoryEntry {
  profileKey: string;
  pctPerHour: number;
  /** How many rides the entry stands for (1 for a ride; a stored average may carry more). */
  weight: number;
}

export interface BatteryInput {
  batteryPct: number;
  charging: boolean;
  /** Percent kept in reserve (default 10): the ride is planned to end before the battery gets there. */
  reservePct?: number;
  profile: BatteryProfile;
  /** Moving time the rider plans to ride, seconds; null when there is no plan. */
  plannedSec: number | null;
  history: BatteryHistoryEntry[];
}

export interface BatteryEstimate {
  pctPerHour: number;
  hoursLeft: number;
  source: 'model' | 'measured' | 'blend';
  /** Whether the battery covers `plannedSec`; null without a plan. */
  enough: boolean | null;
  /** `short`: the plan needs more than the battery gives. `tight`: it fits with less than 25 % to spare. Never while charging. */
  warn: 'none' | 'tight' | 'short';
}

/** Rides of the same profile after which the measured drain is used alone. */
const HISTORY_SATURATION = 3;
const DEFAULT_RESERVE_PCT = 10;
const TIGHT_MARGIN = 0.25;
/** A ride must have lasted this long to say anything about the drain per hour, seconds. */
const MIN_MEASURED_SEC = 20 * 60;
/** The battery must have dropped this many points, otherwise the percent's resolution dominates. */
const MIN_MEASURED_DROP = 2;

/** The model's drain in percent per hour for `profile`. */
export function modelPctPerHour(profile: BatteryProfile): number {
  const m = BATTERY_MODEL;
  const sensors = Math.min(Math.max(0, Math.floor(profile.sensors)), m.maxSensors);
  return m.base + m.gps + m.screen[profile.screen] + (profile.map ? m.map : 0) + sensors * m.perSensor + (profile.liveShare ? m.liveShare : 0);
}

/** The key under which a ride's measured drain is stored and found again: rides with the same key are comparable. */
export function profileKey(profile: BatteryProfile): string {
  const sensors = Math.min(Math.max(0, Math.floor(profile.sensors)), BATTERY_MODEL.maxSensors);
  return `${profile.screen}|map${profile.map ? 1 : 0}|s${sensors}|live${profile.liveShare ? 1 : 0}`;
}

/**
 * Percent per hour a finished ride used, rounded to 0.1; null when the ride cannot say: the phone charged during it, it lasted under
 * 20 minutes, or the battery dropped less than 2 points.
 */
export function measuredPctPerHour(startPct: number, endPct: number, movingSec: number, charged: boolean): number | null {
  if (charged || !(movingSec >= MIN_MEASURED_SEC)) return null;
  const drop = startPct - endPct;
  if (!(drop >= MIN_MEASURED_DROP)) return null;
  return Math.round((drop / (movingSec / 3600)) * 10) / 10;
}

/** The profile the battery saver switches to: dim screen (an off screen stays off), no map, the live link and the sensors kept. */
export function saverProfile(profile: BatteryProfile): BatteryProfile {
  return { ...profile, screen: profile.screen === 'off' ? 'off' : 'dim', map: false };
}

export function estimateBattery(input: BatteryInput): BatteryEstimate {
  const model = modelPctPerHour(input.profile);
  const key = profileKey(input.profile);

  let weight = 0;
  let weighted = 0;
  for (const h of input.history) {
    if (h.profileKey !== key || !(h.weight > 0) || !(h.pctPerHour > 0) || !Number.isFinite(h.pctPerHour)) continue;
    weight += h.weight;
    weighted += h.pctPerHour * h.weight;
  }

  let pctPerHour = model;
  let source: BatteryEstimate['source'] = 'model';
  if (weight > 0) {
    const measured = weighted / weight;
    const share = Math.min(weight, HISTORY_SATURATION) / HISTORY_SATURATION;
    pctPerHour = share * measured + (1 - share) * model;
    source = weight >= HISTORY_SATURATION ? 'measured' : 'blend';
  }

  const reserve = input.reservePct ?? DEFAULT_RESERVE_PCT;
  const usable = Math.max(0, Math.min(100, input.batteryPct) - reserve);
  const hoursLeft = usable / pctPerHour;

  const availableSec = hoursLeft * 3600;
  const enough = input.plannedSec === null ? null : availableSec >= input.plannedSec;
  let warn: BatteryEstimate['warn'] = 'none';
  if (input.plannedSec !== null && !input.charging) {
    if (availableSec < input.plannedSec) warn = 'short';
    else if (availableSec <= input.plannedSec * (1 + TIGHT_MARGIN)) warn = 'tight';
  }
  return { pctPerHour, hoursLeft, source, enough, warn };
}

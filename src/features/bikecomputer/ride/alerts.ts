/**
 * Ride alerts: given the readings of this second, which alerts fire now. Deterministic from the inputs and the state left by earlier
 * calls (no timers, no clock: `nowMs` and `movingSec` are arguments), so a test drives it second by second.
 *
 * - Zone alerts (heart rate, power, cadence): the value must sit outside the allowed band for `ZONE_DWELL_MS` without a break before
 *   the first alert, then it repeats every `ZONE_REPEAT_MS` while still outside, and re-arms when the value is back inside. A reading
 *   of null (and 0 rpm for cadence: coasting) breaks the run and fires nothing. Switching from too low to too high starts the dwell again.
 * - Eat and drink reminders: by moving time and/or distance, first alert after one interval, the next one an interval later (counted
 *   from the multiple, so a late tick does not drift). Nothing fires while `movingSec` is not advancing (a pause, a stop). The first call
 *   only sets the counters, so a restored ride does not fire the intervals it already passed.
 * - The rest are events: off course (once per excursion, `backOnCourse` once on return), low battery (20 % and 10 %, not while
 *   charging), sensor lost, GPS lost / back, auto-lap, turn (300, 100, 30 m).
 *
 * Heart rate zones use the bounds of `heartZone` in `features/live/liveWorkout` (50, 60, 70, 80, 90 % of the maximum), copied here
 * because that module imports i18n and the wear bridge. Below 50 % counts as zone 1, so `minZone: 1` never raises a low alert.
 * Zone alerts carry the zone number as `value`, cadence alerts the rpm.
 */
import { zoneBounds } from '@/features/cycling/power';

import type { AlertConfig, AlertKind, ReminderAlert, RideAlert, ZoneAlert } from '../types';

export const ZONE_DWELL_MS = 10_000;
export const ZONE_REPEAT_MS = 30_000;
/** Phone battery levels (percent) that alert, highest first. */
export const LOW_BATTERY_LEVELS: readonly [number, number] = [20, 10];
/** A battery that rose this many points above a level can alert at it again. */
const BATTERY_REARM_MARGIN = 5;
/** GPS counts as lost when the last fix is older than this, seconds. */
export const GPS_LOST_AFTER_SEC = 10;
/** Distances to the next turn that alert, metres, farthest first. */
export const TURN_ALERT_M: readonly number[] = [300, 100, 30];
/** A `turnInM` that grows by more than this since the last call is a new turn. */
const TURN_REARM_JUMP_M = 20;

/** Lower bounds, as shares of the maximum heart rate, of zones 2 to 5. */
const HR_ZONE_FROM: readonly number[] = [0.6, 0.7, 0.8, 0.9];

export interface AlertProfile {
  maxHr: number | null;
  ftp: number | null;
}

export interface AlertInput {
  nowMs: number;
  /** Moving time of the ride, seconds; stands still while the recorder is paused. */
  movingSec: number;
  /** Recorded distance, metres. */
  distanceM: number;
  hr: number | null;
  watts: number | null;
  cadence: number | null;
  offCourse: boolean;
  batteryPct: number | null;
  charging: boolean;
  /** Ids of the sensors lost right now (only sensors that were connected earlier). */
  sensorsLost: string[];
  /** Seconds since the last GPS fix; null when unknown. */
  fixAgeSec: number | null;
  /** An automatic lap was triggered in this update. */
  autoLapped: boolean;
  /** Metres to the next turn; null or absent when there is none. */
  turnInM?: number | null;
}

type Side = 'low' | 'high';

/** The dwell and repeat timing of one zone alert. */
class Dwell {
  private side: Side | null = null;
  private sinceMs = 0;
  private lastFiredMs: number | null = null;

  /** `side` is where the value is now (null: inside the band or unknown). Returns the side to alert about, or null. */
  step(side: Side | null, nowMs: number): Side | null {
    if (side === null) {
      this.side = null;
      this.lastFiredMs = null;
      return null;
    }
    if (side !== this.side) {
      this.side = side;
      this.sinceMs = nowMs;
      this.lastFiredMs = null;
    }
    const due = this.lastFiredMs === null ? this.sinceMs + ZONE_DWELL_MS : this.lastFiredMs + ZONE_REPEAT_MS;
    if (nowMs < due) return null;
    this.lastFiredMs = nowMs;
    return side;
  }
}

/** The next multiple of `every` above `value`. */
function nextMultiple(value: number, every: number): number {
  return (Math.floor(value / every) + 1) * every;
}

class Reminder {
  private ready = false;
  private nextSec: number | null = null;
  private nextM: number | null = null;

  /** True when the reminder is due. `advancing`: the moving time grew since the last call. */
  step(cfg: ReminderAlert, movingSec: number, distanceM: number, advancing: boolean): boolean {
    if (!cfg.enabled) return false;
    const everySec = cfg.everySec !== null && cfg.everySec > 0 ? cfg.everySec : null;
    const everyM = cfg.everyM !== null && cfg.everyM > 0 ? cfg.everyM : null;
    if (!this.ready) {
      this.ready = true;
      this.nextSec = everySec === null ? null : nextMultiple(movingSec, everySec);
      this.nextM = everyM === null ? null : nextMultiple(distanceM, everyM);
      return false;
    }
    if (!advancing) return false;
    let due = false;
    if (everySec !== null && this.nextSec !== null && movingSec >= this.nextSec) {
      due = true;
      this.nextSec = nextMultiple(movingSec, everySec);
    }
    if (everyM !== null && this.nextM !== null && distanceM >= this.nextM) {
      due = true;
      this.nextM = nextMultiple(distanceM, everyM);
    }
    return due;
  }
}

export class AlertEngine {
  private readonly hrDwell = new Dwell();
  private readonly powerDwell = new Dwell();
  private readonly cadenceDwell = new Dwell();
  private readonly eat = new Reminder();
  private readonly drink = new Reminder();
  private prevMovingSec: number | null = null;
  private wasOffCourse = false;
  private fired20 = false;
  private fired10 = false;
  private knownLost = new Set<string>();
  private gpsLost = false;
  private wasAutoLapped = false;
  private turnFired = new Set<number>();
  private lastTurnInM: number | null = null;

  constructor(
    private readonly cfg: AlertConfig,
    private readonly profile: AlertProfile,
  ) {}

  /** The alerts that fire now, in a fixed order (zones, reminders, course, battery, sensors, GPS, lap, turn). */
  update(input: AlertInput): RideAlert[] {
    const out: RideAlert[] = [];
    const at = input.nowMs;
    const push = (kind: AlertKind, value: number | null): void => {
      out.push({ kind, at, value });
    };

    this.zones(input, push);

    const advancing = this.prevMovingSec !== null && input.movingSec > this.prevMovingSec;
    this.prevMovingSec = input.movingSec;
    if (this.eat.step(this.cfg.eat, input.movingSec, input.distanceM, advancing)) push('eat', null);
    if (this.drink.step(this.cfg.drink, input.movingSec, input.distanceM, advancing)) push('drink', null);

    if (input.offCourse !== this.wasOffCourse) {
      this.wasOffCourse = input.offCourse;
      if (this.cfg.offCourse) push(input.offCourse ? 'offCourse' : 'backOnCourse', null);
    }

    this.battery(input, push);

    const newlyLost = input.sensorsLost.filter((id) => !this.knownLost.has(id));
    this.knownLost = new Set(input.sensorsLost);
    if (newlyLost.length > 0 && this.cfg.sensorLost) push('sensorLost', input.sensorsLost.length);

    this.gps(input.fixAgeSec, push);

    if (input.autoLapped && !this.wasAutoLapped) push('autoLap', null);
    this.wasAutoLapped = input.autoLapped;

    this.turn(input.turnInM ?? null, push);
    return out;
  }

  private zones(input: AlertInput, push: (kind: AlertKind, value: number | null) => void): void {
    const { hr, power, cadence } = this.cfg;

    let hrZone: number | null = null;
    if (hr.enabled && input.hr !== null && this.profile.maxHr !== null && this.profile.maxHr > 0) {
      const pct = input.hr / this.profile.maxHr;
      hrZone = 1 + HR_ZONE_FROM.filter((from) => pct >= from).length;
    }
    this.zoneStep(this.hrDwell, hr, hrZone, input.nowMs, 'hrLow', 'hrHigh', push);

    let powerZone: number | null = null;
    if (power.enabled && input.watts !== null && this.profile.ftp !== null && this.profile.ftp > 0) {
      const watts = input.watts;
      powerZone = Math.max(1, zoneBounds(this.profile.ftp).filter((z) => watts >= z.fromW).length);
    }
    this.zoneStep(this.powerDwell, power, powerZone, input.nowMs, 'powerLow', 'powerHigh', push);

    let side: Side | null = null;
    // 0 rpm is coasting, not a low cadence.
    if (cadence.enabled && input.cadence !== null && input.cadence > 0) {
      if (input.cadence < cadence.minRpm) side = 'low';
      else if (input.cadence > cadence.maxRpm) side = 'high';
    }
    const fired = this.cadenceDwell.step(side, input.nowMs);
    if (fired !== null) push(fired === 'low' ? 'cadenceLow' : 'cadenceHigh', input.cadence === null ? null : Math.round(input.cadence));
  }

  private zoneStep(
    dwell: Dwell,
    band: ZoneAlert,
    zone: number | null,
    nowMs: number,
    lowKind: AlertKind,
    highKind: AlertKind,
    push: (kind: AlertKind, value: number | null) => void,
  ): void {
    let side: Side | null = null;
    if (zone !== null) {
      if (zone < band.minZone) side = 'low';
      else if (zone > band.maxZone) side = 'high';
    }
    const fired = dwell.step(side, nowMs);
    if (fired !== null) push(fired === 'low' ? lowKind : highKind, zone);
  }

  private battery(input: AlertInput, push: (kind: AlertKind, value: number | null) => void): void {
    const pct = input.batteryPct;
    if (pct === null) return;
    const [first, second] = LOW_BATTERY_LEVELS;
    // Charged back up: the levels can alert again.
    if (pct >= first + BATTERY_REARM_MARGIN) this.fired20 = false;
    if (pct >= second + BATTERY_REARM_MARGIN) this.fired10 = false;
    if (input.charging || !this.cfg.lowBattery) return;
    if (pct <= second && !this.fired10) {
      // Straight to the lower level: one alert, the 20 % one is spent too.
      this.fired10 = true;
      this.fired20 = true;
      push('lowBattery', Math.round(pct));
    } else if (pct <= first && !this.fired20) {
      this.fired20 = true;
      push('lowBattery', Math.round(pct));
    }
  }

  private gps(fixAgeSec: number | null, push: (kind: AlertKind, value: number | null) => void): void {
    if (fixAgeSec === null) return;
    if (fixAgeSec > GPS_LOST_AFTER_SEC && !this.gpsLost) {
      this.gpsLost = true;
      if (this.cfg.gpsLost) push('gpsLost', Math.round(fixAgeSec));
    } else if (fixAgeSec <= GPS_LOST_AFTER_SEC && this.gpsLost) {
      this.gpsLost = false;
      if (this.cfg.gpsLost) push('gpsBack', null);
    }
  }

  private turn(turnInM: number | null, push: (kind: AlertKind, value: number | null) => void): void {
    if (turnInM === null) return;
    if (this.lastTurnInM !== null && turnInM > this.lastTurnInM + TURN_REARM_JUMP_M) this.turnFired.clear();
    this.lastTurnInM = turnInM;
    // The nearest level already passed is the one to announce; the farther ones are spent with it.
    let due: number | null = null;
    for (const level of TURN_ALERT_M) if (turnInM <= level && !this.turnFired.has(level)) due = level;
    if (due === null) return;
    for (const level of TURN_ALERT_M) if (level >= due) this.turnFired.add(level);
    push('turn', due);
  }
}

const SHORT = 150;

/**
 * Vibration patterns for React Native `Vibration.vibrate(pattern)`: [wait, vibrate, wait, vibrate, ...] in ms (Android; iOS plays one
 * fixed buzz per call and ignores the lengths). Every pattern starts with a wait of 0, stays under 1.5 s and differs from the others:
 * heart rate = long beats, power = medium beats, cadence = short beats, reminders = short taps (eat 2, drink 3), course and GPS =
 * long then short, battery and sensors in between, info events one tap.
 */
const PATTERNS: Record<AlertKind, readonly number[]> = {
  hrHigh: [0, 500, 150, 500],
  hrLow: [0, 500, 150, 150],
  powerHigh: [0, 250, 100, 250, 100, 250],
  powerLow: [0, 250, 100, 250],
  cadenceHigh: [0, 100, 80, 100, 80, 100, 80, 100],
  cadenceLow: [0, 100, 100, 100, 100, 300],
  eat: [0, SHORT, SHORT, SHORT],
  drink: [0, SHORT, SHORT, SHORT, SHORT, SHORT],
  offCourse: [0, 800, 200, 400],
  backOnCourse: [0, 300],
  lowBattery: [0, 400, 200, 400],
  sensorLost: [0, 200, 100, 200, 100, 400],
  gpsLost: [0, 600, 150, 200, 150, 200],
  gpsBack: [0, 200],
  autoLap: [0, 120],
  turn: [0, 120, 100, 120],
};

export function vibrationPattern(kind: AlertKind): number[] {
  return [...PATTERNS[kind]];
}

const PRIORITIES: Record<AlertKind, 'info' | 'warn' | 'urgent'> = {
  hrHigh: 'urgent',
  offCourse: 'urgent',
  lowBattery: 'urgent',
  gpsLost: 'urgent',
  hrLow: 'warn',
  powerHigh: 'warn',
  powerLow: 'warn',
  cadenceHigh: 'warn',
  cadenceLow: 'warn',
  sensorLost: 'warn',
  turn: 'warn',
  eat: 'info',
  drink: 'info',
  backOnCourse: 'info',
  gpsBack: 'info',
  autoLap: 'info',
};

/** How loud an alert is: `urgent` stays on screen until dismissed and always vibrates, `info` is a brief banner. */
export function alertPriority(kind: AlertKind): 'info' | 'warn' | 'urgent' {
  return PRIORITIES[kind];
}

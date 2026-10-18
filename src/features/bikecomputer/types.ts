/**
 * Shared contracts of bike computer mode (docs/bike-computer.md). Types and constants only: no React Native, no I/O, so every engine
 * runs under `bun test`. Each module below implements or consumes one of these shapes; change a shape here first.
 */

// ---------------------------------------------------------------------------------------------------------------------
// data fields and pages

export const FIELD_IDS = [
  // speed
  'speed',
  'avgSpeed',
  'maxSpeed',
  'lapSpeed',
  // cadence, heart rate
  'cadence',
  'avgCadence',
  'hr',
  'avgHr',
  'hrZone',
  // power
  'power',
  'power3s',
  'power10s',
  'avgPower',
  'normPower',
  'powerZone',
  'estPower',
  // distance and time
  'distance',
  'lapDistance',
  'distanceToFinish',
  'distanceToTurn',
  'movingTime',
  'elapsedTime',
  'lapTime',
  'timeOfDay',
  'eta',
  // terrain
  'altitude',
  'ascent',
  'descent',
  'grade',
  'climbRemaining',
  // phone and energy
  'calories',
  'battery',
] as const;

export type FieldId = (typeof FIELD_IDS)[number];

/** Number of fields on a data page; the grid shape follows from it and from the screen's aspect. */
export const GRID_SIZES = [1, 2, 4, 6, 8] as const;
export type GridSize = (typeof GRID_SIZES)[number];

export interface FieldsPage {
  /** Stable within a layout; used as a React key and when reordering. */
  id: string;
  kind: 'fields';
  grid: GridSize;
  /** Exactly `grid` entries; a missing slot is filled from the default by `normalizeLayout`. */
  fields: FieldId[];
}

export interface SpecialPage {
  id: string;
  kind: 'map' | 'climb' | 'laps';
}

export type RidePage = FieldsPage | SpecialPage;

export interface BikeLayout {
  version: 1;
  pages: RidePage[];
}

export const MAX_PAGES = 8;

/** How a field draws its value: colour hint for zones and alert states. */
export type FieldTone = 'neutral' | 'zone1' | 'zone2' | 'zone3' | 'zone4' | 'zone5' | 'zone6' | 'zone7' | 'warn';

/** The text of one field cell. `value` is already localised (comma or dot, units apart); `--` when the source has no reading. */
export interface FieldValue {
  value: string;
  /** `km/h`, `bpm`, ...; null when the value carries its own (clock time, `3:20`). */
  unit: string | null;
  tone: FieldTone;
  /** Smaller second line, e.g. the zone name; null for none. */
  sub: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// readings: what the engines produce and the fields read

/** Rolling figures of the ride so far (`ride/metrics.ts`). Every field is null until it has data. Speeds in m/s. */
export interface BikeMetricsSnapshot {
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
  lapAvgSpeedMps: number | null;
  avgCadence: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgPower: number | null;
  power3s: number | null;
  power10s: number | null;
  normPower: number | null;
  /** Metres, smoothed GPS altitude; null while there has been no altitude. */
  altitudeM: number | null;
  ascentM: number;
  descentM: number;
  /** Percent, smoothed over about 150 m; null under 5 km/h or without altitude. */
  gradePct: number | null;
  /** Watts the speed, grade and weight imply (no power meter needed); null while standing still or without speed. */
  estPowerW: number | null;
}

export type TurnKind = 'slightLeft' | 'left' | 'sharpLeft' | 'slightRight' | 'right' | 'sharpRight' | 'uTurn' | 'start' | 'finish';

export interface TurnCue {
  kind: TurnKind;
  /** Metres from the start of the route. */
  atM: number;
  lat: number;
  lon: number;
}

export type ClimbCategory = 4 | 3 | 2 | 1 | 'HC' | null;

/** A climb of the followed route (ClimbPro rules, `cycling/climbs.ts`). */
export interface RouteClimb {
  startM: number;
  endM: number;
  lengthM: number;
  ascentM: number;
  avgGradePct: number;
  maxGradePct: number;
  category: ClimbCategory;
}

export interface NavSnapshot {
  routeId: string;
  /** Metres along the route of the rider's matched position. */
  distanceDoneM: number;
  distanceToFinishM: number;
  /** Seconds to the finish at the recent moving speed; null when standing still or no speed yet. */
  etaSec: number | null;
  /** Rider is farther from the route than the off-course threshold (after the dwell time). */
  offCourse: boolean;
  /** Metres from the route; null without a fix. */
  offCourseM: number | null;
  /** The next cue ahead of the rider, null at the finish. */
  nextCue: { cue: TurnCue; distanceM: number } | null;
  /** The climb in progress or the next one ahead, null when none is left. */
  climb: { climb: RouteClimb; startsInM: number; remainingAscentM: number; remainingM: number; inProgress: boolean } | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// settings (persisted by `settings.ts`, one key-value entry per group under `joyofit.bike.*`)

export type RideThemeSetting = 'auto' | 'day' | 'night';

export interface BikeSettings {
  /** The mode: Ride uses the bike computer screen when true. */
  enabled: boolean;
  theme: RideThemeSetting;
  /** Dim the screen after `dimAfterSec` without a touch. */
  dim: boolean;
  dimAfterSec: number;
  /** 0..1 brightness while dimmed. */
  dimLevel: number;
  autoPause: boolean;
  autoLap: AutoLapConfig;
  alerts: AlertConfig;
  /** Off-course threshold in metres (30..200). */
  offCourseM: number;
  /** Share the position with a live tracking link while riding. */
  liveShare: boolean;
}

export type AutoLapConfig = { mode: 'off' } | { mode: 'distance'; everyM: number } | { mode: 'start' };

export interface ZoneAlert {
  enabled: boolean;
  /** Fire when the zone number is below `minZone` or above `maxZone` (1-based, inclusive band that is fine). */
  minZone: number;
  maxZone: number;
}

export interface CadenceAlert {
  enabled: boolean;
  minRpm: number;
  maxRpm: number;
}

export interface ReminderAlert {
  enabled: boolean;
  /** Every `everySec` seconds of moving time (eat/drink by time) or every `everyM` metres; either may be null. */
  everySec: number | null;
  everyM: number | null;
}

export interface AlertConfig {
  hr: ZoneAlert;
  power: ZoneAlert;
  cadence: CadenceAlert;
  eat: ReminderAlert;
  drink: ReminderAlert;
  offCourse: boolean;
  lowBattery: boolean;
  sensorLost: boolean;
  gpsLost: boolean;
  /** Vibration pattern on an alert. */
  vibrate: boolean;
  /** A sound through a notification channel; never in-app beeps (Later). */
  sound: boolean;
}

export type AlertKind =
  | 'hrHigh'
  | 'hrLow'
  | 'powerHigh'
  | 'powerLow'
  | 'cadenceLow'
  | 'cadenceHigh'
  | 'eat'
  | 'drink'
  | 'offCourse'
  | 'backOnCourse'
  | 'lowBattery'
  | 'sensorLost'
  | 'gpsLost'
  | 'gpsBack'
  | 'autoLap'
  | 'turn';

export interface RideAlert {
  kind: AlertKind;
  /** Epoch ms the alert fired. */
  at: number;
  /** A number to print (zone, bpm, watts, metres, percent), null when none. */
  value: number | null;
}

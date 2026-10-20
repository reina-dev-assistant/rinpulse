/**
 * Reads a FIT activity file (the format iGPSPORT, Garmin, Wahoo, Bryton, Magene and XOSS bike computers and watches
 * write) with Garmin's own SDK and turns it into what JoyoFit stores for a workout. Pure functions, no React Native
 * imports, so they run under `bun test`.
 *
 * What is read: `file_id` (must be an activity; the manufacturer names the workout), the `session` messages (totals:
 * start, elapsed and timer time, distance, calories, heart rate, speed, ascent, cadence, power; several sessions, as
 * after a pause in some head units, are added up into one workout) and the `record` messages (one per sample: time,
 * position, altitude, heart rate, speed, cadence, power, step length), which become `workout_points`, and the `lap`
 * messages (kept as `laps` when the file has two or more).
 */
import { Decoder, type FitMessages, Stream } from '@garmin/fitsdk';

import { t } from '@/i18n';

import { FIT_EPOCH_OFFSET } from '../strava/fitEncoder';
import { MAX_PER_LEG_CADENCE } from '../workouts/analysis/stride';

/** Why a file is not imported. `unreadable` (the phone could not open it), `duplicate` and `overlap` come from the callers of `parseFitActivity`. */
export type FitImportFailure = 'unreadable' | 'not-fit' | 'corrupt' | 'not-activity' | 'no-session' | 'duplicate' | 'overlap';

export interface FitImportError {
  ok: false;
  reason: FitImportFailure;
  message: string;
}

/** Huawei sport type bytes, as stored in `workouts.sport_type` (see `WorkoutSportTypes.kt`). */
export const SPORT = {
  running: 1,
  walking: 2,
  cycling: 3,
  indoorRunning: 5,
  indoorCycling: 7,
  trailRun: 11,
  indoorWalking: 13,
  hiking: 14,
  /** The watch's own "Exercise": every sport JoyoFit does not name. */
  other: 255,
} as const;

export type FitSportKind =
  | 'RUNNING'
  | 'WALKING'
  | 'CYCLING'
  | 'INDOOR_RUNNING'
  | 'INDOOR_CYCLING'
  | 'TRAIL_RUN'
  | 'INDOOR_WALKING'
  | 'HIKING'
  | 'EXERCISE';

interface SportInfo {
  type: number;
  /** Gadgetbridge `ActivityKind` name, as the watch rows carry in `summary_json.kind`. */
  kind: FitSportKind;
  /** Short name; the file's manufacturer is added in parentheses. */
  name: string;
  /** Pace (min/km) is the natural figure, not speed. */
  foot: boolean;
}

const SPORTS: Readonly<Record<number, SportInfo>> = {
  [SPORT.running]: { type: SPORT.running, kind: 'RUNNING', name: 'Run', foot: true },
  [SPORT.walking]: { type: SPORT.walking, kind: 'WALKING', name: 'Walk', foot: true },
  [SPORT.cycling]: { type: SPORT.cycling, kind: 'CYCLING', name: 'Ride', foot: false },
  [SPORT.indoorRunning]: { type: SPORT.indoorRunning, kind: 'INDOOR_RUNNING', name: 'Treadmill run', foot: true },
  [SPORT.indoorCycling]: { type: SPORT.indoorCycling, kind: 'INDOOR_CYCLING', name: 'Indoor ride', foot: false },
  [SPORT.trailRun]: { type: SPORT.trailRun, kind: 'TRAIL_RUN', name: 'Trail run', foot: true },
  [SPORT.indoorWalking]: { type: SPORT.indoorWalking, kind: 'INDOOR_WALKING', name: 'Indoor walk', foot: true },
  [SPORT.hiking]: { type: SPORT.hiking, kind: 'HIKING', name: 'Hike', foot: true },
  [SPORT.other]: { type: SPORT.other, kind: 'EXERCISE', name: 'Workout', foot: false },
};

/** FIT `sport` and `sub_sport` (names, or numbers the SDK has no name for) to the Huawei sport JoyoFit stores. */
export function sportFor(fitSport: string | number | undefined, fitSubSport: string | number | undefined): SportInfo {
  const sport = String(fitSport);
  const sub = String(fitSubSport);
  const indoorRide = sub === 'indoorCycling' || sub === 'spin' || sub === 'virtualActivity';
  const treadmill = sub === 'treadmill' || sub === 'indoorRunning' || sub === 'virtualActivity';
  const indoorWalk = sub === 'indoorWalking' || sub === 'treadmill';
  let type: number = SPORT.other;
  if (sport === 'cycling' || sport === 'eBiking') type = indoorRide ? SPORT.indoorCycling : SPORT.cycling;
  else if (sport === 'fitnessEquipment' && (sub === 'indoorCycling' || sub === 'spin')) type = SPORT.indoorCycling;
  else if (sport === 'running') type = sub === 'trail' ? SPORT.trailRun : treadmill ? SPORT.indoorRunning : SPORT.running;
  else if (sport === 'walking') type = indoorWalk ? SPORT.indoorWalking : SPORT.walking;
  else if (sport === 'hiking') type = SPORT.hiking;
  return SPORTS[type] as SportInfo;
}

/** FIT `manufacturer` names (SDK profile) to the brand as written on the box. Others are left out of the workout name. */
const BRANDS: Readonly<Record<string, string>> = {
  igpsport: 'iGPSPORT',
  garmin: 'Garmin',
  wahooFitness: 'Wahoo',
  magene: 'Magene',
  bryton: 'Bryton',
  brytonSensors: 'Bryton',
  coros: 'COROS',
  corosByte: 'COROS',
  suunto: 'Suunto',
  polarElectro: 'Polar',
  hammerhead: 'Hammerhead',
  lezyne: 'Lezyne',
  sigmasport: 'Sigma',
  stagesCycling: 'Stages',
  cycplus: 'CYCPLUS',
  onelap: 'OneLap',
  giantManufacturingCo: 'Giant',
  zwift: 'Zwift',
  zwiftByte: 'Zwift',
};

export interface FitPoint {
  /** Unix seconds. */
  ts: number;
  /** Degrees; null without a GPS fix. */
  lat: number | null;
  lon: number | null;
  alt: number | null;
  hr: number | null;
  /** Metres per second (`enhanced_speed`, else `speed`); 0 while stopped. */
  speed: number | null;
  /**
   * Steps per minute for a foot sport, rpm for a bike. FIT counts running and walking cadence per leg (strides per
   * minute), so a foot sport's `cadence` + `fractional_cadence` is doubled to steps per minute; a bike's is stored as is.
   */
  cadence: number | null;
  /** Metres per step (`step_length` is millimetres). */
  stride: number | null;
  /** Watts; 0 while coasting. */
  power: number | null;
}

/** One `lap` message. Times are unix seconds, cadence is steps per minute (foot) or rpm (bike) as in `FitPoint.cadence`. */
export interface FitLap {
  startTs: number;
  endTs: number;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
}

export interface FitActivity {
  /** Unix seconds. */
  start: number;
  end: number;
  sport: SportInfo;
  /** Brand from `file_id.manufacturer`, when known. */
  manufacturer: string | null;
  /** `Ride (iGPSPORT)`. */
  name: string;
  /** Active seconds. */
  timerSeconds: number;
  /** Metres. */
  distance: number;
  /** kcal. */
  calories: number;
  avgHr: number | null;
  maxHr: number | null;
  minHr: number | null;
  /** Metres per second. */
  avgSpeed: number | null;
  maxSpeed: number | null;
  /** Metres. */
  ascent: number | null;
  descent: number | null;
  minAltitude: number | null;
  maxAltitude: number | null;
  /** Steps of a foot sport (two per stride) when the file counts strides, else 0. */
  steps: number;
  /** rpm of a bike, strides per minute of a foot sport. */
  avgCadence: number | null;
  maxCadence: number | null;
  /** True when the file's cadence figures count one foot (FIT's rule, strides per minute); false when the file was found to count steps. */
  cadencePerLeg: boolean;
  /** Metres per step: the session's `avg_step_length` (millimetres in the file). */
  avgStepLength: number | null;
  /** Watts. */
  avgPower: number | null;
  maxPower: number | null;
  normalizedPower: number | null;
  /** Mean percent of the left pedal when the file has a power meter's pedal balance (the right pedal is the rest). */
  balanceLeftPct: number | null;
  /** The file's laps in time order; empty unless it has at least two. */
  laps: FitLap[];
  points: FitPoint[];
}

type Session = NonNullable<FitMessages['sessionMesgs']>[number];
type RecordMesg = NonNullable<FitMessages['recordMesgs']>[number];
type LapMesg = NonNullable<FitMessages['lapMesgs']>[number];

/** Decoded without `convertDateTimesToDates`, so a timestamp is a number of seconds although the SDK types it as a Date. */
const seconds = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const positive = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
};
const nonNegative = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && n >= 0 ? n : null;
};

/** FIT timestamps below this are time since the device powered on, not UTC (the profile's `date_time` rule). */
const MIN_UTC_FIT_TIME = 0x10000000;

const failure = (reason: FitImportFailure, message: string): FitImportError => ({ ok: false, reason, message });

const semicirclesToDegrees = (value: number): number => (value * 180) / 2 ** 31;

function point(record: RecordMesg, legs: 1 | 2): FitPoint | null {
  const t = seconds(record.timestamp);
  if (t === null || t < MIN_UTC_FIT_TIME) return null;
  const rawLat = num(record.positionLat);
  const rawLon = num(record.positionLong);
  let lat: number | null = null;
  let lon: number | null = null;
  if (rawLat !== null && rawLon !== null) {
    const la = semicirclesToDegrees(rawLat);
    const lo = semicirclesToDegrees(rawLon);
    // Some head units write 0,0 before the first fix.
    if (Math.abs(la) <= 90 && Math.abs(lo) <= 180 && !(la === 0 && lo === 0)) {
      lat = la;
      lon = lo;
    }
  }
  const hr = num(record.heartRate);
  const speed = nonNegative(record.enhancedSpeed) ?? nonNegative(record.speed);
  const power = nonNegative(record.power);
  const stepLength = positive(record.stepLength);
  return {
    ts: t + FIT_EPOCH_OFFSET,
    lat,
    lon,
    alt: num(record.enhancedAltitude) ?? num(record.altitude),
    hr: hr !== null && hr > 0 && hr < 255 ? Math.round(hr) : null,
    speed,
    cadence: cadenceOf(record.cadence, record.fractionalCadence, legs),
    stride: stepLength === null ? null : stepLength / 1000,
    power: power === null ? null : Math.round(power),
  };
}

/**
 * `cadence` (+ `fractional_cadence`) in the unit the point stores; null when the file has no reading. `legs` is 2 when the file
 * counts one foot (FIT's rule: strides per minute, doubled here to steps per minute), 1 for a bike and for a writer that counts
 * steps. Per-leg values above `MAX_PER_LEG_CADENCE` are not doubled: no runner makes that many strides a minute.
 */
function cadenceOf(cadence: unknown, fractional: unknown, legs: 1 | 2): number | null {
  const whole = nonNegative(cadence);
  if (whole === null) return null;
  const perLeg = whole + (nonNegative(fractional) ?? 0);
  return Math.round(perLeg * (legs === 2 && perLeg <= MAX_PER_LEG_CADENCE ? 2 : 1));
}

/** Records that must agree before a foot file is read as counting steps instead of strides. */
const MIN_UNIT_EVIDENCE = 20;

/**
 * Which unit a foot file's `cadence` is in, from the file itself: FIT says strides per minute (one foot, factor 2), but some
 * writers count steps per minute. A record that has speed, step length and cadence says which: the steps per minute the speed and
 * the step length imply are twice the cadence when it is per leg and equal to it when it is already steps. Only a clear majority of
 * at least `MIN_UNIT_EVIDENCE` records for steps changes the standard reading (2); a file without step lengths keeps it.
 */
function legFactor(records: readonly RecordMesg[]): 1 | 2 {
  let perLeg = 0;
  let perMinute = 0;
  for (const r of records) {
    const cadence = positive(r.cadence);
    const speed = nonNegative(r.enhancedSpeed) ?? nonNegative(r.speed);
    const stepMm = positive(r.stepLength);
    if (cadence === null || speed === null || stepMm === null || speed < 0.8) continue;
    const implied = (speed / (stepMm / 1000)) * 60;
    const ratio = implied / (cadence + (nonNegative(r.fractionalCadence) ?? 0));
    if (ratio > 1.6 && ratio < 2.5) perLeg += 1;
    else if (ratio > 0.7 && ratio < 1.35) perMinute += 1;
  }
  return perMinute >= MIN_UNIT_EVIDENCE && perMinute > 2 * perLeg ? 1 : 2;
}

/** A session's average or maximum cadence as the file counts it (per leg on foot), whole and fractional part together; null without a reading above zero. */
function sessionCadence(s: Session, which: 'avg' | 'max'): number | null {
  const whole = positive(which === 'avg' ? s.avgCadence : s.maxCadence);
  if (whole === null) return null;
  return whole + (nonNegative(which === 'avg' ? s.avgFractionalCadence : s.maxFractionalCadence) ?? 0);
}

/**
 * Left pedal share in percent from a record's `left_right_balance` (low 7 bits the percent, 0x80 set when that percent is the right
 * pedal's) or a session's `left_right_balance_100` (low 14 bits hundredths of a percent, 0x8000 the right flag). Null when absent or
 * not a share between 0 and 100.
 */
function leftShare(raw: unknown, wide: boolean): number | null {
  const v = nonNegative(raw);
  if (v === null) return null;
  const rightFlag = wide ? 0x8000 : 0x80;
  const share = wide ? (v & 0x3fff) / 100 : v & 0x7f;
  if (share <= 0 || share >= 100) return null;
  return v & rightFlag ? 100 - share : share;
}

/** Mean left pedal share over the records, else the session's own. */
function balanceLeft(records: readonly RecordMesg[], sessions: readonly Session[]): number | null {
  let sum = 0;
  let count = 0;
  for (const r of records) {
    const share = leftShare(r.leftRightBalance, false);
    if (share === null) continue;
    sum += share;
    count += 1;
  }
  if (count > 0) return sum / count;
  return weighted(sessions, (s) => leftShare(s.leftRightBalance, true));
}

/** One lap of a file; null without a start or a length. */
function lap(mesg: LapMesg, legs: 1 | 2): FitLap | null {
  const start = seconds(mesg.startTime);
  const elapsed = positive(mesg.totalElapsedTime) ?? positive(mesg.totalTimerTime);
  if (start === null || start < MIN_UTC_FIT_TIME || elapsed === null) return null;
  const avgHr = positive(mesg.avgHeartRate);
  const maxHr = positive(mesg.maxHeartRate);
  const cadence = cadenceOf(mesg.avgCadence, mesg.avgFractionalCadence, legs);
  return {
    startTs: start + FIT_EPOCH_OFFSET,
    endTs: Math.round(start + elapsed) + FIT_EPOCH_OFFSET,
    distanceM: positive(mesg.totalDistance),
    avgHr: avgHr === null ? null : Math.round(avgHr),
    maxHr: maxHr === null ? null : Math.round(maxHr),
    avgCadence: cadence !== null && cadence > 0 ? cadence : null,
  };
}

/** Mean of `value` over the sessions that have it, weighted by active time. */
function weighted(sessions: readonly Session[], value: (s: Session) => number | null): number | null {
  let sum = 0;
  let weight = 0;
  for (const s of sessions) {
    const v = value(s);
    if (v === null) continue;
    const w = positive(s.totalTimerTime) ?? 1;
    sum += v * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : null;
}

const sumOf = (sessions: readonly Session[], value: (s: Session) => number | null): number | null => {
  let total: number | null = null;
  for (const s of sessions) {
    const v = value(s);
    if (v !== null) total = (total ?? 0) + v;
  }
  return total;
};

const maxOf = (sessions: readonly Session[], value: (s: Session) => number | null): number | null => {
  let best: number | null = null;
  for (const s of sessions) {
    const v = value(s);
    if (v !== null && (best === null || v > best)) best = v;
  }
  return best;
};

/** Smallest and largest present value; a loop, as a long ride has too many samples to spread into `Math.min`. */
function extent(values: readonly (number | null)[]): { min: number | null; max: number | null } {
  let min: number | null = null;
  let max: number | null = null;
  for (const v of values) {
    if (v === null) continue;
    if (min === null || v < min) min = v;
    if (max === null || v > max) max = v;
  }
  return { min, max };
}

const rounded = (value: number | null): number | null => (value === null ? null : Math.round(value));
const round2 = (value: number | null): number | null => (value === null ? null : Math.round(value * 100) / 100);

function balanceLeftRounded(records: readonly RecordMesg[], sessions: readonly Session[]): number | null {
  const share = balanceLeft(records, sessions);
  return share === null ? null : Math.round(share * 10) / 10;
}

/**
 * Parses a FIT activity. Errors are values, not exceptions: the screen shows `message` as it is. An activity needs a
 * `session` message and a start time; heart rate, position, altitude, power and cadence are optional.
 */
export function parseFitActivity(bytes: Uint8Array): FitActivity | FitImportError {
  let messages: FitMessages;
  try {
    // A copy, so the SDK reads exactly these bytes whatever buffer the caller's view sits in.
    const decoder = new Decoder(Stream.fromArrayBuffer(bytes.slice().buffer));
    if (!decoder.isFIT()) return failure('not-fit', t('sharing:fitImport.errors.notFit'));
    if (!decoder.checkIntegrity()) return failure('corrupt', t('sharing:fitImport.errors.checksum'));
    messages = decoder.read({ convertDateTimesToDates: false }).messages;
  } catch {
    return failure('corrupt', t('sharing:fitImport.errors.unreadable'));
  }

  const fileType = messages.fileIdMesgs?.[0]?.type;
  if (fileType !== undefined && String(fileType) !== 'activity') {
    return failure('not-activity', t('sharing:fitImport.errors.notActivity', { type: String(fileType) }));
  }

  const sessions = (messages.sessionMesgs ?? [])
    .filter((s) => seconds(s.startTime) !== null)
    .sort((a, b) => (seconds(a.startTime) ?? 0) - (seconds(b.startTime) ?? 0));
  if (sessions.length === 0) return failure('no-session', t('sharing:fitImport.errors.noSession'));

  const startFit = Math.min(...sessions.map((s) => seconds(s.startTime) as number));
  if (startFit < MIN_UTC_FIT_TIME) return failure('no-session', t('sharing:fitImport.errors.noStart'));
  const start = startFit + FIT_EPOCH_OFFSET;

  const longest = sessions.reduce((a, b) => ((positive(b.totalTimerTime) ?? 0) > (positive(a.totalTimerTime) ?? 0) ? b : a));
  const sport = sportFor(longest.sport, longest.subSport);
  const legs = sport.foot ? legFactor(messages.recordMesgs ?? []) : 1;
  const points = (messages.recordMesgs ?? [])
    .map((r) => point(r, legs))
    .filter((p): p is FitPoint => p !== null)
    .sort((a, b) => a.ts - b.ts);
  const laps = (messages.lapMesgs ?? [])
    .map((l) => lap(l, legs))
    .filter((l): l is FitLap => l !== null)
    .sort((a, b) => a.startTs - b.startTs);

  const elapsedOf = (s: Session): number | null => positive(s.totalElapsedTime) ?? positive(s.totalTimerTime);
  let end = Math.max(...sessions.map((s) => (seconds(s.startTime) as number) + (elapsedOf(s) ?? 0))) + FIT_EPOCH_OFFSET;
  const lastPoint = points[points.length - 1];
  if (end <= start && lastPoint) end = lastPoint.ts;
  if (end <= start) return failure('no-session', t('sharing:fitImport.errors.noDuration'));

  const timer = Math.round(sumOf(sessions, (s) => positive(s.totalTimerTime)) ?? end - start);
  const lastRecord = messages.recordMesgs?.[messages.recordMesgs.length - 1];
  const distance = sumOf(sessions, (s) => positive(s.totalDistance)) ?? positive(lastRecord?.distance) ?? 0;
  const avgSpeed =
    weighted(sessions, (s) => positive(s.enhancedAvgSpeed) ?? positive(s.avgSpeed)) ?? (distance > 0 && timer > 0 ? distance / timer : null);
  const altitude = extent(points.map((p) => p.alt));
  const heartRate = extent(points.map((p) => p.hr));
  const strides = sumOf(sessions, (s) => positive(s.totalStrides));
  const manufacturerRaw = messages.fileIdMesgs?.[0]?.manufacturer;
  const manufacturer = manufacturerRaw === undefined ? null : (BRANDS[String(manufacturerRaw)] ?? null);

  return {
    start,
    end,
    sport,
    manufacturer,
    name: manufacturer ? `${sport.name} (${manufacturer})` : sport.name,
    timerSeconds: timer,
    distance,
    calories: Math.round(sumOf(sessions, (s) => positive(s.totalCalories)) ?? 0),
    avgHr: rounded(weighted(sessions, (s) => positive(s.avgHeartRate))),
    maxHr: maxOf(sessions, (s) => positive(s.maxHeartRate)) ?? heartRate.max,
    minHr: heartRate.min,
    avgSpeed,
    maxSpeed: maxOf(sessions, (s) => positive(s.enhancedMaxSpeed) ?? positive(s.maxSpeed)),
    ascent: rounded(sumOf(sessions, (s) => num(s.totalAscent))),
    descent: rounded(sumOf(sessions, (s) => num(s.totalDescent))),
    minAltitude: altitude.min,
    maxAltitude: altitude.max,
    steps: sport.foot && strides !== null ? Math.round(strides * 2) : 0,
    cadencePerLeg: sport.foot && legs === 2,
    avgCadence: round2(weighted(sessions, (s) => sessionCadence(s, 'avg'))),
    maxCadence: round2(maxOf(sessions, (s) => sessionCadence(s, 'max'))),
    avgStepLength: weighted(sessions, (s) => {
      const mm = positive(s.avgStepLength);
      return mm === null ? null : mm / 1000;
    }),
    avgPower: rounded(weighted(sessions, (s) => positive(s.avgPower))),
    maxPower: maxOf(sessions, (s) => positive(s.maxPower)),
    normalizedPower: rounded(weighted(sessions, (s) => positive(s.normalizedPower))),
    balanceLeftPct: balanceLeftRounded(messages.recordMesgs ?? [], sessions),
    laps: laps.length >= 2 ? laps : [],
    points,
  };
}

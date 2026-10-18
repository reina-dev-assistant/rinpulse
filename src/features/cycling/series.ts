import { AIR_DENSITY, BIKE_KG, CDA, CRR, DRIVETRAIN_EFFICIENCY, GRAVITY } from '@/features/ride/physics';
import { cleanFixes, type CleanFix } from '@/features/workouts/analysis/geo';
import { movingOf } from '@/features/workouts/times';

import type { SpeedSource } from './types';

/**
 * The ride on a one second grid. The generic analysis grid is at most 600 steps wide (a 3 hour ride is 18 s per step), far too coarse
 * for normalized power (30 s rolling mean), best efforts (5 s) or stop detection, so every cycling figure is computed from these
 * arrays instead. Index `i` is `i` seconds after the start. Missing readings are NaN.
 */
export interface RideSeries {
  /** Unix seconds. */
  start: number;
  /** Samples: elapsed seconds + 1. */
  n: number;
  elapsedSec: number;
  /** The recorder's timer in seconds (`movingOf`). */
  timerSec: number;
  /** 1 where the recorder was running (a sample within `MAX_GAP_SEC` of this second), 0 in a pause or a gap. */
  covered: Uint8Array;
  /** Metres per second, 3 s mean. NaN without a reading. */
  speed: Float64Array;
  /** Cumulative metres, flat while not covered. */
  dist: Float64Array;
  /** Metres above sea level, gaps filled, not smoothed. */
  alt: Float64Array;
  hr: Float64Array;
  /** Revolutions per minute. */
  cad: Float64Array;
  /** Watts. */
  power: Float64Array;
  /** 1 where the bike moved: covered and above the auto-pause threshold. */
  moving: Uint8Array;
  speedSource: SpeedSource;
  hasPower: boolean;
  hasGps: boolean;
}

/** A row of `workout_points` (or a FIT record): every channel is optional. */
export interface RidePointInput {
  ts: number;
  lat?: number | null;
  lon?: number | null;
  alt?: number | null;
  hr?: number | null;
  /** Metres per second. */
  speed?: number | null;
  /** Revolutions per minute. */
  cadence?: number | null;
  power?: number | null;
}

export interface RideSeriesInput {
  /** Unix seconds. */
  start: number;
  end: number;
  /** The recorder's active seconds. */
  duration: number;
  /** The recorder's distance in metres (0 when none). */
  distance: number;
  points: readonly RidePointInput[];
  /** Body weight, kg, for the speed estimate from power. */
  weightKg: number;
}

/**
 * Cycling auto-pause threshold, m/s. Below it the bike counts as stopped. Running uses 0.5 m/s (a walking floor); on a bike
 * walking pace is already a stop, and a 3.6 km/h floor sits above GPS speed noise at a standstill (about 0.3 to 0.8 m/s with
 * the receiver jittering) and below the speed of a rider climbing a very steep ramp. Edge, ELEMNT and iGPSPORT do not publish
 * theirs and Strava says only that "a speed threshold" is applied to rides, so this is JoyoFit's choice, checked against the
 * timer time of the Garmin Edge 500 and Wahoo ELEMNT files in the tests.
 */
export const STOP_SPEED_MS = 1.0;
/** Fastest believable speed of a bicycle on the level or down a hill, m/s (about 108 km/h). */
const MAX_SPEED_MS = 30;
/** Samples further apart than this are a pause or a dropout: the seconds between them are not covered. */
export const MAX_GAP_SEC = 10;
const MAX_POWER_W = 4000;
const MAX_CADENCE_RPM = 250;
const MIN_BPM = 20;
const MAX_BPM = 250;
const MIN_ALT_M = -500;
const MAX_ALT_M = 9000;
/** Share of the covered seconds that must carry a reported speed before it is preferred over the GPS path. */
const SENSOR_SPEED_SHARE = 0.5;
const MIN_GPS_PATH_M = 50;
const SPEED_SMOOTH_SEC = 3;

// The power-to-speed model of an indoor ride without a wheel sensor (flat road, still air): P x efficiency = 1/2 rho CdA v^3 + Crr m g v.
// Its constants are the ones of the web game's physics (features/ride/physics.ts), so the two never drift apart.

/** Metres per second a rider puts down at `watts` on the flat (the model above); 0 for no power. */
export function virtualSpeedMs(watts: number, riderKg: number): number {
  if (!(watts > 0)) return 0;
  const wheel = watts * DRIVETRAIN_EFFICIENCY;
  const rolling = CRR * (riderKg + BIKE_KG) * GRAVITY;
  let lo = 0;
  let hi = 40;
  for (let k = 0; k < 40; k++) {
    const v = (lo + hi) / 2;
    if (0.5 * AIR_DENSITY * CDA * v ** 3 + rolling * v < wheel) lo = v;
    else hi = v;
  }
  return (lo + hi) / 2;
}

interface Buckets {
  sum: Float64Array;
  count: Uint16Array;
}

function buckets(n: number): Buckets {
  return { sum: new Float64Array(n), count: new Uint16Array(n) };
}

function add(b: Buckets, i: number, v: number): void {
  b.sum[i] += v;
  b.count[i] += 1;
}

function means(b: Buckets): Float64Array {
  const out = new Float64Array(b.sum.length);
  for (let i = 0; i < out.length; i++) out[i] = b.count[i] > 0 ? b.sum[i] / b.count[i] : NaN;
  return out;
}

/** Linear fill of the NaN stretches between two readings at most `maxGap` seconds apart (the readings themselves are kept). */
function interpolate(values: Float64Array, maxGap: number): Float64Array {
  const out = Float64Array.from(values);
  let prev = -1;
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i])) continue;
    if (prev >= 0 && i - prev > 1 && i - prev <= maxGap) {
      const a = values[prev];
      const b = values[i];
      for (let j = prev + 1; j < i; j++) out[j] = a + ((b - a) * (j - prev)) / (i - prev);
    }
    prev = i;
  }
  return out;
}

/** A reading carried forward over a gap of up to `maxGap` seconds (cadence and power are steps, not curves). */
function hold(values: Float64Array, maxGap: number): Float64Array {
  const out = Float64Array.from(values);
  let prev = -1;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isNaN(values[i])) {
      prev = i;
      continue;
    }
    if (prev >= 0 && i - prev <= maxGap) out[i] = values[prev];
  }
  return out;
}

/** Centred moving mean over `window` samples, skipping NaN; NaN where the window holds none. */
function movingMean(values: Float64Array, window: number): Float64Array {
  const h = window >> 1;
  const out = new Float64Array(values.length);
  const prefix = new Float64Array(values.length + 1);
  const counts = new Uint32Array(values.length + 1);
  for (let i = 0; i < values.length; i++) {
    const ok = !Number.isNaN(values[i]);
    prefix[i + 1] = prefix[i] + (ok ? values[i] : 0);
    counts[i + 1] = counts[i] + (ok ? 1 : 0);
  }
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - h);
    const hi = Math.min(values.length, i + h + 1);
    const c = counts[hi] - counts[lo];
    out[i] = c > 0 ? (prefix[hi] - prefix[lo]) / c : NaN;
  }
  return out;
}

/** Ground speed per second between consecutive fixes (NaN across a gap), from the cleaned GPS path. */
function gpsSpeed(fixes: readonly CleanFix[], start: number, n: number): Float64Array {
  const out = new Float64Array(n).fill(NaN);
  for (let k = 1; k < fixes.length; k++) {
    const a = fixes[k - 1];
    const b = fixes[k];
    const dt = b.ts - a.ts;
    if (dt <= 0 || dt > MAX_GAP_SEC) continue;
    const v = (b.dist - a.dist) / dt;
    for (let t = Math.ceil(a.ts - start); t <= Math.floor(b.ts - start); t++) if (t >= 0 && t < n) out[t] = v;
  }
  return out;
}

/** Elapsed seconds: `end - start`, or what the points and the timer say when `end` is unusable. */
function elapsedOf(input: RideSeriesInput): number {
  if (input.end > input.start) return input.end - input.start;
  const last = input.points.reduce((m, p) => Math.max(m, p.ts), input.start);
  return Math.max(input.duration, last - input.start, 0);
}

/**
 * The ride as 1 Hz arrays. Heart rate, altitude and speed are interpolated over gaps up to `MAX_GAP_SEC`; cadence and power are
 * held for up to 3 s. Speed is the sensor's (`workout_points.speed`, the wheel or the bike computer's own) when most of the ride
 * has it, else the cleaned GPS path, else (an indoor ride with power) the flat-road model above; the distance is that speed
 * integrated over the covered seconds and scaled so it ends at the recorder's total (the number Strava shows), as on foot.
 */
export function buildRideSeries(input: RideSeriesInput): RideSeries {
  const elapsedSec = Math.max(1, Math.round(elapsedOf(input)));
  const n = elapsedSec + 1;
  const timerSec = movingOf(elapsedSec, Math.round(input.duration));
  const sorted = [...input.points].sort((a, b) => a.ts - b.ts);

  const hrB = buckets(n);
  const cadB = buckets(n);
  const powB = buckets(n);
  const spdB = buckets(n);
  const altB = buckets(n);
  const seen = new Uint8Array(n);
  let hasPower = false;
  let pointCount = 0;
  for (const p of sorted) {
    const i = Math.round(p.ts - input.start);
    if (i < 0 || i >= n) continue;
    seen[i] = 1;
    pointCount += 1;
    if (typeof p.hr === 'number' && p.hr >= MIN_BPM && p.hr <= MAX_BPM) add(hrB, i, p.hr);
    if (typeof p.cadence === 'number' && p.cadence >= 0 && p.cadence <= MAX_CADENCE_RPM) add(cadB, i, p.cadence);
    if (typeof p.power === 'number' && p.power >= 0 && p.power <= MAX_POWER_W) {
      add(powB, i, p.power);
      hasPower = true;
    }
    if (typeof p.speed === 'number' && p.speed >= 0 && p.speed <= MAX_SPEED_MS) add(spdB, i, p.speed);
    if (typeof p.alt === 'number' && p.alt > MIN_ALT_M && p.alt < MAX_ALT_M) add(altB, i, p.alt);
  }

  // Covered: every second between two samples at most MAX_GAP_SEC apart.
  const covered = new Uint8Array(n);
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (!seen[i]) continue;
    covered[i] = 1;
    if (prev >= 0 && i - prev <= MAX_GAP_SEC) for (let j = prev + 1; j < i; j++) covered[j] = 1;
    prev = i;
  }
  let coveredCount = 0;
  for (let i = 0; i < n; i++) coveredCount += covered[i];

  const hr = interpolate(means(hrB), MAX_GAP_SEC);
  const cad = hold(means(cadB), 3);
  const power = hold(means(powB), 3);
  const alt = interpolate(means(altB), Infinity);
  const sensorSpeed = interpolate(means(spdB), MAX_GAP_SEC);

  const fixes = cleanFixes(
    sorted.map((p) => ({ ts: p.ts, lat: p.lat ?? null, lon: p.lon ?? null })),
    'ride',
  );
  const hasGps = fixes.length >= 2 && fixes[fixes.length - 1].dist >= MIN_GPS_PATH_M;
  const gps = hasGps ? gpsSpeed(fixes, input.start, n) : new Float64Array(n).fill(NaN);

  let withSensor = 0;
  for (let i = 0; i < n; i++) if (covered[i] && !Number.isNaN(sensorSpeed[i])) withSensor += 1;
  let raw: Float64Array;
  let speedSource: SpeedSource;
  if (coveredCount > 0 && withSensor >= SENSOR_SPEED_SHARE * coveredCount) {
    raw = sensorSpeed;
    speedSource = 'sensor';
  } else if (hasGps) {
    raw = gps;
    speedSource = 'gps';
  } else if (hasPower && pointCount > 0) {
    const watts = movingMean(
      Float64Array.from(power, (w, i) => (covered[i] ? (Number.isNaN(w) ? 0 : w) : NaN)),
      5,
    );
    raw = Float64Array.from(watts, (w) => (Number.isNaN(w) ? NaN : virtualSpeedMs(w, input.weightKg)));
    speedSource = 'power';
  } else {
    raw = new Float64Array(n).fill(NaN);
    speedSource = 'none';
  }
  // Seconds the primary source lacks borrow the GPS path when there is one.
  if (speedSource === 'sensor' && hasGps) for (let i = 0; i < n; i++) if (Number.isNaN(raw[i])) raw[i] = gps[i];
  for (let i = 0; i < n; i++) if (!covered[i]) raw[i] = NaN;
  const speed = movingMean(raw, SPEED_SMOOTH_SEC);
  for (let i = 0; i < n; i++) if (!covered[i]) speed[i] = NaN;

  // Distance: speed integrated over the covered seconds, scaled to the recorder's total.
  const dist = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const v = covered[i] && !Number.isNaN(speed[i]) ? speed[i] : 0;
    dist[i] = dist[i - 1] + v;
  }
  const integrated = dist[n - 1];
  if (input.distance > 0 && integrated > 0) {
    const scale = input.distance / integrated;
    for (let i = 0; i < n; i++) dist[i] *= scale;
  }

  const moving = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!covered[i]) continue;
    if (!Number.isNaN(speed[i])) moving[i] = speed[i] >= STOP_SPEED_MS ? 1 : 0;
    else if (speedSource === 'none') {
      // No speed at all (a trainer without a wheel sensor or power): pedalling or watts mean moving, else the timer's word.
      const c = cad[i];
      const w = power[i];
      moving[i] = (!Number.isNaN(c) && c > 0) || (!Number.isNaN(w) && w > 0) || (Number.isNaN(c) && Number.isNaN(w)) ? 1 : 0;
    }
  }

  return { start: input.start, n, elapsedSec, timerSec, covered, speed, dist, alt, hr, cad, power, moving, speedSource, hasPower, hasGps };
}

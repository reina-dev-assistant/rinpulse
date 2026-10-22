/**
 * The lactate threshold time trial (Friel's field test): after a warm-up, run 30 minutes as hard as can be held evenly, alone. The average
 * heart rate of the last 20 minutes is the lactate threshold heart rate (LTHR), the average pace of the same 20 minutes the threshold pace.
 * The first 10 minutes are left out: the heart rate is still catching up with the effort. Nothing here comes from a personal best.
 *
 * Pure: points in, verdict out. The screen (`ui/LactateTestScreen.tsx`) finds the run and the 30-minute stretch.
 */
import type { WorkoutPointRow } from '@/db/queries';

export type TrialPoint = Pick<WorkoutPointRow, 'ts' | 'hr' | 'speed' | 'lat' | 'lon'>;

/** The effort: 30 minutes. */
export const EFFORT_SEC = 30 * 60;
/** The first part of the effort that is not measured (the heart rate settles). */
export const SETTLE_SEC = 10 * 60;
/** What is measured: the last 20 minutes. */
export const MEASURE_SEC = EFFORT_SEC - SETTLE_SEC;
/** The easy run before the effort. */
export const WARMUP_SEC = 15 * 60;
/** The easy run after it. */
export const COOLDOWN_SEC = 10 * 60;

/** A reading counts until the next one, at most this long: a longer gap is a pause or a lost sensor. */
const MAX_GAP_SEC = 15;
/** Share of the measured 20 minutes the heart rate (and the speed) must cover. */
const MIN_COVERAGE = 0.9;
/** Mean heart rate of the second half of the measured part over the first half: more than this up or down, the effort was not even. */
const MAX_DRIFT = 0.05;
/** Variation (standard deviation over mean) of the per-minute speed above which the pace was not even. */
const MAX_SPEED_VARIATION = 0.12;
/** A threshold under this share of the maximum heart rate looks like an easy run. */
const MIN_SHARE_OF_MAX = 0.78;
const HR_MIN = 40;
const HR_MAX = 230;
/** Auto-detection looks for the start of the effort every this many seconds. */
const SCAN_STEP_SEC = 30;

export type TrialProblem =
  /** Blocking: the workout ends before the 30 minutes do. */
  | 'tooShort'
  /** Blocking: heart rate is missing for more than a tenth of the measured 20 minutes. */
  | 'hrGaps'
  /** The heart rate rose or fell by more than 5 % from the first to the second half. */
  | 'drift'
  /** The speed varied a lot from minute to minute. */
  | 'paceVaries'
  /** The average is under 78 % of the maximum heart rate: probably not a hard enough effort. */
  | 'tooEasy'
  /** The average is above the maximum heart rate set in the app: the maximum is probably too low. */
  | 'aboveMax';

export const BLOCKING: readonly TrialProblem[] = ['tooShort', 'hrGaps'];

export interface TrialResult {
  /** Unix seconds the 30-minute effort started. */
  start: number;
  /** Lactate threshold heart rate, whole bpm: the time-weighted mean of the last 20 minutes. Null when the data cannot give one. */
  lthr: number | null;
  /** Seconds per km over the same 20 minutes; null without enough speed (a treadmill, no GPS). */
  paceSecKm: number | null;
  /** Mean heart rate of the first and the second 10 of the measured 20 minutes; null when a half has too little data. */
  halves: [number, number] | null;
  /** Share of the measured 20 minutes the heart rate covers, 0..1. */
  coverage: number;
  problems: TrialProblem[];
  /** True when nothing blocks: there is a heart rate to save. Warnings (drift, pace, easy) do not block. */
  usable: boolean;
}

interface Seg {
  t0: number;
  dt: number;
  hr: number | null;
  /** Metres per second, null when unknown. */
  v: number | null;
}

const validHr = (hr: number | null): number | null => (hr !== null && Number.isFinite(hr) && hr >= HR_MIN && hr <= HR_MAX ? hr : null);

function haversine(a: TrialPoint, b: TrialPoint): number {
  const rad = Math.PI / 180;
  const dLat = ((b.lat as number) - (a.lat as number)) * rad;
  const dLon = ((b.lon as number) - (a.lon as number)) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat as number) * rad) * Math.cos((b.lat as number) * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** One segment per reading: it lasts until the next reading (at most `MAX_GAP_SEC`); its speed is the reading's or, without one, the distance to the next fix over that time. */
function segments(points: readonly TrialPoint[]): Seg[] {
  const sorted = [...points].filter((p) => Number.isFinite(p.ts)).sort((a, b) => a.ts - b.ts);
  const out: Seg[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const p = sorted[i] as TrialPoint;
    const next = sorted[i + 1] as TrialPoint;
    const gap = next.ts - p.ts;
    if (gap <= 0) continue;
    const dt = Math.min(gap, MAX_GAP_SEC);
    let v: number | null = p.speed !== null && Number.isFinite(p.speed) && p.speed >= 0 && p.speed < 12 ? p.speed : null;
    if (v === null && p.lat !== null && p.lon !== null && next.lat !== null && next.lon !== null && gap <= MAX_GAP_SEC) {
      const m = haversine(p, next);
      v = m / gap < 12 ? m / gap : null;
    }
    out.push({ t0: p.ts, dt, hr: validHr(p.hr), v });
  }
  return out;
}

interface Sums {
  /** Seconds with a heart rate, and heart rate x seconds. */
  hrSec: number;
  hrSum: number;
  /** Seconds with a speed, and metres. */
  vSec: number;
  metres: number;
}

/** Sums the segments clipped to `[from, to)`. */
function sumRange(segs: readonly Seg[], from: number, to: number): Sums {
  const s: Sums = { hrSec: 0, hrSum: 0, vSec: 0, metres: 0 };
  let lo = 0;
  let hi = segs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((segs[mid] as Seg).t0 + (segs[mid] as Seg).dt <= from) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < segs.length; i++) {
    const seg = segs[i] as Seg;
    if (seg.t0 >= to) break;
    const dt = Math.min(seg.t0 + seg.dt, to) - Math.max(seg.t0, from);
    if (dt <= 0) continue;
    if (seg.hr !== null) {
      s.hrSec += dt;
      s.hrSum += seg.hr * dt;
    }
    if (seg.v !== null) {
      s.vSec += dt;
      s.metres += seg.v * dt;
    }
  }
  return s;
}

/** Variation of the per-minute mean speed over the measured 20 minutes; null with fewer than 15 minutes of speed. */
function speedVariation(segs: readonly Seg[], from: number): number | null {
  const minutes: number[] = [];
  for (let m = 0; m < MEASURE_SEC / 60; m++) {
    const s = sumRange(segs, from + m * 60, from + (m + 1) * 60);
    if (s.vSec >= 45) minutes.push(s.metres / s.vSec);
  }
  if (minutes.length < 15) return null;
  const mean = minutes.reduce((a, b) => a + b, 0) / minutes.length;
  if (mean <= 0) return null;
  const variance = minutes.reduce((a, b) => a + (b - mean) ** 2, 0) / minutes.length;
  return Math.sqrt(variance) / mean;
}

/**
 * The verdict for a 30-minute effort that began at `start` (unix seconds, the same clock as the points). `maxHr` is the maximum heart
 * rate in the app, to judge whether the effort was hard.
 */
export function analyseTrial(points: readonly TrialPoint[], start: number, maxHr: number): TrialResult {
  const segs = segments(points);
  const measureFrom = start + SETTLE_SEC;
  const end = start + EFFORT_SEC;
  const result: TrialResult = { start, lthr: null, paceSecKm: null, halves: null, coverage: 0, problems: [], usable: false };
  const last = segs[segs.length - 1];
  const first = segs[0];
  if (!first || !last || first.t0 > measureFrom + MAX_GAP_SEC || last.t0 + last.dt < end - MAX_GAP_SEC) {
    result.problems.push('tooShort');
    return result;
  }
  const whole = sumRange(segs, measureFrom, end);
  result.coverage = Math.min(1, whole.hrSec / MEASURE_SEC);
  if (result.coverage < MIN_COVERAGE) {
    result.problems.push('hrGaps');
    return result;
  }
  const lthr = whole.hrSum / whole.hrSec;
  result.lthr = Math.round(lthr);
  result.usable = true;

  const mid = measureFrom + MEASURE_SEC / 2;
  const a = sumRange(segs, measureFrom, mid);
  const b = sumRange(segs, mid, end);
  const half = MEASURE_SEC / 2;
  if (a.hrSec >= half * 0.8 && b.hrSec >= half * 0.8) {
    const h1 = a.hrSum / a.hrSec;
    const h2 = b.hrSum / b.hrSec;
    result.halves = [Math.round(h1), Math.round(h2)];
    if (Math.abs(h2 - h1) / h1 > MAX_DRIFT) result.problems.push('drift');
  }

  if (whole.vSec >= MEASURE_SEC * MIN_COVERAGE && whole.metres > 0) {
    result.paceSecKm = Math.round((whole.vSec / whole.metres) * 1000);
    const variation = speedVariation(segs, measureFrom);
    if (variation !== null && variation > MAX_SPEED_VARIATION) result.problems.push('paceVaries');
  }

  if (lthr < maxHr * MIN_SHARE_OF_MAX) result.problems.push('tooEasy');
  if (lthr > maxHr) result.problems.push('aboveMax');
  return result;
}

/**
 * Where the 30-minute effort most likely began: of every start (every 30 s) from which the workout still holds 30 minutes, the one whose last
 * 20 minutes have the highest mean heart rate (the latest, when several are equal), with at least 90 % heart-rate coverage. Null when no start qualifies. The run is the warm-up,
 * the effort and the cool-down, so the hardest 30 minutes are the effort; the person can still move the start.
 */
export function findEffortStart(points: readonly TrialPoint[]): number | null {
  const segs = segments(points);
  const first = segs[0];
  const last = segs[segs.length - 1];
  if (!first || !last) return null;
  const latest = last.t0 + last.dt - EFFORT_SEC;
  let best: { start: number; mean: number } | null = null;
  for (let start = first.t0; start <= latest; start += SCAN_STEP_SEC) {
    const s = sumRange(segs, start + SETTLE_SEC, start + EFFORT_SEC);
    if (s.hrSec < MEASURE_SEC * MIN_COVERAGE) continue;
    const mean = s.hrSum / s.hrSec;
    // The latest of equal means: starts up to 10 minutes early see the same measured stretch, only the real start also has its settling time.
    if (!best || mean >= best.mean - 0.01) best = { start, mean };
  }
  return best ? best.start : null;
}

/** Plain-language checks the result screen can show, by problem code. */
export const WARNING_PROBLEMS: readonly TrialProblem[] = ['drift', 'paceVaries', 'tooEasy', 'aboveMax'];

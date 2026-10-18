import type { RideSeries } from './series';
import type { ClimbCategory, RideClimb } from './types';

/**
 * Climbs the way Garmin ClimbPro defines them (Edge owner's manuals, "Climb Categories"; Garmin Technology, "ClimbPro"): at least
 * 500 m long, an average grade of at least 3 % and a climb score (length in metres x average grade in percent) of at least 1,500.
 * Categories by score: over 8,000 category 4, 16,000 category 3, 32,000 category 2, 64,000 category 1, 80,000 hors catégorie.
 * ClimbPro reads a planned course; a recorded ride has no course, so the climbs are found in the altitude: the profile is
 * smoothed over distance (a 15 s mean in time, then 100 m), reduced to its turning points by a zigzag of at least 3 m, and an
 * ascent that is cut by a dip of 10 m or less (a short descent or a flat in a long climb) is one climb. JoyoFit's own detection:
 * Garmin does not publish its.
 */
export const MIN_CLIMB_LENGTH_M = 500;
export const MIN_CLIMB_GRADE_PCT = 3;
export const MIN_CLIMB_SCORE = 1500;
const GRID_M = 10;
const BREAK_SEC = 120;
const TIME_SMOOTH_SEC = 15;
const DISTANCE_SMOOTH_POINTS = 9;
const ZIGZAG_M = 3;
const MERGE_DIP_M = 10;
const TRIM_M = 1.5;
/** The grade window for a climb's steepest stretch, metres. */
const MAX_GRADE_WINDOW_M = 100;
const MAX_PLAUSIBLE_GRADE_PCT = 30;

const CATEGORIES: readonly { min: number; category: ClimbCategory }[] = [
  { min: 80000, category: 'hc' },
  { min: 64000, category: '1' },
  { min: 32000, category: '2' },
  { min: 16000, category: '3' },
  { min: 8000, category: '4' },
];

export function climbCategory(score: number): ClimbCategory {
  return CATEGORIES.find((c) => score > c.min)?.category ?? 'none';
}

interface GridPoint {
  distM: number;
  altM: number;
  /** Index into the 1 Hz series. */
  sec: number;
}

/** Moving mean over `half * 2 + 1` neighbours, cut at the ends; NaN is skipped. */
function smoothed(values: readonly number[], half: number): number[] {
  return values.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      const v = values[j]!;
      if (!Number.isNaN(v)) {
        sum += v;
        count += 1;
      }
    }
    return count > 0 ? sum / count : NaN;
  });
}

/**
 * The altitude at every `GRID_M` metres of the ridden distance, smoothed, in stretches: a gap of `BREAK_SEC` or more between two
 * moving seconds (a long stop, the device paused or off) ends a stretch, so a climb or a grade never spans a break in the recording.
 */
function altitudeByDistance(series: RideSeries): GridPoint[][] {
  const { n, alt, dist, moving } = series;
  const timeSmooth = smoothed(Array.from(alt), TIME_SMOOTH_SEC >> 1);
  const chunks: GridPoint[][] = [];
  let raw: GridPoint[] = [];
  let next = 0;
  const flush = () => {
    if (raw.length === 0) return;
    const alts = smoothed(raw.map((p) => p.altM), DISTANCE_SMOOTH_POINTS >> 1);
    chunks.push(raw.map((p, i) => ({ ...p, altM: alts[i]! })));
    raw = [];
  };
  for (let i = 0; i < n; i++) {
    const a = timeSmooth[i]!;
    if (!moving[i] || Number.isNaN(a)) continue;
    const last = raw[raw.length - 1];
    if (last && i - last.sec >= BREAK_SEC) flush();
    if (dist[i]! >= next) {
      raw.push({ distM: dist[i]!, altM: a, sec: i });
      next = Math.floor(dist[i]! / GRID_M) * GRID_M + GRID_M;
    }
  }
  flush();
  return chunks;
}

/** Indices of the profile's turning points: first sample, then each valley and peak that the altitude left by at least `ZIGZAG_M`. */
function turningPoints(profile: readonly GridPoint[]): number[] {
  const out = [0];
  let direction = 0;
  let lo = 0;
  let hi = 0;
  let ext = 0;
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i]!.altM;
    if (direction === 0) {
      if (a > profile[hi]!.altM) hi = i;
      if (a < profile[lo]!.altM) lo = i;
      if (profile[hi]!.altM - profile[lo]!.altM >= ZIGZAG_M) {
        if (hi > lo) {
          out.push(lo);
          ext = hi;
          direction = 1;
        } else {
          out.push(hi);
          ext = lo;
          direction = -1;
        }
      }
    } else if (direction === 1) {
      if (a > profile[ext]!.altM) ext = i;
      else if (profile[ext]!.altM - a >= ZIGZAG_M) {
        out.push(ext);
        direction = -1;
        ext = i;
      }
    } else if (a < profile[ext]!.altM) ext = i;
    else if (a - profile[ext]!.altM >= ZIGZAG_M) {
      out.push(ext);
      direction = 1;
      ext = i;
    }
  }
  if (direction !== 0) out.push(ext);
  return out.filter((v, k) => k === 0 || v !== out[k - 1]);
}

interface Leg {
  from: number;
  to: number;
}

/** Ascending legs between turning points, with ascents separated by a dip of at most `MERGE_DIP_M` joined. */
function climbLegs(profile: readonly GridPoint[], turns: readonly number[]): Leg[] {
  const ups: Leg[] = [];
  for (let k = 0; k + 1 < turns.length; k++) {
    const from = turns[k]!;
    const to = turns[k + 1]!;
    if (profile[to]!.altM > profile[from]!.altM) ups.push({ from, to });
  }
  const merged: Leg[] = [];
  for (const leg of ups) {
    const last = merged[merged.length - 1];
    if (last && profile[last.to]!.altM - profile[leg.from]!.altM <= MERGE_DIP_M && profile[leg.to]!.altM > profile[last.to]!.altM) {
      last.to = leg.to;
    } else merged.push({ ...leg });
  }
  return merged;
}

/**
 * A leg starts at its valley and ends at its peak, but a flat before the climb or a plateau after it sits within a metre or two of
 * those, so the leg is trimmed to where the altitude leaves the valley (last point within `TRIM_M` of it) and first reaches the peak.
 */
function trimmed(profile: readonly GridPoint[], leg: Leg): Leg {
  const valley = profile[leg.from]!.altM;
  const peak = profile[leg.to]!.altM;
  let from = leg.from;
  while (from + 1 < leg.to && profile[from + 1]!.altM <= valley + TRIM_M) from += 1;
  let to = leg.to;
  while (to - 1 > from && profile[to - 1]!.altM >= peak - TRIM_M) to -= 1;
  return { from, to };
}

function meanOver(series: RideSeries, values: Float64Array, from: number, to: number, skipZero = false): number | null {
  let sum = 0;
  let count = 0;
  for (let i = from; i <= to; i++) {
    const v = values[i]!;
    if (!series.covered[i] || Number.isNaN(v) || (skipZero && v === 0)) continue;
    sum += v;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

/** The climbs of a ride, in ride order. Empty without altitude or distance. */
export function detectClimbs(series: RideSeries): RideClimb[] {
  const climbs: RideClimb[] = [];
  for (const profile of altitudeByDistance(series)) {
    if (profile.length < 3) continue;
    climbsOf(series, profile, climbs);
  }
  return climbs;
}

/** Appends the climbs of one stretch of the profile to `climbs`. */
function climbsOf(series: RideSeries, profile: readonly GridPoint[], climbs: RideClimb[]): void {
  for (const found of climbLegs(profile, turningPoints(profile))) {
    const leg = trimmed(profile, found);
    const a = profile[leg.from]!;
    const b = profile[leg.to]!;
    const lengthM = b.distM - a.distM;
    const gainM = b.altM - a.altM;
    if (lengthM < MIN_CLIMB_LENGTH_M || gainM <= 0) continue;
    const avgGrade = (gainM / lengthM) * 100;
    const score = lengthM * avgGrade;
    if (avgGrade < MIN_CLIMB_GRADE_PCT || score < MIN_CLIMB_SCORE) continue;

    let maxGrade = avgGrade;
    const windowPoints = Math.max(1, Math.round(MAX_GRADE_WINDOW_M / GRID_M));
    for (let i = leg.from; i + windowPoints <= leg.to; i++) {
      const w = profile[i + windowPoints]!.distM - profile[i]!.distM;
      if (w > 0) maxGrade = Math.max(maxGrade, ((profile[i + windowPoints]!.altM - profile[i]!.altM) / w) * 100);
    }

    let movingSec = 0;
    for (let i = a.sec; i <= b.sec; i++) movingSec += series.moving[i]!;
    const sec = b.sec - a.sec;
    climbs.push({
      n: climbs.length + 1,
      startM: Math.round(a.distM),
      endM: Math.round(b.distM),
      lengthM: Math.round(lengthM),
      gainM: Math.round(gainM * 10) / 10,
      avgGradePct: Math.round(avgGrade * 10) / 10,
      maxGradePct: Math.round(maxGrade * 10) / 10,
      startSec: a.sec,
      endSec: b.sec,
      sec,
      avgSpeedKmh: movingSec > 0 ? Math.round(((lengthM / movingSec) * 3.6) * 10) / 10 : null,
      avgPower: series.hasPower ? roundOrNull(meanOver(series, series.power, a.sec, b.sec)) : null,
      avgHr: roundOrNull(meanOver(series, series.hr, a.sec, b.sec)),
      vam: sec > 0 ? Math.round((gainM / sec) * 3600) : null,
      score: Math.round(score),
      category: climbCategory(score),
    });
  }
}

function roundOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

/** Steepest ascent and descent over `MAX_GRADE_WINDOW_M` of the ridden distance, percent (descent negative); null without a profile. A grade past 30 % is altitude noise. */
export function gradeExtremes(series: RideSeries): { max: number; min: number } | null {
  const step = Math.max(1, Math.round(MAX_GRADE_WINDOW_M / GRID_M));
  let max = -Infinity;
  let min = Infinity;
  for (const profile of altitudeByDistance(series)) {
    for (let i = 0; i + step < profile.length; i++) {
      const run = profile[i + step]!.distM - profile[i]!.distM;
      if (run < MAX_GRADE_WINDOW_M * 0.5) continue;
      const grade = Math.max(-MAX_PLAUSIBLE_GRADE_PCT, Math.min(MAX_PLAUSIBLE_GRADE_PCT, ((profile[i + step]!.altM - profile[i]!.altM) / run) * 100));
      max = Math.max(max, grade);
      min = Math.min(min, grade);
    }
  }
  return max === -Infinity ? null : { max, min };
}

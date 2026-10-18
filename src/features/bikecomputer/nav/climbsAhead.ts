import { climbCategory, MIN_CLIMB_GRADE_PCT, MIN_CLIMB_LENGTH_M, MIN_CLIMB_SCORE } from '@/features/cycling/climbs';
import { completeAltitudes, type RoutePoint } from '@/features/routes/routeModel';

import type { ClimbCategory, NavSnapshot, RouteClimb } from '../types';
import { buildRouteIndex } from './routeIndex';

/**
 * ClimbPro rules of `cycling/climbs.ts` applied to a route's altitude. `detectClimbs` needs a ridden `RideSeries` (time, moving
 * flags), which a stored route does not have, so the profile steps below follow the same documented rules and constants: altitude
 * on a 10 m grid by distance, smoothed over 90 m (9 grid points), zigzag of 3 m, ascents cut by a dip of at most 10 m joined, flat
 * start and plateau end trimmed to 1.5 m, then min 500 m, 3 % average and score >= 1500. Categories come from `climbCategory`.
 */
const GRID_M = 10;
const SMOOTH_HALF = 4;
const ZIGZAG_M = 3;
const MERGE_DIP_M = 10;
const TRIM_M = 1.5;
const MAX_GRADE_WINDOW_M = 100;
/** Share of points that must have an altitude for the route to have a profile. */
const MIN_ALT_SHARE = 0.9;

interface GridPoint {
  distM: number;
  altM: number;
}

interface Leg {
  from: number;
  to: number;
}

const profileCache = new WeakMap<readonly RoutePoint[], GridPoint[]>();

/** Smoothed altitude every 10 m of the route; empty without altitude on 90 % of the points. */
function profileOf(points: readonly RoutePoint[]): GridPoint[] {
  const cached = profileCache.get(points);
  if (cached) return cached;
  const profile = buildProfile(points);
  profileCache.set(points, profile);
  return profile;
}

function buildProfile(points: readonly RoutePoint[]): GridPoint[] {
  const n = points.length;
  if (n < 2) return [];
  let have = 0;
  for (const p of points) if (p.alt !== null && Number.isFinite(p.alt)) have++;
  if (have < n * MIN_ALT_SHARE) return [];
  const full = completeAltitudes(points);
  const { cumM, totalM } = buildRouteIndex(points);
  if (totalM < GRID_M) return [];
  const raw: GridPoint[] = [];
  let seg = 0;
  const steps = Math.floor(totalM / GRID_M);
  for (let k = 0; k <= steps; k++) {
    const d = k * GRID_M;
    while (seg < n - 2 && cumM[seg + 1]! < d) seg++;
    const len = cumM[seg + 1]! - cumM[seg]!;
    const t = len > 0 ? Math.min(1, Math.max(0, (d - cumM[seg]!) / len)) : 0;
    const a = full[seg]!.alt as number;
    const b = full[seg + 1]!.alt as number;
    raw.push({ distM: d, altM: a + (b - a) * t });
  }
  return raw.map((p, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - SMOOTH_HALF); j <= Math.min(raw.length - 1, i + SMOOTH_HALF); j++) {
      sum += raw[j]!.altM;
      count++;
    }
    return { distM: p.distM, altM: sum / count };
  });
}

/** Indices of the turning points: first sample, then each valley and peak the altitude left by at least `ZIGZAG_M`. */
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

function trimmed(profile: readonly GridPoint[], leg: Leg): Leg {
  const valley = profile[leg.from]!.altM;
  const peak = profile[leg.to]!.altM;
  let from = leg.from;
  while (from + 1 < leg.to && profile[from + 1]!.altM <= valley + TRIM_M) from += 1;
  let to = leg.to;
  while (to - 1 > from && profile[to - 1]!.altM >= peak - TRIM_M) to -= 1;
  return { from, to };
}

function categoryOf(score: number): ClimbCategory {
  switch (climbCategory(score)) {
    case 'hc':
      return 'HC';
    case '1':
      return 1;
    case '2':
      return 2;
    case '3':
      return 3;
    case '4':
      return 4;
    default:
      return null;
  }
}

/** The climbs of a route in route order; empty when fewer than 90 % of its points have an altitude. */
export function routeClimbs(points: readonly RoutePoint[]): RouteClimb[] {
  const profile = profileOf(points);
  if (profile.length < 3) return [];
  const climbs: RouteClimb[] = [];
  const windowPoints = Math.max(1, Math.round(MAX_GRADE_WINDOW_M / GRID_M));
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
    for (let i = leg.from; i + windowPoints <= leg.to; i++) {
      const w = profile[i + windowPoints]!.distM - profile[i]!.distM;
      if (w > 0) maxGrade = Math.max(maxGrade, ((profile[i + windowPoints]!.altM - profile[i]!.altM) / w) * 100);
    }
    climbs.push({
      startM: Math.round(a.distM),
      endM: Math.round(b.distM),
      lengthM: Math.round(lengthM),
      ascentM: Math.round(gainM * 10) / 10,
      avgGradePct: Math.round(avgGrade * 10) / 10,
      maxGradePct: Math.round(maxGrade * 10) / 10,
      category: categoryOf(score),
    });
  }
  return climbs;
}

/**
 * The climb the rider is on or the next one ahead. The ascent left in a climb under way is its ascent in proportion to the
 * distance left (a climb is stored by its averages, not its profile).
 */
export function climbAhead(climbs: readonly RouteClimb[], distanceDoneM: number): NavSnapshot['climb'] {
  for (const climb of climbs) {
    if (climb.endM <= distanceDoneM) continue;
    const inProgress = distanceDoneM >= climb.startM;
    if (!inProgress) return { climb, startsInM: climb.startM - distanceDoneM, remainingAscentM: climb.ascentM, remainingM: climb.lengthM, inProgress };
    const remainingM = climb.endM - distanceDoneM;
    const share = climb.lengthM > 0 ? Math.min(1, remainingM / climb.lengthM) : 0;
    return { climb, startsInM: 0, remainingAscentM: Math.round(climb.ascentM * share * 10) / 10, remainingM, inProgress };
  }
  return null;
}

/** `bins` evenly spaced samples of the smoothed altitude from `fromM` to `toM` (clamped to the route) for drawing a profile; empty without altitude. */
export function elevationStrip(points: readonly RoutePoint[], fromM: number, toM: number, bins: number): { distM: number; altM: number }[] {
  const profile = profileOf(points);
  const count = Math.floor(bins);
  const last = profile[profile.length - 1];
  if (!last || count < 1) return [];
  const from = Math.max(0, Math.min(fromM, last.distM));
  const to = Math.max(from, Math.min(toM, last.distM));
  const out: { distM: number; altM: number }[] = [];
  let k = 0;
  for (let i = 0; i < count; i++) {
    const d = count === 1 ? (from + to) / 2 : from + ((to - from) * i) / (count - 1);
    while (k < profile.length - 2 && profile[k + 1]!.distM < d) k++;
    const a = profile[k]!;
    const b = profile[Math.min(k + 1, profile.length - 1)]!;
    const span = b.distM - a.distM;
    const t = span > 0 ? Math.min(1, Math.max(0, (d - a.distM) / span)) : 0;
    out.push({ distM: d, altM: a.altM + (b.altM - a.altM) * t });
  }
  return out;
}

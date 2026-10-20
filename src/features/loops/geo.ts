/** Map-independent geometry for the loop planner. Pure: no React, no native modules, so it runs under `bun test`. */
import type { LatLon } from '@/features/routes/map/geometry';
import { haversineM } from '@/features/routes/routeModel';

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Metres per degree of latitude (and of longitude at the equator) on the sphere haversine uses. */
export const M_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;

/** The point `distanceM` away from `from` on a great circle that leaves at `bearingDeg` (0 north, 90 east). */
export function destination(from: LatLon, bearingDeg: number, distanceM: number): LatLon {
  const angular = distanceM / EARTH_RADIUS_M;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(from.lat);
  const lon1 = toRad(from.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
  const lon2 =
    lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

/** Length of the line in metres. */
export function pathLengthM(line: readonly LatLon[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += haversineM(line[i - 1], line[i]);
  return total;
}

/**
 * Points along the line every `stepM` metres, the first and the last point always included. A line shorter than the step is
 * its two ends. Each segment is cut where it crosses a multiple of the step, so the spacing is even across the corners.
 */
export function resampleLine(line: readonly LatLon[], stepM: number): LatLon[] {
  if (line.length === 0) return [];
  const out: LatLon[] = [line[0]];
  let carried = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const segment = haversineM(a, b);
    if (segment === 0) continue;
    let at = stepM - carried;
    while (at < segment) {
      const f = at / segment;
      out.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
      at += stepM;
    }
    carried = segment - (at - stepM);
  }
  const last = line[line.length - 1];
  const end = out[out.length - 1];
  if (end.lat !== last.lat || end.lon !== last.lon) out.push(last);
  return out;
}

/** A leg that goes out and comes back on the same street shorter than this (one way) is a spur. */
export const SPUR_MAX_M = 150;
/** The line is "back at the same place" when it is within this distance of where the leg started. */
const SPUR_RETURN_M = 12;
/** ...and the way back is "the same street" when every point of it is within this distance of the way out. */
const SPUR_RETRACE_M = 18;
/** The way back is compared with the way out every this many metres. */
const SPUR_CHECK_STEP_M = 8;

/** The point `d` metres along `line`, whose running lengths are `cum` (`cum[k]` is the length up to vertex `k`). */
function pointAtDistance(line: readonly LatLon[], cum: readonly number[], d: number): LatLon {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const span = cum[hi] - cum[lo];
  if (span <= 0) return line[lo];
  const f = Math.min(1, Math.max(0, (d - cum[lo]) / span));
  return { lat: line[lo].lat + (line[hi].lat - line[lo].lat) * f, lon: line[lo].lon + (line[hi].lon - line[lo].lon) * f };
}

/** Whether `line` from vertex `from` to `to` goes out and comes back the way it went: the second half mirrors the first. */
function retraces(line: readonly LatLon[], from: number, to: number): boolean {
  const part = line.slice(from, to + 1);
  const cum = [0];
  for (let k = 1; k < part.length; k++) cum.push(cum[k - 1] + haversineM(part[k - 1], part[k]));
  const total = cum[cum.length - 1];
  for (let d = SPUR_CHECK_STEP_M; d < total / 2; d += SPUR_CHECK_STEP_M) {
    if (haversineM(pointAtDistance(part, cum, d), pointAtDistance(part, cum, total - d)) > SPUR_RETRACE_M) return false;
  }
  return true;
}

/**
 * The line without its spurs: a stretch that leaves a point, goes out at most `maxSpurM` and returns to that point along the
 * same street is cut down to the point. Routing through a waypoint on a dead-end side street makes these; they show as stubs on
 * the map and add steps without adding anything to the loop. A longer out-and-back is kept (it is a real detour, and the loop's
 * repeat score already counts it). The first and the last point stay where they are.
 */
export function removeSpurs(line: readonly LatLon[], maxSpurM = SPUR_MAX_M): LatLon[] {
  const out = [...line];
  const reach = 2 * maxSpurM + SPUR_RETURN_M;
  let i = 0;
  while (i < out.length - 2) {
    let cut = -1;
    let length = 0;
    for (let j = i + 1; j < out.length; j++) {
      length += haversineM(out[j - 1], out[j]);
      if (length > reach) break;
      if (j >= i + 2 && haversineM(out[i], out[j]) <= SPUR_RETURN_M && retraces(out, i, j)) cut = j;
    }
    if (cut < 0) {
      i++;
      continue;
    }
    // Drop everything between the two visits; the last point of the line is never dropped.
    out.splice(i + 1, cut === out.length - 1 ? cut - i - 1 : cut - i);
  }
  return out;
}

/** The box around `center`, `radiusM` metres to every side, as `[south, west, north, east]`. */
export function boxAround(center: LatLon, radiusM: number): [number, number, number, number] {
  const dLat = radiusM / M_PER_DEG;
  const dLon = radiusM / (M_PER_DEG * Math.max(0.05, Math.cos(toRad(center.lat))));
  return [center.lat - dLat, center.lon - dLon, center.lat + dLat, center.lon + dLon];
}

/** A small deterministic generator (mulberry32): the same seed gives the same sequence, in `[0, 1)`. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

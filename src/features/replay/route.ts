/**
 * The path the replay flies along: the track in normalised Web Mercator, cut by the privacy trim (the same 200 m off both
 * ends the stickers use), de-duplicated and rounded off with two Chaikin passes so a 600-sample grid does not show corners
 * at street zoom. Every vertex keeps the fractional sample index it came from, which is how the stats (speed, heart rate,
 * altitude) are looked up at a place on the path.
 */
import { lonLatToMerc } from '@/features/map/tileMath';

import type { ReplayTrack } from './track';

export interface RoutePath {
  /** Normalised Mercator (0..1, y down). */
  mx: Float64Array;
  my: Float64Array;
  /** Metres from the start of the path. */
  cum: Float64Array;
  /** Fractional sample index of each vertex, non-decreasing. */
  idx: Float64Array;
  lengthM: number;
  /** Metres per Mercator unit at the track's mean latitude. */
  mPerUnit: number;
  /** Metres cut off the start and the end. */
  trimmedM: number;
}

export const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
/** The path is not drawn at all when less than this is left after trimming. */
export const MIN_ROUTE_M = 50;
const DUP_M = 0.5;

interface Pt {
  x: number;
  y: number;
  i: number;
}

function cumulative(pts: readonly Pt[], mPerUnit: number): number[] {
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1]! + Math.hypot(pts[k]!.x - pts[k - 1]!.x, pts[k]!.y - pts[k - 1]!.y) * mPerUnit);
  return cum;
}

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, i: a.i + (b.i - a.i) * t };
}

/** One Chaikin corner-cutting pass that keeps both end points. */
function chaikin(pts: readonly Pt[]): Pt[] {
  if (pts.length < 3) return pts.slice();
  const out: Pt[] = [pts[0]!];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    out.push(lerpPt(a, b, 0.25), lerpPt(a, b, 0.75));
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/**
 * `trimM` metres are removed from both ends. `null` when nothing worth drawing is left (the whole track is shorter than the
 * trim plus `MIN_ROUTE_M`, or has no extent).
 */
export function buildRoutePath(track: ReplayTrack, trimM: number): RoutePath | null {
  const merc = track.lat.map((lat, i) => ({ ...lonLatToMerc(lat, track.lon[i]!), i }));
  const meanLat = track.lat.reduce((s, v) => s + v, 0) / track.lat.length;
  const mPerUnit = EARTH_CIRCUMFERENCE_M * Math.cos((meanLat * Math.PI) / 180);
  const cum = cumulative(merc, mPerUnit);
  const total = cum[cum.length - 1]!;
  const trim = Math.max(0, trimM);
  const from = trim;
  const to = total - trim;
  if (to - from < MIN_ROUTE_M) return null;

  // Cut [from, to] with interpolated end points.
  const cut: Pt[] = [];
  const at = (d: number): Pt => {
    for (let k = 1; k < cum.length; k++) {
      if (cum[k]! >= d) {
        const span = cum[k]! - cum[k - 1]!;
        return lerpPt(merc[k - 1]!, merc[k]!, span === 0 ? 0 : (d - cum[k - 1]!) / span);
      }
    }
    return merc[merc.length - 1]!;
  };
  cut.push(at(from));
  for (let k = 0; k < merc.length; k++) if (cum[k]! > from && cum[k]! < to) cut.push(merc[k]!);
  cut.push(at(to));

  // Drop near-duplicates (a stop writes the same fix many times).
  const dedup: Pt[] = [cut[0]!];
  for (let k = 1; k < cut.length; k++) {
    const last = dedup[dedup.length - 1]!;
    const isLast = k === cut.length - 1;
    if (Math.hypot(cut[k]!.x - last.x, cut[k]!.y - last.y) * mPerUnit >= DUP_M || isLast) {
      if (isLast && dedup.length > 1 && Math.hypot(cut[k]!.x - last.x, cut[k]!.y - last.y) * mPerUnit < DUP_M) dedup[dedup.length - 1] = cut[k]!;
      else dedup.push(cut[k]!);
    }
  }
  if (dedup.length < 2) return null;

  const smooth = chaikin(chaikin(dedup));
  const sc = cumulative(smooth, mPerUnit);
  const n = smooth.length;
  const path: RoutePath = {
    mx: new Float64Array(n),
    my: new Float64Array(n),
    cum: Float64Array.from(sc),
    idx: new Float64Array(n),
    lengthM: sc[n - 1]!,
    mPerUnit,
    trimmedM: trim,
  };
  for (let k = 0; k < n; k++) {
    path.mx[k] = smooth[k]!.x;
    path.my[k] = smooth[k]!.y;
    path.idx[k] = smooth[k]!.i;
  }
  return path.lengthM >= MIN_ROUTE_M ? path : null;
}

/** Index `k` such that `arr[k] <= v <= arr[k + 1]` (clamped to `[0, n - 2]`). */
export function bracket(arr: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! <= v) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface PathPoint {
  mx: number;
  my: number;
  /** Fractional sample index. */
  idx: number;
}

/** The point `d` metres along the path (clamped to its ends). */
export function pointAt(path: RoutePath, d: number): PathPoint {
  const dd = Math.min(path.lengthM, Math.max(0, d));
  const k = bracket(path.cum, dd);
  const span = path.cum[k + 1]! - path.cum[k]!;
  const t = span === 0 ? 0 : (dd - path.cum[k]!) / span;
  return {
    mx: path.mx[k]! + (path.mx[k + 1]! - path.mx[k]!) * t,
    my: path.my[k]! + (path.my[k + 1]! - path.my[k]!) * t,
    idx: path.idx[k]! + (path.idx[k + 1]! - path.idx[k]!) * t,
  };
}

/** Metres along the path where the fractional sample index `idx` is reached (clamped to the ends). */
export function distanceOfIndex(path: RoutePath, idx: number): number {
  const n = path.idx.length;
  if (idx <= path.idx[0]!) return 0;
  if (idx >= path.idx[n - 1]!) return path.lengthM;
  const k = bracket(path.idx, idx);
  const span = path.idx[k + 1]! - path.idx[k]!;
  const t = span === 0 ? 0 : (idx - path.idx[k]!) / span;
  return path.cum[k]! + (path.cum[k + 1]! - path.cum[k]!) * t;
}

/** A track array (altitude, heart rate, ...) read at a fractional sample index, ignoring gaps (nearest real neighbours). */
export function sampleAt(values: readonly (number | null)[], idx: number): number | null {
  const n = values.length;
  const i = Math.min(n - 1, Math.max(0, idx));
  const lo = Math.floor(i);
  const hi = Math.min(n - 1, lo + 1);
  const a = values[lo];
  const b = values[hi];
  if (a != null && b != null) return a + (b - a) * (i - lo);
  return a ?? b ?? null;
}

/** The metres of odometer distance at a fractional sample index. */
export function odometerAt(dist: readonly number[], idx: number): number {
  const n = dist.length;
  const i = Math.min(n - 1, Math.max(0, idx));
  const lo = Math.floor(i);
  const hi = Math.min(n - 1, lo + 1);
  return dist[lo]! + (dist[hi]! - dist[lo]!) * (i - lo);
}

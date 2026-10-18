import { haversineM, type RoutePoint } from '@/features/routes/routeModel';

/** Window around the previous match: this far behind it (GPS jitter, a rider turning back), the hint's `windowM` ahead of it. */
export const DEFAULT_BEHIND_M = 100;
export const DEFAULT_AHEAD_M = 1500;
/** Nothing in the window within this distance sends the search to the whole route. */
export const WINDOW_MATCH_M = 100;
/** Candidates this much farther than the nearest one still count as "the same place" and the one nearest to the hint wins. */
const TIE_M = 5;
/** Candidates farther apart than this along the route are different passes of the same place. */
const PASS_M = 50;
const M_PER_DEG = 111_194.93;
const TARGET_CELLS = 200;
const MIN_CELL_M = 200;

export interface RouteIndex {
  points: readonly RoutePoint[];
  /** Metres from the start to point i. */
  cumM: Float64Array;
  totalM: number;
  /** Local planar coordinates in metres (equirectangular around the bounding box centre). */
  xs: Float64Array;
  ys: Float64Array;
  lat0: number;
  lon0: number;
  cosLat0: number;
  cellM: number;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  /** Segment indices per grid cell (key = row * cols + col). */
  cells: Map<number, number[]>;
}

export interface Projection {
  /** Metres along the route. */
  atM: number;
  /** Segment i runs from point i to point i + 1 (0 for a one point route). */
  segment: number;
  /** Perpendicular distance from the route, metres. */
  offM: number;
  lat: number;
  lon: number;
}

export interface ProjectHint {
  atM: number;
  windowM: number;
}

export function buildRouteIndex(points: readonly RoutePoint[]): RouteIndex {
  const n = points.length;
  if (n === 0) throw new Error('route has no points');
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  const lat0 = (minLat + maxLat) / 2;
  const lon0 = (minLon + maxLon) / 2;
  const cosLat0 = Math.max(0.01, Math.cos((lat0 * Math.PI) / 180));
  const cumM = new Float64Array(n);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    if (i > 0) cumM[i] = cumM[i - 1]! + haversineM(points[i - 1]!, p);
    const x = (p.lon - lon0) * cosLat0 * M_PER_DEG;
    const y = (p.lat - lat0) * M_PER_DEG;
    xs[i] = x;
    ys[i] = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cellM = Math.max(MIN_CELL_M, Math.max(maxX - minX, maxY - minY) / TARGET_CELLS);
  const cols = Math.floor((maxX - minX) / cellM) + 1;
  const rows = Math.floor((maxY - minY) / cellM) + 1;
  const cells = new Map<number, number[]>();
  const segs = Math.max(1, n - 1);
  for (let s = 0; s < segs; s++) {
    const j = Math.min(s + 1, n - 1);
    const c0 = Math.floor((Math.min(xs[s]!, xs[j]!) - minX) / cellM);
    const c1 = Math.floor((Math.max(xs[s]!, xs[j]!) - minX) / cellM);
    const r0 = Math.floor((Math.min(ys[s]!, ys[j]!) - minY) / cellM);
    const r1 = Math.floor((Math.max(ys[s]!, ys[j]!) - minY) / cellM);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = r * cols + c;
        const list = cells.get(key);
        if (list) list.push(s);
        else cells.set(key, [s]);
      }
    }
  }
  return { points, cumM, totalM: cumM[n - 1]!, xs, ys, lat0, lon0, cosLat0, cellM, minX, minY, cols, rows, cells };
}

interface Candidate {
  segment: number;
  t: number;
  offM: number;
  atM: number;
}

function candidateOf(index: RouteIndex, px: number, py: number, s: number): Candidate {
  const n = index.points.length;
  const j = Math.min(s + 1, n - 1);
  const ax = index.xs[s]!;
  const ay = index.ys[s]!;
  const dx = index.xs[j]! - ax;
  const dy = index.ys[j]! - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const offM = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  const atM = index.cumM[s]! + t * (index.cumM[j]! - index.cumM[s]!);
  return { segment: s, t, offM, atM };
}

/**
 * The nearest candidate. Where the route passes this place more than once (candidates within `TIE_M` of the nearest, more than
 * `PASS_M` apart along the route), the pass nearest `hintM` along the route wins; then the nearest point of that pass.
 */
function choose(cands: readonly Candidate[], hintM: number | null): Candidate | null {
  let best: Candidate | null = null;
  for (const c of cands) if (!best || c.offM < best.offM) best = c;
  if (!best || hintM === null) return best;
  let anchor = best;
  for (const c of cands) {
    if (c.offM <= best.offM + TIE_M && Math.abs(c.atM - hintM) < Math.abs(anchor.atM - hintM)) anchor = c;
  }
  if (Math.abs(anchor.atM - best.atM) <= PASS_M) return best;
  let pass = anchor;
  for (const c of cands) if (Math.abs(c.atM - anchor.atM) <= PASS_M && c.offM < pass.offM) pass = c;
  return pass;
}

/** First segment whose end is at or after `m`. */
function segmentAtOrAfter(cumM: Float64Array, m: number): number {
  let lo = 0;
  let hi = cumM.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumM[mid]! < m) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

function windowCandidates(index: RouteIndex, px: number, py: number, fromM: number, toM: number): Candidate[] {
  const n = index.points.length;
  const last = Math.max(0, n - 2);
  const out: Candidate[] = [];
  const from = Math.min(last, segmentAtOrAfter(index.cumM, fromM));
  for (let s = from; s <= last; s++) {
    if (index.cumM[s]! > toM) break;
    out.push(candidateOf(index, px, py, s));
  }
  return out;
}

function gridCandidates(index: RouteIndex, px: number, py: number, radiusM: number, seen: Uint8Array): Candidate[] {
  const c0 = Math.max(0, Math.floor((px - radiusM - index.minX) / index.cellM));
  const c1 = Math.min(index.cols - 1, Math.floor((px + radiusM - index.minX) / index.cellM));
  const r0 = Math.max(0, Math.floor((py - radiusM - index.minY) / index.cellM));
  const r1 = Math.min(index.rows - 1, Math.floor((py + radiusM - index.minY) / index.cellM));
  const out: Candidate[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const list = index.cells.get(r * index.cols + c);
      if (!list) continue;
      for (const s of list) {
        if (seen[s]) continue;
        seen[s] = 1;
        out.push(candidateOf(index, px, py, s));
      }
    }
  }
  return out;
}

function globalSearch(index: RouteIndex, px: number, py: number, hintM: number | null): Candidate {
  const n = index.points.length;
  const segs = Math.max(1, n - 1);
  const seen = new Uint8Array(segs);
  const all: Candidate[] = [];
  // The nearest segment anywhere is within `radius` once a candidate is within `radius - cellM` (cells are searched whole).
  for (let radius = 150; radius <= 20_000; radius *= 4) {
    all.push(...gridCandidates(index, px, py, radius, seen));
    const found = choose(all, hintM);
    if (found && found.offM <= radius) return choose(all, hintM)!;
  }
  for (let s = 0; s < segs; s++) if (!seen[s]) all.push(candidateOf(index, px, py, s));
  return choose(all, hintM)!;
}

function toProjection(index: RouteIndex, c: Candidate): Projection {
  const n = index.points.length;
  const a = index.points[c.segment]!;
  const b = index.points[Math.min(c.segment + 1, n - 1)]!;
  return { atM: c.atM, segment: c.segment, offM: c.offM, lat: a.lat + (b.lat - a.lat) * c.t, lon: a.lon + (b.lon - a.lon) * c.t };
}

/**
 * Nearest point of the route to a fix. With a hint, only the stretch from 100 m behind to `windowM` ahead of it is searched; if
 * nothing there is within 100 m the whole route is searched. Where the route passes the same place twice, the pass nearest to the
 * hint along the route wins.
 */
export function project(index: RouteIndex, lat: number, lon: number, hint?: ProjectHint): Projection {
  const px = (lon - index.lon0) * index.cosLat0 * M_PER_DEG;
  const py = (lat - index.lat0) * M_PER_DEG;
  if (hint) {
    const behind = Math.min(DEFAULT_BEHIND_M, hint.windowM);
    const cands = windowCandidates(index, px, py, hint.atM - behind, hint.atM + hint.windowM);
    const best = choose(cands, hint.atM);
    if (best && best.offM <= WINDOW_MATCH_M) return toProjection(index, best);
    return toProjection(index, globalSearch(index, px, py, hint.atM));
  }
  return toProjection(index, globalSearch(index, px, py, null));
}

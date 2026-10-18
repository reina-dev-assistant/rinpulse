import type { RoutePoint } from '@/features/routes/routeModel';

import type { TurnCue, TurnKind } from '../types';
import { buildRouteIndex } from './routeIndex';

export interface CueConfig {
  /** Arc length before and after a vertex over which the heading is compared, metres. */
  lookM?: number;
  /** Smallest heading change that is a turn, degrees. */
  minAngleDeg?: number;
  /** Candidates closer than this merge into the larger, metres. */
  mergeM?: number;
  /** Turn cues closer than this to the previous one merge into the larger, metres. */
  minGapM?: number;
}

export const DEFAULT_CUE_CONFIG: Required<CueConfig> = { lookM: 30, minAngleDeg: 25, mergeM: 25, minGapM: 30 };

const STEP_M = 5;
/** Moving average over ±2 samples (±10 m) that takes GPS jitter out before headings are compared. */
const SMOOTH_HALF = 2;
/** A candidate must be the largest change within this arc length either side. */
const PEAK_M = 15;

interface Candidate {
  atM: number;
  lat: number;
  lon: number;
  /** Signed heading change in degrees: positive turns right. */
  deg: number;
}

function kindOf(deg: number): TurnKind {
  const a = Math.abs(deg);
  const right = deg > 0;
  if (a > 160) return 'uTurn';
  if (a > 120) return right ? 'sharpRight' : 'sharpLeft';
  if (a > 60) return right ? 'right' : 'left';
  return right ? 'slightRight' : 'slightLeft';
}

/** Turn cues of a route from its geometry, with `start` at 0 m and `finish` at the end. */
export function generateCues(points: readonly RoutePoint[], cfg: CueConfig = {}): TurnCue[] {
  const { lookM, minAngleDeg, mergeM, minGapM } = { ...DEFAULT_CUE_CONFIG, ...cfg };
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return [];
  const index = buildRouteIndex(points);
  const total = index.totalM;
  const start: TurnCue = { kind: 'start', atM: 0, lat: first.lat, lon: first.lon };
  const finish: TurnCue = { kind: 'finish', atM: total, lat: last.lat, lon: last.lon };
  if (total < 2 * STEP_M) return [start, finish];

  // Resample at a fixed arc-length step so dense tracks and sparse drawn routes are measured alike.
  const count = Math.floor(total / STEP_M) + 1;
  const rx = new Float64Array(count);
  const ry = new Float64Array(count);
  const rlat = new Float64Array(count);
  const rlon = new Float64Array(count);
  const n = points.length;
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const d = k * STEP_M;
    while (seg < n - 2 && index.cumM[seg + 1]! < d) seg++;
    const len = index.cumM[seg + 1]! - index.cumM[seg]!;
    const t = len > 0 ? Math.min(1, Math.max(0, (d - index.cumM[seg]!) / len)) : 0;
    const a = points[seg]!;
    const b = points[seg + 1]!;
    rx[k] = index.xs[seg]! + (index.xs[seg + 1]! - index.xs[seg]!) * t;
    ry[k] = index.ys[seg]! + (index.ys[seg + 1]! - index.ys[seg]!) * t;
    rlat[k] = a.lat + (b.lat - a.lat) * t;
    rlon[k] = a.lon + (b.lon - a.lon) * t;
  }
  const sx = new Float64Array(count);
  const sy = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const lo = Math.max(0, k - SMOOTH_HALF);
    const hi = Math.min(count - 1, k + SMOOTH_HALF);
    let ax = 0;
    let ay = 0;
    for (let j = lo; j <= hi; j++) {
      ax += rx[j]!;
      ay += ry[j]!;
    }
    sx[k] = ax / (hi - lo + 1);
    sy[k] = ay / (hi - lo + 1);
  }

  // Signed heading change at every sample, from chords over arc-length windows.
  const lookN = Math.max(1, Math.round(lookM / STEP_M));
  const change = new Float64Array(count);
  for (let k = 1; k < count - 1; k++) {
    const w = Math.min(lookN, k, count - 1 - k);
    if (w < 2) continue;
    const bx = sx[k]! - sx[k - w]!;
    const by = sy[k]! - sy[k - w]!;
    const ax = sx[k + w]! - sx[k]!;
    const ay = sy[k + w]! - sy[k]!;
    if (bx * bx + by * by < 1e-6 || ax * ax + ay * ay < 1e-6) continue;
    let d = ((Math.atan2(ax, ay) - Math.atan2(bx, by)) * 180) / Math.PI;
    if (d > 180) d -= 360;
    else if (d <= -180) d += 360;
    change[k] = d;
  }

  // Local maxima of |change| (the first of a plateau) above the threshold.
  const peakN = Math.max(1, Math.round(PEAK_M / STEP_M));
  const cands: Candidate[] = [];
  for (let k = 1; k < count - 1; k++) {
    const a = Math.abs(change[k]!);
    if (a < minAngleDeg) continue;
    let isPeak = true;
    for (let j = Math.max(0, k - peakN); j <= Math.min(count - 1, k + peakN) && isPeak; j++) {
      if (j === k) continue;
      const b = Math.abs(change[j]!);
      if (j < k ? b >= a : b > a) isPeak = false;
    }
    if (isPeak) cands.push({ atM: k * STEP_M, lat: rlat[k]!, lon: rlon[k]!, deg: change[k]! });
  }

  const merged = mergeClose(cands, mergeM);
  const spaced = mergeClose(merged, minGapM);
  return [start, ...spaced.map((c): TurnCue => ({ kind: kindOf(c.deg), atM: c.atM, lat: c.lat, lon: c.lon })), finish];
}

/** Candidates closer than `gapM` to the previous kept one: the larger change stays. */
function mergeClose(cands: readonly Candidate[], gapM: number): Candidate[] {
  const out: Candidate[] = [];
  for (const c of cands) {
    const prev = out[out.length - 1];
    if (prev && c.atM - prev.atM < gapM) {
      if (Math.abs(c.deg) > Math.abs(prev.deg)) out[out.length - 1] = c;
    } else out.push(c);
  }
  return out;
}

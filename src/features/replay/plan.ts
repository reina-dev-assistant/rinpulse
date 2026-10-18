/**
 * Everything about a replay that does not change from frame to frame: the privacy-trimmed path, the timeline, the camera and
 * tile plan, the pins, the km marks, the chart columns and the terrain silhouette. Built once per (workout, trim); the
 * per-frame state (`frame.ts`) only reads it.
 */
import { TILE_SIZE } from '@/features/map/tileMath';

import { planWithinBudget, type BasemapPlan } from './basemap';
import { VIEW, type CameraPlan, type Viewport } from './camera';
import { selectCallouts, type CalloutDef } from './callouts';
import { buildRoutePath, distanceOfIndex, odometerAt, pointAt, sampleAt, type RoutePath } from './route';
import { buildTiming, type Timing } from './timing';
import type { ReplayTrack } from './track';

export const DEFAULT_TRIM_M = 200;
export const CHART_COLS = 96;

export interface KmMark {
  /** Label: the km of the (scaled) distance counter. */
  km: number;
  p: number;
  mx: number;
  my: number;
}

export interface ChartData {
  /** Altitude per column, null without altitude. */
  alt: (number | null)[] | null;
  /** The line over it: heart rate, else speed, else power. */
  line: (number | null)[] | null;
  lineKind: 'hr' | 'speed' | 'power' | null;
}

export interface ReplayPlan {
  track: ReplayTrack;
  path: RoutePath;
  timing: Timing;
  vp: Viewport;
  camera: CameraPlan;
  basemap: BasemapPlan;
  callouts: CalloutDef[];
  marks: KmMark[];
  chart: ChartData;
  /** Fractional sample range the path covers and the odometer and clock there. */
  odo0: number;
  odo1: number;
  t0: number;
  t1: number;
  /** Route `d` in local px of `basemap.refZoom` around the basemap origin, and its length in those px. */
  routeD: string;
  routeLenPx: number;
  /** Local px per metre of path. */
  pxPerM: number;
  /** Seed for the terrain silhouette, stable per workout. */
  seed: number;
}

export type PlanFailure = 'no-route' | 'too-short';

export function niceKmStep(totalKm: number): number {
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 200]) if (totalKm / step <= 5) return step;
  return 500;
}

function hashSeed(track: ReplayTrack): number {
  let h = 2166136261;
  for (const v of [track.lat[0]!, track.lon[0]!, track.n, track.totals.distanceM]) {
    h ^= Math.round(v * 1000);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function chartOf(track: ReplayTrack, path: RoutePath): ChartData {
  const cols = CHART_COLS;
  const idxAtCol = (j: number) => pointAt(path, (j / (cols - 1)) * path.lengthM).idx;
  const read = (values: readonly (number | null)[]) => Array.from({ length: cols }, (_, j) => sampleAt(values, idxAtCol(j)));
  const real = (a: (number | null)[]) => a.some((v) => v !== null);
  const alt = read(track.alt);
  const hr = read(track.hr);
  const speed = read(track.speed.map((v) => (v > 0 ? v : null)));
  const power = read(track.power);
  const onFoot = track.kind === 'ride' || track.kind === 'run' || track.kind === 'walk';
  const line = real(hr)
    ? { v: hr, k: 'hr' as const }
    : onFoot && real(speed)
      ? { v: speed, k: 'speed' as const }
      : real(power)
        ? { v: power, k: 'power' as const }
        : null;
  return { alt: real(alt) ? alt : null, line: line?.v ?? null, lineKind: line?.k ?? null };
}

export interface PlanOptions {
  /** Metres cut off both ends of the path (privacy); 0 draws the whole route. */
  trimM?: number;
  vp?: Viewport;
  maxTiles?: number;
}

/** `null` and a reason when there is nothing to replay. */
export function planReplay(track: ReplayTrack, opts: PlanOptions = {}): { plan: ReplayPlan } | { failure: PlanFailure } {
  const vp = opts.vp ?? VIEW;
  const path = buildRoutePath(track, opts.trimM ?? DEFAULT_TRIM_M);
  if (!path) return { failure: track.totals.distanceM > 0 || track.n > 1 ? 'too-short' : 'no-route' };

  const timing = buildTiming(track.totals.elapsedSec);
  const { camera, basemap } = planWithinBudget(path, vp, timing, opts.maxTiles);

  const idxLo = path.idx[0]!;
  const idxHi = path.idx[path.idx.length - 1]!;
  const odo0 = odometerAt(track.dist, idxLo);
  const odo1 = odometerAt(track.dist, idxHi);
  const t0 = idxLo * track.stepSec;
  const t1 = idxHi * track.stepSec;

  // Km marks on the scaled distance counter (0 .. total): where it crosses each step.
  const total = track.totals.distanceM;
  const step = niceKmStep(total / 1000);
  const marks: KmMark[] = [];
  const span = Math.max(odo1 - odo0, 1);
  for (let km = step; km * 1000 < total * 0.97; km += step) {
    const odo = odo0 + (km * 1000 * span) / Math.max(total, 1);
    // Odometer -> sample index -> path distance.
    let lo = 0;
    let hi = track.dist.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (track.dist[mid]! <= odo) lo = mid;
      else hi = mid;
    }
    const seg = track.dist[hi]! - track.dist[lo]!;
    const idx = lo + (seg === 0 ? 0 : (odo - track.dist[lo]!) / seg);
    const d = distanceOfIndex(path, idx);
    const p = d / path.lengthM;
    if (p <= 0.02 || p >= 0.98) continue;
    const at = pointAt(path, d);
    marks.push({ km, p, mx: at.mx, my: at.my });
  }

  const wRef = TILE_SIZE * 2 ** basemap.refZoom;
  let routeD = '';
  for (let k = 0; k < path.mx.length; k++) {
    const x = (path.mx[k]! - basemap.ox) * wRef;
    const y = (path.my[k]! - basemap.oy) * wRef;
    routeD += `${k === 0 ? 'M' : 'L'}${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`;
  }

  return {
    plan: {
      track,
      path,
      timing,
      vp,
      camera,
      basemap,
      callouts: selectCallouts(track, path),
      marks,
      chart: chartOf(track, path),
      odo0,
      odo1,
      t0,
      t1,
      routeD,
      routeLenPx: (path.lengthM / path.mPerUnit) * wRef,
      pxPerM: wRef / path.mPerUnit,
      seed: hashSeed(track),
    },
  };
}

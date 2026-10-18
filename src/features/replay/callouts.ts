/**
 * Which moments of the workout get a pin: the highest heart rate, the top speed (best pace on a run), the highest point, a
 * personal record and the biggest climb. Chosen from the same series the detail screen shows, only inside the part of the
 * route that is drawn (the privacy trim hides the rest), de-duplicated so two pins never stack, at most four.
 */
import { BEST_EFFORT_DISTANCES } from '@/features/workouts/analysis/types';

import { bracket, distanceOfIndex, pointAt, type RoutePath } from './route';
import type { ReplayTrack } from './track';

export type CalloutKind = 'pr' | 'highest' | 'maxSpeed' | 'bestPace' | 'maxHr' | 'climb';

export interface CalloutDef {
  id: string;
  kind: CalloutKind;
  /** Route progress 0..1 where the pin sits. */
  p: number;
  mx: number;
  my: number;
  /** bpm, km/h, seconds per km, metres of altitude, seconds of the record, metres climbed. */
  value: number;
  /** `BestEffortKey` of a record. */
  effort?: string;
}

export const MAX_CALLOUTS = 4;
/** Pins closer than this share of the route are merged (the higher priority stays). */
export const MIN_PIN_GAP = 0.05;
/** Pins this close to either end are dropped: the start and the finish already have their own marks. */
export const EDGE_MARGIN = 0.04;
export const MIN_ALT_RANGE_M = 25;
export const MIN_CLIMB_GAIN_M = 50;
const MIN_HR = 60;

const PRIORITY: Record<CalloutKind, number> = { pr: 5, highest: 4, maxSpeed: 3, bestPace: 3, maxHr: 3, climb: 2 };

function argBest(values: readonly (number | null)[], lo: number, hi: number, better: (a: number, b: number) => boolean): { i: number; v: number } | null {
  let best: { i: number; v: number } | null = null;
  for (let i = Math.max(0, Math.ceil(lo)); i <= Math.min(values.length - 1, Math.floor(hi)); i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    if (best === null || better(v, best.v)) best = { i, v };
  }
  return best;
}

/** Fractional sample index at an odometer distance. */
function indexAtOdometer(dist: readonly number[], m: number): number {
  if (m <= dist[0]!) return 0;
  if (m >= dist[dist.length - 1]!) return dist.length - 1;
  const k = bracket(dist, m);
  const span = dist[k + 1]! - dist[k]!;
  return k + (span === 0 ? 0 : (m - dist[k]!) / span);
}

export function selectCallouts(track: ReplayTrack, path: RoutePath): CalloutDef[] {
  const lo = path.idx[0]!;
  const hi = path.idx[path.idx.length - 1]!;
  const out: CalloutDef[] = [];

  const add = (id: string, kind: CalloutKind, idx: number, value: number, effort?: string) => {
    const d = distanceOfIndex(path, idx);
    const p = d / path.lengthM;
    if (p < EDGE_MARGIN || p > 1 - EDGE_MARGIN) return;
    const at = pointAt(path, d);
    out.push({ id, kind, p, mx: at.mx, my: at.my, value, effort });
  };

  const hr = argBest(track.hr, lo, hi, (a, b) => a > b);
  if (hr && hr.v >= MIN_HR) add('maxHr', 'maxHr', hr.i, Math.round(hr.v));

  const speeds = track.speed.map((v) => (v > 0 ? v : null));
  const fastest = argBest(speeds, lo, hi, (a, b) => a > b);
  if (fastest) {
    if (track.kind === 'ride') add('maxSpeed', 'maxSpeed', fastest.i, fastest.v * 3.6);
    else if (track.kind === 'run') add('bestPace', 'bestPace', fastest.i, 1000 / fastest.v);
  }

  const alts = track.alt;
  const high = argBest(alts, lo, hi, (a, b) => a > b);
  const low = argBest(alts, lo, hi, (a, b) => a < b);
  if (high && low && high.v - low.v >= MIN_ALT_RANGE_M) add('highest', 'highest', high.i, Math.round(high.v));

  const records = track.bestEfforts.filter((e) => e.rank === 1 && e.key in BEST_EFFORT_DISTANCES);
  if (records.length > 0) {
    const top = records.reduce((a, b) => (BEST_EFFORT_DISTANCES[b.key] > BEST_EFFORT_DISTANCES[a.key] ? b : a));
    add('pr', 'pr', indexAtOdometer(track.dist, top.atM + BEST_EFFORT_DISTANCES[top.key]), top.sec, top.key);
  }

  const climb = track.climbs.filter((c) => c.gainM >= MIN_CLIMB_GAIN_M).sort((a, b) => b.gainM - a.gainM)[0];
  if (climb) add('climb', 'climb', indexAtOdometer(track.dist, climb.endM), Math.round(climb.gainM));

  // Merge pins that would sit on top of each other: walk by priority, keep a pin only if it is clear of the kept ones.
  const kept: CalloutDef[] = [];
  for (const c of out.sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind])) {
    if (kept.length >= MAX_CALLOUTS) break;
    if (kept.every((k) => Math.abs(k.p - c.p) >= MIN_PIN_GAP)) kept.push(c);
  }
  return kept.sort((a, b) => a.p - b.p);
}

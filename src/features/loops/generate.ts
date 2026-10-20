/**
 * Round-trip loops from one point. Routing services with a real round-trip call need an API key or are not reliable about the
 * length, so the loop is built here: a few waypoints on a seeded, jittered ring that passes through the start, one foot-routing
 * request through them (`start, w1 .. wn, start`), and the ring is rescaled until the routed length lands within 5% of the
 * target. Several seeds give several different loops; the one on the fewest painted streets wins. Pure: the router is injected.
 *
 * Next to rivers, rails, toll roads and ports the routed length is not a smooth function of the ring: a waypoint that lands across
 * a barrier turns a 1.5 km loop into 9 km (measured around Perak, Surabaya). So a shape is rescaled by bracketing the target
 * between two measured lengths, abandoned when rescaling does not bring it near, and the ratio of length over ring that the next
 * batch starts from is learned only from loops that came out near the target. The batch spends a request budget, not a fixed number
 * of shapes, and the closest loop it saw goes with the failure so the person can still look at it.
 */
import type { LatLon } from '@/features/routes/map/geometry';
import { isAborted, RequestError } from '@/features/routes/map/http';
import type { ViaRoute } from '@/features/routes/map/routingClient';
import { haversineM } from '@/features/routes/routeModel';

import { destination, pathLengthM, removeSpurs, seededRandom } from './geo';
import { scoreLoop, type PaintedIndex } from './painted';

/** A loop within this share of the target length is "on target". */
export const TOLERANCE = 0.05;
/** When no loop reaches the tolerance, one within this share is still offered (after those that did). */
export const FALLBACK_TOLERANCE = 0.1;
/** A waypoint that has to move further than this to reach a road makes the loop's shape unreliable. */
export const MAX_SNAP_M = 150;
/** A start that is further than this from any road cannot be routed from. */
export const MAX_START_SNAP_M = 300;
/** Routing requests spent on one loop while rescaling it. */
export const MAX_ATTEMPTS = 3;
/** Loops wanted per batch, and how many are enough once every direction has been tried once. */
export const DEFAULT_COUNT = 4;
export const MIN_WANTED = 2;
/** Routing requests one batch may spend (at 1.1 s each, about 26 s) before it gives up on finding `MIN_WANTED` loops. */
export const MAX_REQUESTS = 24;
/** First guess of routed length over ring circumference, before the first measurement. */
export const INITIAL_RATIO = 1.25;
/** Routed length over ring circumference outside this is the barrier effect, not a ratio to start the next loop from. */
export const RATIO_RANGE = [1, 2.5] as const;
/** A rescaled loop still this far (share of the target) from the target will not get there with one more rescale: another shape. */
export const HOPELESS_ERROR = 0.5;
/** Smallest ring worth routing: waypoints closer than this snap onto the same streets. */
export const MIN_RING_M = 400;
/** The closest loop is offered as a fallback only when it is within this share of the target. */
export const OFFER_TOLERANCE = 0.5;

/** Routes through the waypoints in order. Rejects with a `RequestError`; an abort has kind `aborted`. */
export type LoopRouter = (waypoints: readonly LatLon[], signal?: AbortSignal) => Promise<ViaRoute>;

export interface LoopCandidate {
  /** Unique within a session: the seed that made it. */
  id: string;
  /** The closed line, from the start back to the start. */
  line: readonly LatLon[];
  lengthM: number;
  /** Share of the length, 0 to 1, on streets not painted yet; null without history. */
  newShare: number | null;
  /** Share of the length that retraces the loop's own streets, 0 to 1. */
  repeatShare: number;
  /** Routed length over the target, minus 1. */
  lengthError: number;
}

export type LoopFailure =
  /** The start is not near any street or path the service can route on. */
  | 'no_road'
  /** The service answered every try, but no loop came out near the target length (barriers, dead ends); see `closest`. */
  | 'no_loop'
  /** Half or more of the requests failed with a server error, a rate limit or a timeout: the service is busy, not the map. */
  | 'busy'
  /** The requests did not reach the service (offline); `cause` has the last error. */
  | 'network';

export class LoopError extends Error {
  readonly kind: LoopFailure;
  readonly cause?: unknown;
  /** The loop nearest to the target length that was routed, when it is within `OFFER_TOLERANCE`; null otherwise. */
  readonly closest: LoopCandidate | null;

  constructor(kind: LoopFailure, cause?: unknown, closest: LoopCandidate | null = null) {
    super(`loop generation failed: ${kind}`);
    this.name = 'LoopError';
    this.kind = kind;
    this.cause = cause;
    this.closest = closest;
  }
}

interface Shape {
  /** Compass bearing from the start to the centre of the ring. */
  bearing: number;
  /** Waypoints on the ring besides the start. */
  waypoints: number;
  /** +1 walks the ring clockwise, -1 counter-clockwise. */
  turn: 1 | -1;
  /** Per waypoint: radius factor around 1 and angle offset in degrees. */
  radial: readonly number[];
  angular: readonly number[];
}

/** The shape a seed gives, with the ring's centre `bearing` degrees from the start. Same seed, same shape. */
export function shapeFor(seed: number, bearing: number): Shape {
  const random = seededRandom(seed);
  const waypoints = random() < 0.5 ? 3 : 4;
  const turn = random() < 0.5 ? 1 : -1;
  const radial: number[] = [];
  const angular: number[] = [];
  for (let i = 0; i < waypoints; i++) {
    radial.push(1 + (random() - 0.5) * 0.3);
    angular.push((random() - 0.5) * 20);
  }
  return { bearing, waypoints, turn, radial, angular };
}

/** `[start, w1 .. wn, start]` for a ring of `circumferenceM` that passes through `start`. */
export function ringWaypoints(start: LatLon, circumferenceM: number, shape: Shape): LatLon[] {
  const radius = circumferenceM / (2 * Math.PI);
  const center = destination(start, shape.bearing, radius);
  const startAngle = shape.bearing + 180;
  const between = 360 / (shape.waypoints + 1);
  const points: LatLon[] = [start];
  for (let i = 0; i < shape.waypoints; i++) {
    const angle = startAngle + shape.turn * ((i + 1) * between + shape.angular[i]);
    points.push(destination(center, angle, radius * shape.radial[i]));
  }
  points.push(start);
  return points;
}

/** The routed line with the exact start point at both ends, so the loop is closed on the marker and not on the road beside it. */
function closeLoop(line: readonly LatLon[], start: LatLon): LatLon[] {
  const out = [...line];
  if (haversineM(start, out[0]) > 0.5) out.unshift(start);
  if (haversineM(start, out[out.length - 1]) > 0.5) out.push(start);
  return out;
}

interface Attempt {
  line: LatLon[];
  lengthM: number;
  /** The ring circumference this was routed from. */
  circumferenceM: number;
}

export interface GenerateOptions {
  start: LatLon;
  targetM: number;
  router: LoopRouter;
  /** The person's painted streets near the start; null when they have no tracks here. */
  painted: PaintedIndex | null;
  /** Makes the batch reproducible; every batch of a session uses a new one. */
  seed: number;
  count?: number;
  /** Routed length over ring circumference seen so far (the previous batch's answer); `INITIAL_RATIO` when unknown. */
  ratio?: number;
  signal?: AbortSignal;
  /** Called before each loop is tried, `index` counting from 1. */
  onProgress?: (index: number, count: number) => void;
}

export interface GenerateResult {
  /** Best first: on-target loops by novelty, then the near misses. */
  candidates: LoopCandidate[];
  /** Pass to the next batch: how long a routed loop is compared with its ring. */
  ratio: number;
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/** Higher is better. Novelty leads, the loop's own repeats cost double, and a loop nearer the target length wins a tie. */
export function candidateScore(c: Pick<LoopCandidate, 'newShare' | 'repeatShare' | 'lengthError'>): number {
  return (c.newShare ?? 0.5) - 2 * c.repeatShare - 0.5 * Math.abs(c.lengthError);
}

/** On-target loops first, each group best score first. */
export function rankCandidates(candidates: readonly LoopCandidate[]): LoopCandidate[] {
  const onTarget = (c: LoopCandidate) => Math.abs(c.lengthError) <= TOLERANCE;
  return [...candidates].sort((a, b) => {
    const group = Number(onTarget(b)) - Number(onTarget(a));
    return group !== 0 ? group : candidateScore(b) - candidateScore(a);
  });
}

/** One routed ring: how long the loop came out for the circumference asked. */
export interface Probe {
  circumferenceM: number;
  lengthM: number;
}

/**
 * The ring size to route next so that the loop lands on `targetM`, from what this shape has measured so far (newest last); null when
 * another request would teach nothing (the length jumps over the target between two rings 3% apart, or the ring cannot get smaller).
 * Once a length below and one above the target are known the next ring is interpolated between them, so a length that is not
 * proportional to the ring (it never is next to barriers) still closes in; with one side known it is a secant step, and with one
 * probe a proportional one.
 */
export function nextCircumference(probes: readonly Probe[], targetM: number): number | null {
  const last = probes[probes.length - 1];
  let below: Probe | null = null;
  let above: Probe | null = null;
  for (const probe of probes) {
    if (probe.lengthM < targetM) {
      if (below === null || probe.lengthM > below.lengthM) below = probe;
    } else if (above === null || probe.lengthM < above.lengthM) {
      above = probe;
    }
  }
  const lo = last.circumferenceM * 0.5;
  const hi = last.circumferenceM * 2;
  let next = clamp(last.circumferenceM * (targetM / last.lengthM), lo, hi);
  if (below !== null && above !== null && above.circumferenceM > below.circumferenceM) {
    if (above.circumferenceM / below.circumferenceM < 1.03) return null;
    const share = (targetM - below.lengthM) / (above.lengthM - below.lengthM);
    next = below.circumferenceM + clamp(share, 0.15, 0.85) * (above.circumferenceM - below.circumferenceM);
  } else if (probes.length >= 2) {
    const before = probes[probes.length - 2];
    const slope = (last.lengthM - before.lengthM) / (last.circumferenceM - before.circumferenceM);
    if (Number.isFinite(slope) && slope > 0) next = clamp(last.circumferenceM + (targetM - last.lengthM) / slope, lo, hi);
  }
  next = Math.max(MIN_RING_M, next);
  return Math.abs(next / last.circumferenceM - 1) < 0.01 ? null : next;
}

/** What a batch has seen so far, besides the loops it kept. */
interface Tally {
  /** How far the first request had to move the start to reach a road. */
  startSnap: number | null;
  requests: number;
  /** Requests that failed on the service side or on the way to it (server error, rate limit, timeout, offline). */
  serviceFailures: number;
  lastServiceError: unknown;
  lastError: unknown;
  /** The routed loop nearest the target length, kept or not. */
  closest: { attempt: Attempt; seed: number } | null;
}

const isServiceFailure = (error: unknown) => error instanceof RequestError && (error.kind === 'http' || error.kind === 'timeout' || error.kind === 'network');

/**
 * One loop: route the ring, rescale it by what came out (`nextCircumference`), route again, up to `MAX_ATTEMPTS` times. The shape is
 * dropped early when a rescaled ring is still far off the target. A failed request ends the loop with the best answer so far.
 */
async function tryOne(options: GenerateOptions, shape: Shape, startCircumference: number, tally: Tally): Promise<Attempt | null> {
  const { start, targetM, router, signal } = options;
  const probes: Probe[] = [];
  let circumference = startCircumference;
  let best: Attempt | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && tally.requests < MAX_REQUESTS; attempt++) {
    tally.requests++;
    let routed: ViaRoute;
    try {
      routed = await router(ringWaypoints(start, circumference, shape), signal);
    } catch (error) {
      if (isAborted(error) || signal?.aborted) throw error;
      tally.lastError = error;
      if (isServiceFailure(error)) {
        tally.serviceFailures++;
        tally.lastServiceError = error;
      }
      return best;
    }
    // The length that counts is the one of the loop as it is drawn: without the stubs a waypoint on a dead-end street makes.
    const line = removeSpurs(routed.line);
    const lengthM = pathLengthM(line);
    if (tally.startSnap === null && routed.snapM.length > 0) tally.startSnap = routed.snapM[0];
    // The start routed to itself: the ring could not be walked at all.
    if (lengthM < 1) return best;
    // A waypoint that had to move far to reach a road: the shape of the loop is not the shape asked for.
    if (routed.snapM.some((d) => d > MAX_SNAP_M)) return best;
    probes.push({ circumferenceM: circumference, lengthM });
    const current: Attempt = { line: closeLoop(line, start), lengthM, circumferenceM: circumference };
    if (best === null || Math.abs(lengthM - targetM) < Math.abs(best.lengthM - targetM)) best = current;
    const error = Math.abs(lengthM - targetM) / targetM;
    if (error <= TOLERANCE) return best;
    if (attempt >= 1 && error > HOPELESS_ERROR) return best;
    const next = nextCircumference(probes, targetM);
    if (next === null) return best;
    circumference = next;
  }
  return best;
}

/**
 * A batch of different loops of about `targetM`, ranked. Loops that cannot be routed are skipped; shapes keep being tried (up to
 * `MAX_REQUESTS` requests) until `DEFAULT_COUNT` loops are in, or `MIN_WANTED` once every direction has had its turn. It throws a
 * `LoopError` when none is left: `no_road` when the start has no street, `busy` or `network` when the requests themselves failed,
 * `no_loop` otherwise, with the nearest loop it did see in `closest`. An abort is rethrown.
 */
export async function generateLoops(options: GenerateOptions): Promise<GenerateResult> {
  const { targetM, painted, seed, signal, onProgress } = options;
  const count = options.count ?? DEFAULT_COUNT;
  const random = seededRandom(seed);
  const baseBearing = random() * 360;
  const ratio = { value: clamp(options.ratio ?? INITIAL_RATIO, RATIO_RANGE[0], RATIO_RANGE[1]) };
  const tally: Tally = { startSnap: null, requests: 0, serviceFailures: 0, lastServiceError: undefined, lastError: undefined, closest: null };
  const noRoad = () => tally.startSnap !== null && tally.startSnap > MAX_START_SNAP_M;

  const found: LoopCandidate[] = [];
  const candidateOf = (attempt: Attempt, candidateSeed: number): LoopCandidate => {
    const score = scoreLoop(attempt.line, painted);
    return {
      id: String(candidateSeed),
      line: attempt.line,
      lengthM: attempt.lengthM,
      newShare: score.newShare,
      repeatShare: score.repeatShare,
      lengthError: attempt.lengthM / targetM - 1,
    };
  };

  for (let i = 0; i < count * 8 && tally.requests < MAX_REQUESTS && found.length < (i < count ? count : MIN_WANTED); i++) {
    onProgress?.(Math.min(found.length + 1, count), count);
    // Spread the ring centres around the compass so the loops differ in direction, not just in detail; later rounds fill the gaps.
    const slot = i < count ? i : i - count + 0.5;
    const bearing = (baseBearing + (slot * 360) / count + (random() - 0.5) * 40 + 360) % 360;
    const candidateSeed = (seed + i * 7919) >>> 0;
    const attempt = await tryOne(options, shapeFor(candidateSeed, bearing), Math.max(MIN_RING_M, targetM / ratio.value), tally);
    if (noRoad()) break;
    if (attempt === null) continue;
    const lengthError = attempt.lengthM / targetM - 1;
    if (tally.closest === null || Math.abs(lengthError) < Math.abs(tally.closest.attempt.lengthM / targetM - 1)) {
      tally.closest = { attempt, seed: candidateSeed };
    }
    if (Math.abs(lengthError) > FALLBACK_TOLERANCE) continue;
    found.push(candidateOf(attempt, candidateSeed));
    // Only a loop that came out near the target says how long a loop is compared with its ring here.
    ratio.value = clamp(attempt.lengthM / attempt.circumferenceM, RATIO_RANGE[0], RATIO_RANGE[1]);
  }

  if (found.length === 0) {
    if (noRoad()) throw new LoopError('no_road');
    if (tally.requests > 0 && tally.serviceFailures * 2 >= tally.requests) {
      const kind = tally.lastServiceError instanceof RequestError && tally.lastServiceError.kind === 'network' ? 'network' : 'busy';
      throw new LoopError(kind, tally.lastServiceError);
    }
    const near = tally.closest;
    const closest = near !== null && Math.abs(near.attempt.lengthM / targetM - 1) <= OFFER_TOLERANCE ? candidateOf(near.attempt, near.seed) : null;
    throw new LoopError('no_loop', tally.lastError, closest);
  }
  return { candidates: rankCandidates(found), ratio: ratio.value };
}

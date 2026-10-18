import { haversineM, type RoutePoint } from '@/features/routes/routeModel';

import type { NavSnapshot, RouteClimb, TurnCue } from '../types';
import { climbAhead, routeClimbs } from './climbsAhead';
import { generateCues } from './cues';
import { buildRouteIndex, DEFAULT_AHEAD_M, project, type RouteIndex } from './routeIndex';

export interface FollowerConfig {
  /** Distance from the route that counts as off course, metres. */
  offCourseM?: number;
  /** How long the distance must stay above the threshold before the rider is off course, ms. */
  offCourseDwellMs?: number;
  /** Off course clears when the distance falls below `offCourseM * clearRatio`. */
  clearRatio?: number;
}

export interface FollowerFix {
  ts: number;
  lat: number;
  lon: number;
  speedMps: number | null;
  accuracy: number | null;
}

/** Fixes less accurate than this are not matched (the recorder's limit), metres. */
export const MAX_MATCH_ACCURACY_M = 35;
/** Speed is averaged over this long, ms of fix time. */
export const SPEED_WINDOW_MS = 30_000;
/** Under this average speed there is no ETA, m/s. */
export const MIN_ETA_SPEED_MPS = 1;
/** A cue this close to the finish line counts as reached, metres. */
const REACHED_M = 1;

interface SpeedSample {
  ts: number;
  mps: number;
}

export class RouteFollower {
  readonly routeId: string;
  readonly routeLengthM: number;
  private readonly index: RouteIndex;
  private readonly cues: readonly TurnCue[];
  private readonly climbs: readonly RouteClimb[];
  private offCourseM: number;
  private readonly dwellMs: number;
  private readonly clearRatio: number;

  private doneM = 0;
  private matched = false;
  private lastOffM: number | null = null;
  private offSinceMs: number | null = null;
  private offCourse = false;
  private samples: SpeedSample[] = [];
  private prevFix: FollowerFix | null = null;
  private last: NavSnapshot | null = null;

  constructor(routeId: string, points: readonly RoutePoint[], cfg: FollowerConfig = {}) {
    this.routeId = routeId;
    this.index = buildRouteIndex(points);
    this.routeLengthM = this.index.totalM;
    this.cues = generateCues(points);
    this.climbs = routeClimbs(points);
    this.offCourseM = cfg.offCourseM ?? 50;
    this.dwellMs = cfg.offCourseDwellMs ?? 10_000;
    this.clearRatio = cfg.clearRatio ?? 0.6;
  }

  setOffCourseThreshold(m: number): void {
    this.offCourseM = m;
  }

  snapshot(): NavSnapshot | null {
    return this.last;
  }

  update(fix: FollowerFix, nowMs: number): NavSnapshot {
    const usable = fix.accuracy === null || fix.accuracy <= MAX_MATCH_ACCURACY_M;
    if (usable) this.match(fix, nowMs);
    this.ageOffCourse(nowMs);
    this.last = this.build();
    return this.last;
  }

  private match(fix: FollowerFix, nowMs: number): void {
    const hint = this.matched ? { atM: this.doneM, windowM: DEFAULT_AHEAD_M } : undefined;
    const proj = project(this.index, fix.lat, fix.lon, hint);
    this.lastOffM = proj.offM;
    this.trackSpeed(fix);
    if (proj.offM > this.offCourseM) {
      if (this.offSinceMs === null) this.offSinceMs = nowMs;
    } else this.offSinceMs = null;
    // Progress moves only on the route; the off course state clears at a tighter distance than it is set.
    const limit = this.offCourse ? this.offCourseM * this.clearRatio : this.offCourseM;
    if (proj.offM <= limit) {
      this.doneM = proj.atM;
      this.matched = true;
      if (this.offCourse) this.offCourse = false;
    }
  }

  private ageOffCourse(nowMs: number): void {
    if (!this.offCourse && this.offSinceMs !== null && nowMs - this.offSinceMs >= this.dwellMs) this.offCourse = true;
  }

  private trackSpeed(fix: FollowerFix): void {
    let mps = fix.speedMps;
    if (mps === null || !Number.isFinite(mps)) {
      const prev = this.prevFix;
      const dt = prev ? (fix.ts - prev.ts) / 1000 : 0;
      mps = prev && dt > 0 ? haversineM(prev, fix) / dt : null;
    }
    this.prevFix = fix;
    if (mps !== null) this.samples.push({ ts: fix.ts, mps: Math.max(0, mps) });
    const cutoff = fix.ts - SPEED_WINDOW_MS;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop]!.ts < cutoff) drop++;
    if (drop > 0) this.samples = this.samples.slice(drop);
  }

  private averageSpeed(): number | null {
    if (this.samples.length === 0) return null;
    let sum = 0;
    for (const s of this.samples) sum += s.mps;
    return sum / this.samples.length;
  }

  private build(): NavSnapshot {
    const toFinish = Math.max(0, this.routeLengthM - this.doneM);
    const speed = this.averageSpeed();
    const etaSec = speed !== null && speed >= MIN_ETA_SPEED_MPS ? toFinish / speed : null;
    let nextCue: NavSnapshot['nextCue'] = null;
    if (!this.offCourse) {
      const cue = this.cues.find((c) => c.atM > this.doneM + REACHED_M);
      if (cue) nextCue = { cue, distanceM: cue.atM - this.doneM };
    }
    return {
      routeId: this.routeId,
      distanceDoneM: this.doneM,
      distanceToFinishM: toFinish,
      etaSec,
      offCourse: this.offCourse,
      offCourseM: this.lastOffM,
      nextCue,
      climb: climbAhead(this.climbs, this.doneM),
    };
  }
}

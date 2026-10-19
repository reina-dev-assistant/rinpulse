import type { RouteDef } from "./routes.ts";

/** Metres between track samples. */
export const STEP = 4;
/** Road continues this far behind the start line and past the finish so the camera never runs off the ribbon. */
export const PRE_M = 80;
export const POST_M = 320;
export const ROAD_HALF = 4;

/** Height of the cambered road surface above the track line at [lat] metres from the centre (8 cm crown, 2 cm at the edges). */
export function roadCrown(lat: number): number {
  return 0.08 - 0.015 * Math.min(ROAD_HALF, Math.abs(lat));
}

type Points = readonly (readonly [number, number])[];

/** Monotone cubic (Fritsch-Carlson) through [x, y] control points: smooth, no overshoot, clamped outside. */
export function pchip(points: Points): (x: number) => number {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!));
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0]!;
  m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const h = Math.hypot(a, b);
    if (h > 3) {
      m[i] = (3 * a * d[i]!) / h;
      m[i + 1] = (3 * b * d[i]!) / h;
    }
  }
  return (x) => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid]! <= x) lo = mid;
      else hi = mid;
    }
    const h = xs[hi]! - xs[lo]!;
    const t = (x - xs[lo]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[lo]! +
      (t3 - 2 * t2 + t) * h * m[lo]! +
      (-2 * t3 + 3 * t2) * ys[hi]! +
      (t3 - t2) * h * m[hi]!
    );
  };
}

export interface TrackPoint {
  x: number;
  y: number;
  z: number;
  /** Unit forward direction in the XZ plane. */
  tx: number;
  tz: number;
  /** Heading as a three.js Y rotation (forward = -Z at 0). */
  yaw: number;
  /** Road gradient in percent. */
  grade: number;
}

/** A route sampled every STEP metres from -PRE_M to length + POST_M. */
export class Track {
  readonly lengthM: number;
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly yaw: Float32Array;
  readonly grade: Float32Array;

  constructor(route: RouteDef) {
    this.lengthM = route.lengthM;
    const elevation = pchip(route.elevation);
    const heading = pchip(route.heading);
    const count = Math.ceil((route.lengthM + PRE_M + POST_M) / STEP) + 1;
    this.count = count;
    this.x = new Float32Array(count);
    this.y = new Float32Array(count);
    this.z = new Float32Array(count);
    this.yaw = new Float32Array(count);
    this.grade = new Float32Array(count);

    let x = 0;
    let z = 0;
    let prevYaw = 0;
    for (let i = 0; i < count; i++) {
      const s = i * STEP - PRE_M;
      const yaw = -(heading(s) * Math.PI) / 180;
      if (i > 0) {
        const mid = (yaw + prevYaw) / 2;
        x += -Math.sin(mid) * STEP;
        z += -Math.cos(mid) * STEP;
      }
      prevYaw = yaw;
      this.x[i] = x;
      this.z[i] = z;
      this.yaw[i] = yaw;
      this.y[i] = elevation(s);
    }
    for (let i = 0; i < count; i++) {
      const a = Math.max(0, i - 2);
      const b = Math.min(count - 1, i + 2);
      this.grade[i] = ((this.y[b]! - this.y[a]!) / ((b - a) * STEP)) * 100;
    }
  }

  /** Index as a float for distance [s]; clamped to the sampled range. */
  private index(s: number): number {
    return Math.min(this.count - 1, Math.max(0, (s + PRE_M) / STEP));
  }

  at(s: number, out: TrackPoint): TrackPoint {
    const f = this.index(s);
    const i = Math.min(this.count - 2, Math.floor(f));
    const t = f - i;
    out.x = this.x[i]! + (this.x[i + 1]! - this.x[i]!) * t;
    out.y = this.y[i]! + (this.y[i + 1]! - this.y[i]!) * t;
    out.z = this.z[i]! + (this.z[i + 1]! - this.z[i]!) * t;
    out.grade = this.grade[i]! + (this.grade[i + 1]! - this.grade[i]!) * t;
    out.yaw = this.yaw[i]! + (this.yaw[i + 1]! - this.yaw[i]!) * t;
    out.tx = -Math.sin(out.yaw);
    out.tz = -Math.cos(out.yaw);
    return out;
  }

  elevationAt(s: number): number {
    const f = this.index(s);
    const i = Math.min(this.count - 2, Math.floor(f));
    return this.y[i]! + (this.y[i + 1]! - this.y[i]!) * (f - i);
  }

  gradeAt(s: number): number {
    const f = this.index(s);
    const i = Math.min(this.count - 2, Math.floor(f));
    return this.grade[i]! + (this.grade[i + 1]! - this.grade[i]!) * (f - i);
  }
}

export function makeTrackPoint(): TrackPoint {
  return { x: 0, y: 0, z: 0, tx: 0, tz: -1, yaw: 0, grade: 0 };
}

/** Elevation profile for the mini-map and route cards: [distance, elevation] every [stepM]. */
export function profileOf(route: RouteDef, stepM: number): { d: number; e: number }[] {
  const elevation = pchip(route.elevation);
  const out: { d: number; e: number }[] = [];
  for (let d = 0; d <= route.lengthM; d += stepM) out.push({ d, e: elevation(d) });
  out.push({ d: route.lengthM, e: elevation(route.lengthM) });
  return out;
}

export interface RouteStats {
  /** Total climbing in metres. */
  gainM: number;
  maxGrade: number;
  minElevM: number;
  maxElevM: number;
}

export function routeStats(route: RouteDef): RouteStats {
  const elevation = pchip(route.elevation);
  let gainM = 0;
  let maxGrade = 0;
  let min = Infinity;
  let max = -Infinity;
  let prev = elevation(0);
  for (let d = 0; d <= route.lengthM; d += 20) {
    const e = elevation(d);
    if (e > prev) gainM += e - prev;
    maxGrade = Math.max(maxGrade, (Math.abs(elevation(d + 20) - e) / 20) * 100);
    min = Math.min(min, e);
    max = Math.max(max, e);
    prev = e;
  }
  return { gainM, maxGrade, minElevM: min, maxElevM: max };
}

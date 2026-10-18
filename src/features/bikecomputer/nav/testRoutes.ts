import type { RoutePoint } from '@/features/routes/routeModel';

/** Test fixtures: routes laid out in metres east/north of a fixed origin. */
const LAT0 = -6.2;
const LON0 = 106.8;
const M_PER_DEG = 111_194.93;
const COS = Math.cos((LAT0 * Math.PI) / 180);

export function at(x: number, y: number, alt: number | null = null): RoutePoint {
  return { lat: LAT0 + y / M_PER_DEG, lon: LON0 + x / (M_PER_DEG * COS), alt };
}

/** The corners joined by straight lines, with a point every `stepM` metres. */
export function polyline(corners: readonly [number, number][], stepM = 10): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (let i = 0; i + 1 < corners.length; i++) {
    const [x0, y0] = corners[i]!;
    const [x1, y1] = corners[i + 1]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.round(len / stepM));
    for (let k = 0; k < steps; k++) out.push(at(x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps));
  }
  const lastCorner = corners[corners.length - 1];
  if (lastCorner) out.push(at(lastCorner[0], lastCorner[1]));
  return out;
}

/** Deterministic noise in [-1, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 2 ** 32) * 2 - 1;
  };
}

/** A route along x with an altitude profile: `legs` of [lengthM, gradePct]. */
export function profileRoute(legs: readonly [number, number][], startAlt = 100, stepM = 10): RoutePoint[] {
  const out: RoutePoint[] = [at(0, 0, startAlt)];
  let x = 0;
  let alt = startAlt;
  for (const [len, grade] of legs) {
    const steps = Math.round(len / stepM);
    for (let k = 0; k < steps; k++) {
      x += stepM;
      alt += (stepM * grade) / 100;
      out.push(at(x, 0, alt));
    }
  }
  return out;
}

/** Deterministic routes for fixtures: a seeded generator and the two shapes (loop, out-and-back). */

/** mulberry32: a tiny seeded generator so the fixtures never change between runs. */
export function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A loop of `laps` rounds with a wobble, around (-6.2, 106.8) (Jakarta), as `[lat, lng]` pairs about every 8 m.
 * `radiusM` is the rough size of the loop. Long enough for the 200 m privacy trim to leave a route.
 */
export function loopRoute(points: number, radiusM: number, seed = 7): [number, number][] {
  const rand = seeded(seed);
  const out: [number, number][] = [];
  const lat0 = -6.2;
  const lng0 = 106.8;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  for (let i = 0; i < points; i++) {
    const a = (i / (points - 1)) * Math.PI * 2;
    // Egg-shaped loop with two low harmonics, so it is not a circle; noise stays under 4 m.
    const r = radiusM * (1 + 0.28 * Math.sin(2 * a + 0.6) + 0.12 * Math.cos(3 * a)) + (rand() - 0.5) * 6;
    const x = r * Math.cos(a) * 1.25;
    const y = r * Math.sin(a) * 0.85;
    out.push([Math.round((lat0 + y / mPerDegLat) * 1e6) / 1e6, Math.round((lng0 + x / mPerDegLng) * 1e6) / 1e6]);
  }
  return out;
}

/** An out-and-back of `points` points heading north-east: the shape of a lot of walks. */
export function lineRoute(points: number, lengthM: number): [number, number][] {
  const out: [number, number][] = [];
  const mPerDeg = 111_320;
  for (let i = 0; i < points; i++) {
    const f = i / (points - 1);
    const along = f < 0.5 ? f * 2 : (1 - f) * 2;
    const d = along * (lengthM / 2);
    out.push([Math.round((-6.9 + (d * 0.6) / mPerDeg + 0.00004 * Math.sin(f * 40)) * 1e6) / 1e6, Math.round((107.6 + (d * 0.8) / mPerDeg) * 1e6) / 1e6]);
  }
  return out;
}

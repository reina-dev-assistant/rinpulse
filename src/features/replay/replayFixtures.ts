import type { ReplayKind, ReplayTrack } from './track';

/** Synthetic workouts for the replay tests. Not used by the app. */
const M_PER_DEG = (6_371_000 * Math.PI) / 180;

export interface SyntheticOptions {
  kind?: ReplayKind;
  /** Samples on the grid. */
  n?: number;
  stepSec?: number;
  /** Ground speed, m/s. */
  speed?: number;
  lat?: number;
  lon?: number;
  withHr?: boolean;
  withAlt?: boolean;
}

/**
 * A winding out-and-back ride near Bali: steady speed with a sprint at 30 % and a stop at 60 %, a hill climbing to a summit at
 * 45 %, a heart rate that peaks at 70 %.
 */
export function syntheticTrack(o: SyntheticOptions = {}): ReplayTrack {
  const n = o.n ?? 400;
  const stepSec = o.stepSec ?? 15;
  const base = o.speed ?? 6;
  const lat: number[] = [];
  const lon: number[] = [];
  const dist: number[] = [];
  const speed: number[] = [];
  const alt: (number | null)[] = [];
  const hr: (number | null)[] = [];
  let x = 0;
  let y = 0;
  let heading = 0.6;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const v = i === 0 ? 0 : f > 0.6 && f < 0.62 ? 0 : f > 0.28 && f < 0.32 ? base * 2.2 : base * (0.85 + 0.3 * Math.sin(i / 9));
    heading += 0.045 * Math.sin(i / 17) + (f > 0.5 ? 0.012 : 0);
    x += Math.cos(heading) * v * stepSec;
    y += Math.sin(heading) * v * stepSec;
    total += v * stepSec;
    lat.push((o.lat ?? -8.5) + y / M_PER_DEG);
    lon.push((o.lon ?? 115.2) + x / (M_PER_DEG * Math.cos(((o.lat ?? -8.5) * Math.PI) / 180)));
    dist.push(total);
    speed.push(v);
    alt.push(o.withAlt === false ? null : 80 + 640 * Math.exp(-(((f - 0.45) / 0.18) ** 2)) + 12 * Math.sin(i / 6));
    hr.push(o.withHr === false ? null : Math.round(118 + 30 * f + 38 * Math.exp(-(((f - 0.7) / 0.05) ** 2))));
  }
  const gain = alt.reduce<number>((g, v, i) => (i > 0 && v !== null && alt[i - 1] !== null && v > (alt[i - 1] as number) ? g + (v - (alt[i - 1] as number)) : g), 0);
  return {
    kind: o.kind ?? 'ride',
    startedAt: Date.UTC(2026, 9, 14, 3, 0),
    stepSec,
    n,
    lat,
    lon,
    dist,
    alt,
    hr,
    speed,
    power: new Array<number | null>(n).fill(null),
    totals: { distanceM: total, elapsedSec: (n - 1) * stepSec, movingSec: (n - 1) * stepSec - 120, gainM: o.withAlt === false ? null : Math.round(gain) },
    maxHr: o.withHr === false ? null : Math.max(...(hr as number[])),
    maxSpeedMs: base * 2.2,
    bestEfforts: [],
    climbs: [],
  };
}

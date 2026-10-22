import { hrZonesForMax } from '@/features/hrzones/zones';

import type { RideInput } from './analyzeRide';
import type { RidePointInput } from './series';
import type { RideProfile } from './types';

/** Synthetic rides for the cycling tests. Not used by the app. */
export const T0 = 1_760_000_000;
/** Metres per degree of latitude on the sphere `haversineM` uses, so a northward leg measures exactly what it was built as. */
const M_PER_DEG = (6_371_000 * Math.PI) / 180;

export const PROFILE: RideProfile = { weightKg: 75, age: 35, sex: 'male', zones: hrZonesForMax(185), ftp: 250 };

export interface SyntheticRide {
  /** Seconds the recording runs. */
  secs: number;
  /** Metres per second at second t (0 = stopped). */
  speed?: (t: number) => number;
  power?: (t: number) => number | null;
  hr?: (t: number) => number | null;
  cadence?: (t: number) => number | null;
  alt?: (t: number) => number | null;
  /** Report the wheel speed in `speed` on every point (a speed sensor or a bike computer). */
  speedChannel?: boolean;
  /** Draw a GPS track going north at `speed`. */
  gps?: boolean;
  /** Seconds without any sample (a pause of the recorder): [from, to). */
  gaps?: readonly [number, number][];
}

/** One point per second from `T0`. With `gps` the path integrates `speed`; fixes are written while stopped too. */
export function syntheticPoints(opts: SyntheticRide): RidePointInput[] {
  const points: RidePointInput[] = [];
  let metres = 0;
  for (let t = 0; t <= opts.secs; t++) {
    const v = opts.speed?.(t) ?? 0;
    if (t > 0) metres += v;
    if (opts.gaps?.some(([from, to]) => t >= from && t < to)) continue;
    points.push({
      ts: T0 + t,
      lat: opts.gps ? 10 + metres / M_PER_DEG : null,
      lon: opts.gps ? 100 : null,
      alt: opts.alt?.(t) ?? null,
      hr: opts.hr?.(t) ?? null,
      speed: opts.speedChannel ? v : null,
      cadence: opts.cadence?.(t) ?? null,
      power: opts.power?.(t) ?? null,
    });
  }
  return points;
}

export function rideInput(opts: SyntheticRide, over: { profile?: Partial<RideProfile>; workout?: Partial<RideInput['workout']>; summary?: RideInput['summary'] } = {}): RideInput {
  const points = syntheticPoints(opts);
  let metres = 0;
  for (let t = 1; t <= opts.secs; t++) metres += opts.speed?.(t) ?? 0;
  return {
    workout: {
      start: T0,
      end: T0 + opts.secs,
      duration: opts.secs,
      distance: Math.round(metres),
      calories: 0,
      sportType: opts.gps ? 3 : 7,
      sportName: opts.gps ? 'Cycling' : 'Indoor cycling',
      ...over.workout,
    },
    summary: over.summary ?? {},
    points,
    profile: { ...PROFILE, ...over.profile },
  };
}

/** The textbook formula, written the plain way and independently of `power.ts`: for a series of whole seconds, 30 s rolling means. */
export function referenceNormalizedPower(watts: readonly number[]): number {
  const means: number[] = [];
  for (let i = 29; i < watts.length; i++) {
    let sum = 0;
    for (let j = i - 29; j <= i; j++) sum += watts[j]!;
    means.push(sum / 30);
  }
  const fourth = means.reduce((a, m) => a + m ** 4, 0) / means.length;
  return fourth ** 0.25;
}

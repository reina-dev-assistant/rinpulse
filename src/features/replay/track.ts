/**
 * What the replay animates: one workout as aligned per-sample arrays on the analysis grid (sample `i` is `i * stepSec`
 * seconds after the start), with the GPS gaps filled so every sample has a position. Built from the same
 * `WorkoutAnalysis` the detail screen, the stickers and the share-to-JoyoRogo post use, so the numbers agree everywhere.
 * Pure: no React Native imports.
 */
import type { AnalysisBestEffort, SportKind, WorkoutAnalysis } from '@/features/workouts/analysis/types';

export type ReplayKind = SportKind;

export interface ReplayClimb {
  startM: number;
  endM: number;
  gainM: number;
  lengthM: number;
}

export interface ReplayTrack {
  kind: ReplayKind;
  /** Epoch ms of the start. */
  startedAt: number;
  stepSec: number;
  n: number;
  lat: number[];
  lon: number[];
  /** Cumulative odometer distance in metres (non-decreasing), the device's own figure. */
  dist: number[];
  alt: (number | null)[];
  hr: (number | null)[];
  /** Metres per second; 0 while stopped. */
  speed: number[];
  power: (number | null)[];
  totals: {
    distanceM: number;
    elapsedSec: number;
    movingSec: number;
    /** Metres climbed, null when the workout has no altitude. */
    gainM: number | null;
  };
  maxHr: number | null;
  maxSpeedMs: number | null;
  bestEfforts: readonly AnalysisBestEffort[];
  climbs: readonly ReplayClimb[];
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Linear fill of the null stretches of a position array; edges take the nearest real value. `null` when nothing is real. */
export function fillGaps(values: readonly (number | null | undefined)[]): number[] | null {
  const out = new Array<number>(values.length);
  let first = -1;
  for (let i = 0; i < values.length; i++) {
    if (num(values[i])) {
      first = i;
      break;
    }
  }
  if (first < 0) return null;
  let prev = first;
  for (let i = 0; i < first; i++) out[i] = values[first] as number;
  for (let i = first; i < values.length; i++) {
    const v = values[i];
    if (num(v)) {
      out[i] = v;
      // Interpolate the gap between the previous real sample and this one.
      if (i - prev > 1) {
        const a = out[prev]!;
        for (let j = prev + 1; j < i; j++) out[j] = a + ((v - a) * (j - prev)) / (i - prev);
      }
      prev = i;
    }
  }
  for (let i = prev + 1; i < values.length; i++) out[i] = out[prev]!;
  return out;
}

function speedOf(pace: number | null | undefined): number {
  return num(pace) && pace > 0 ? 1000 / pace : 0;
}

export interface TrackExtras {
  climbs?: readonly ReplayClimb[];
}

/**
 * `null` when the analysis has no usable GPS track (indoor, manual, a track with a single point): there is nothing to fly
 * over. The caller hides the Replay button in that case.
 */
export function trackFromAnalysis(analysis: WorkoutAnalysis, extras: TrackExtras = {}): ReplayTrack | null {
  const s = analysis.series;
  if (!s || !s.track || s.n < 2) return null;
  const real = s.track.filter((p) => p !== null).length;
  if (real < 2) return null;
  const lat = fillGaps(s.track.map((p) => (p ? p[0] : null)));
  const lon = fillGaps(s.track.map((p) => (p ? p[1] : null)));
  if (!lat || !lon) return null;

  // Distance: the odometer when the series has one, else the length of the track itself.
  let dist: number[];
  if (s.dist && s.dist.length === s.n) {
    dist = s.dist.slice();
  } else {
    dist = [0];
    for (let i = 1; i < s.n; i++) {
      const dy = (lat[i]! - lat[i - 1]!) * 111_195;
      const dx = (lon[i]! - lon[i - 1]!) * 111_195 * Math.cos((lat[i]! * Math.PI) / 180);
      dist.push(dist[i - 1]! + Math.hypot(dx, dy));
    }
  }

  const speed = new Array<number>(s.n).fill(0);
  if (s.pace) for (let i = 0; i < s.n; i++) speed[i] = speedOf(s.pace[i]);
  else
    for (let i = 1; i < s.n; i++) speed[i] = Math.max(0, (dist[i]! - dist[i - 1]!) / s.stepSec);

  const maxHrSeries = s.hr ? Math.max(0, ...s.hr.filter(num)) : 0;
  const maxHr = num(analysis.stats.maxHr) && analysis.stats.maxHr > 0 ? analysis.stats.maxHr : maxHrSeries > 0 ? maxHrSeries : null;
  const maxSpeedSeries = Math.max(0, ...speed);
  const maxSpeedMs = num(analysis.stats.maxSpeedMs) && analysis.stats.maxSpeedMs > 0 ? analysis.stats.maxSpeedMs : maxSpeedSeries > 0 ? maxSpeedSeries : null;

  return {
    kind: analysis.sport.kind,
    startedAt: analysis.startedAt,
    stepSec: s.stepSec,
    n: s.n,
    lat,
    lon,
    dist,
    alt: s.alt ?? new Array<number | null>(s.n).fill(null),
    hr: s.hr ?? new Array<number | null>(s.n).fill(null),
    speed,
    power: s.power ?? new Array<number | null>(s.n).fill(null),
    totals: {
      distanceM: analysis.distanceM ?? dist[dist.length - 1] ?? 0,
      elapsedSec: analysis.elapsedSec,
      movingSec: analysis.movingSec,
      gainM: analysis.elevation ? analysis.elevation.gainM : null,
    },
    maxHr,
    maxSpeedMs,
    bestEfforts: analysis.bestEfforts,
    climbs: extras.climbs ?? [],
  };
}

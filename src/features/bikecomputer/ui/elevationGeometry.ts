/** Geometry of the climb page's elevation strip: route altitude to SVG paths. Pure: no React Native. */

export interface ElevationPoint {
  distM: number;
  altM: number;
}

export interface StripGeometry {
  /** `M x y L x y ...` along the profile. */
  line: string;
  /** The same line closed down to the baseline, for the fill. */
  area: string;
  xOf: (distM: number) => number;
  yOf: (altM: number) => number;
  minAlt: number;
  maxAlt: number;
}

/** A flat road is not drawn as a mountain: the vertical scale spans at least this many metres. */
export const MIN_SPAN_M = 40;
/** The strip is no wider than this many points; more cannot be told apart on a phone. */
export const MAX_POINTS = 240;
/** Fraction of the height kept free above the highest and below the lowest point. */
const MARGIN = 0.1;

/** At most `max` points, always keeping the first and the last. */
export function decimate<T>(points: readonly T[], max: number): T[] {
  if (points.length <= max || max < 2) return points.slice(0, Math.max(max, 0) || points.length);
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    const p = points[Math.round(i * step)];
    if (p !== undefined) out.push(p);
  }
  return out;
}

const fmt = (n: number): string => (Math.round(n * 10) / 10).toString();

/** Paths for `points` in a `width` x `height` box, or null when there is no profile to draw (under two usable points or no distance). */
export function stripGeometry(points: readonly ElevationPoint[], width: number, height: number): StripGeometry | null {
  const usable = points.filter((p) => Number.isFinite(p.distM) && Number.isFinite(p.altM));
  const first = usable[0];
  const last = usable[usable.length - 1];
  if (!first || !last || usable.length < 2 || last.distM <= first.distM || !(width > 0) || !(height > 0)) return null;

  const shown = decimate(usable, MAX_POINTS);
  let minAlt = Infinity;
  let maxAlt = -Infinity;
  for (const p of usable) {
    minAlt = Math.min(minAlt, p.altM);
    maxAlt = Math.max(maxAlt, p.altM);
  }
  const span = Math.max(MIN_SPAN_M, maxAlt - minAlt);
  const mid = (minAlt + maxAlt) / 2;
  const low = mid - span / 2;
  const top = height * MARGIN;
  const drawable = height * (1 - 2 * MARGIN);
  const total = last.distM - first.distM;

  const xOf = (distM: number) => ((distM - first.distM) / total) * width;
  const yOf = (altM: number) => top + drawable - ((altM - low) / span) * drawable;

  const line = shown.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(xOf(p.distM))} ${fmt(yOf(p.altM))}`).join(' ');
  const area = `${line} L${fmt(width)} ${fmt(height)} L0 ${fmt(height)} Z`;
  return { line, area, xOf, yOf, minAlt, maxAlt };
}

/** Interpolated altitude at `distM` along the profile, clamped to its ends; null for an empty profile. */
export function altitudeAt(points: readonly ElevationPoint[], distM: number): number | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  if (distM <= first.distM) return first.altM;
  if (distM >= last.distM) return last.altM;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b && distM <= b.distM) {
      const span = b.distM - a.distM;
      return span <= 0 ? b.altM : a.altM + ((distM - a.distM) / span) * (b.altM - a.altM);
    }
  }
  return last.altM;
}

/** Metres of road kept behind the rider and past the climb's end when the strip zooms on a climb. */
export const CLIMB_MARGIN_M = 500;
/** How far ahead the strip looks when there is no climb to zoom on. */
export const LOOK_AHEAD_M = 8000;

/** The stretch of the route the strip draws: the climb with a margin (and the rider if still before it), else the road ahead. */
export function stripWindow(
  climb: { startM: number; endM: number } | null,
  positionM: number | null,
  totalM: number,
): { fromM: number; toM: number } {
  const here = Math.max(0, positionM ?? 0);
  const from = climb ? Math.min(here, climb.startM) - CLIMB_MARGIN_M : here - CLIMB_MARGIN_M;
  const to = climb ? Math.max(here, climb.endM) + CLIMB_MARGIN_M : here + LOOK_AHEAD_M;
  const fromM = Math.max(0, from);
  const toM = Math.min(totalM, Math.max(to, fromM + 1000));
  return { fromM, toM: Math.max(toM, fromM) };
}

/** `points` between `fromM` and `toM`, with interpolated points on both edges so the profile reaches them exactly. */
export function cropProfile(points: readonly ElevationPoint[], fromM: number, toM: number): ElevationPoint[] {
  if (toM <= fromM) return [];
  const startAlt = altitudeAt(points, fromM);
  const endAlt = altitudeAt(points, toM);
  if (startAlt === null || endAlt === null) return [];
  return [{ distM: fromM, altM: startAlt }, ...points.filter((p) => p.distM > fromM && p.distM < toM), { distM: toM, altM: endAlt }];
}

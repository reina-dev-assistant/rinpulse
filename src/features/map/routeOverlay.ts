/**
 * The pure half of the route drawn over `TileMap`: the SVG path of one segment and the choice of which km pills to show.
 * No React and no react-native, so both run under `bun test` with a long synthetic ride.
 */
import { simplifyFlat } from './renderTile';
import { lonLatToWorld, type LatLon } from './tileMath';

/** Points closer than this (px) to the previous kept one are dropped before the Douglas-Peucker pass. */
const MIN_STEP_PX = 0.4;
/** Douglas-Peucker tolerance (px): half the line width of the thinnest line the map draws. */
const PATH_TOLERANCE_PX = 0.5;

/**
 * Projects, de-duplicates and simplifies a route segment to an SVG path in layer px. The tolerance is in screen px, so the
 * vertex count follows the zoom and the length on screen, not the number of samples: a 157 km ride fitted into a 330 px
 * card ends up as tens to a few hundred vertices whatever its recording rate. Both ends are always kept.
 */
export function routePath(seg: readonly LatLon[], zoom: number, originX: number, originY: number): string | null {
  const flat: number[] = [];
  let lx = Infinity;
  let ly = Infinity;
  for (const [lat, lon] of seg) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const w = lonLatToWorld(lat, lon, zoom);
    const x = w.x - originX;
    const y = w.y - originY;
    if (Math.abs(x - lx) < MIN_STEP_PX && Math.abs(y - ly) < MIN_STEP_PX) continue;
    flat.push(x, y);
    lx = x;
    ly = y;
  }
  if (flat.length < 4) return null;
  const s = simplifyFlat(flat, PATH_TOLERANCE_PX);
  let d = `M${s[0].toFixed(1)} ${s[1].toFixed(1)}`;
  for (let i = 2; i < s.length; i += 2) d += `L${s[i].toFixed(1)} ${s[i + 1].toFixed(1)}`;
  return d;
}

/** The distances a km pill may stand for, in km. A route shows every pill whose km is a multiple of one of these. */
export const KM_STEPS: readonly number[] = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

/** At most this many km pills at once: more than that and the pills hide the line they are meant to annotate. */
export const MAX_KM_PILLS = 12;

export interface KmCandidate {
  /** Whole kilometre. */
  km: number;
  /** Screen position of the marker. */
  x: number;
  y: number;
  /** Size of the pill drawn there, px. */
  w: number;
  h: number;
}

export interface FixedBox {
  /** Centre. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Which km pills to draw. Takes the pills that are on screen (the caller filters), finds the smallest step of `KM_STEPS`
 * at which at most `MAX_KM_PILLS` remain, and then drops every pill that would overlap an earlier one or one of `fixed`
 * (the start and finish markers). Zoomed out over a 157 km ride that is a pill every 20 km; zoomed in on one valley the
 * same function shows every kilometre again. An out-and-back route keeps the first pass's pill and drops the return's
 * where the two meet. Returns the kept `km` values in input order.
 */
export function pickKmPills(
  candidates: readonly KmCandidate[],
  fixed: readonly FixedBox[] = [],
  gap = 4,
  max = MAX_KM_PILLS,
): number[] {
  let subset: readonly KmCandidate[] = candidates;
  for (const step of KM_STEPS) {
    subset = candidates.filter((c) => c.km % step === 0);
    if (subset.length <= max) break;
  }
  const kept: KmCandidate[] = [];
  for (const c of subset) {
    // Boxes are centred: they overlap when both centre distances are inside half the summed size plus the gap.
    const blocked = [...fixed, ...kept].some(
      (o) => Math.abs(c.x - o.x) < (c.w + o.w) / 2 + gap && Math.abs(c.y - o.y) < (c.h + o.h) / 2 + gap,
    );
    if (!blocked) kept.push(c);
  }
  return kept.map((c) => c.km);
}

/**
 * Scaling for the lift charts (`ui/Chart.tsx`): the range selector, a nice y axis and the pixel positions of points and bars.
 * Pure, so the geometry is tested without a screen. Handles 0, 1 and many points.
 */

export type ChartRange = '3m' | '6m' | '1y' | 'all';

export const CHART_RANGES: readonly ChartRange[] = ['3m', '6m', '1y', 'all'];

const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<Exclude<ChartRange, 'all'>, number> = { '3m': 92, '6m': 183, '1y': 365 };

/** The points not older than the range (`now` minus its days); `all` keeps everything. Order is kept. */
export function inRange<T extends { at: number }>(points: readonly T[], range: ChartRange, now: number): T[] {
  if (range === 'all') return [...points];
  const from = now - RANGE_DAYS[range] * DAY_MS;
  return points.filter((p) => p.at >= from);
}

/** A step of 1, 2, 2.5, 5 times a power of ten that is at least `raw`. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

export interface Domain {
  min: number;
  max: number;
  /** Gridline values from `min` to `max`. */
  ticks: number[];
}

/**
 * A y axis around `[min, max]` with round gridlines. `zeroBased` starts at 0 (bars, volume); a flat series (`min === max`) gets a
 * range around the value so the line sits in the middle instead of dividing by zero.
 */
export function niceDomain(min: number, max: number, wanted = 4, zeroBased = false): Domain {
  let lo = zeroBased ? Math.min(0, min) : min;
  let hi = max;
  if (hi - lo < 1e-9) {
    const pad = Math.max(Math.abs(hi) * 0.1, 1);
    lo = zeroBased ? 0 : lo - pad;
    hi = zeroBased ? Math.max(hi, 1) : hi + pad;
  }
  const step = niceStep((hi - lo) / Math.max(1, wanted - 1));
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { min: start, max: end, ticks };
}

export interface Plot {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ChartPoint {
  at: number;
  value: number;
}

export interface LineLayout {
  domain: Domain;
  x: number[];
  y: number[];
}

/** Pixel positions of a line chart: x by time (a single point, or points at one instant, sit in the middle), y by the domain. */
export function layoutLine(points: readonly ChartPoint[], plot: Plot, zeroBased = false): LineLayout {
  const innerW = Math.max(0, plot.width - plot.left - plot.right);
  const innerH = Math.max(0, plot.height - plot.top - plot.bottom);
  if (points.length === 0) return { domain: niceDomain(0, 1, 4, zeroBased), x: [], y: [] };
  const values = points.map((p) => p.value);
  const domain = niceDomain(Math.min(...values), Math.max(...values), 4, zeroBased);
  const first = points[0]!.at;
  const last = points[points.length - 1]!.at;
  const span = last - first;
  const x = points.map((p) => plot.left + (span > 0 ? ((p.at - first) / span) * innerW : innerW / 2));
  const y = points.map((p) => plot.top + (1 - (p.value - domain.min) / (domain.max - domain.min)) * innerH);
  return { domain, x, y };
}

export interface BarLayout {
  domain: Domain;
  /** Left edge of each bar. */
  x: number[];
  barWidth: number;
  /** Top of each bar; the base is `base`. */
  y: number[];
  base: number;
}

/** Pixel positions of a bar chart: one slot per point, bars at least 2 px and at most 28 px wide, y from 0. */
export function layoutBars(points: readonly ChartPoint[], plot: Plot): BarLayout {
  const innerW = Math.max(0, plot.width - plot.left - plot.right);
  const innerH = Math.max(0, plot.height - plot.top - plot.bottom);
  const base = plot.top + innerH;
  if (points.length === 0) return { domain: niceDomain(0, 1, 4, true), x: [], barWidth: 0, y: [], base };
  const domain = niceDomain(0, Math.max(...points.map((p) => p.value)), 4, true);
  const slot = innerW / points.length;
  const barWidth = Math.min(28, Math.max(2, slot * 0.68));
  const x = points.map((_, i) => plot.left + slot * i + (slot - barWidth) / 2);
  const y = points.map((p) => plot.top + (1 - (p.value - domain.min) / (domain.max - domain.min)) * innerH);
  return { domain, x, barWidth, y, base };
}

/** The index of the entry of `centers` closest to `touchX`; -1 when there are none. */
export function nearestIndex(centers: readonly number[], touchX: number): number {
  let best = -1;
  let distance = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const d = Math.abs(centers[i]! - touchX);
    if (d < distance) {
      distance = d;
      best = i;
    }
  }
  return best;
}

/** Which of `count` points get an x-axis label: the first, the last and, with room, the middle. */
export function labelIndices(count: number, wide: boolean): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  if (count === 2 || !wide) return [0, count - 1];
  return [0, Math.floor((count - 1) / 2), count - 1];
}

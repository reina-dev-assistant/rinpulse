/**
 * Pure helpers of the ride detail cards: mapping and arithmetic only, no React, no i18n lookups (cards translate with the keys these
 * return), so they are unit-tested without a renderer.
 */
import type { CadenceBand, ClimbCategory, PowerEffort, PowerZone, RideSplit } from '../types';

const MS_TO_KMH = 3.6;

export function kmhOf(ms: number | null): number | null {
  return ms === null ? null : ms * MS_TO_KMH;
}

// --- Climbs -----------------------------------------------------------------------------------

export type ClimbCategoryKey = `climbs.category.${ClimbCategory}`;

export function climbCategoryKey(category: ClimbCategory): ClimbCategoryKey {
  return `climbs.category.${category}`;
}

/** Which palette slot (0..4, easy to hard) a category chip is drawn in; the unclassified climb takes the easiest. */
export function climbCategoryTone(category: ClimbCategory): 0 | 1 | 2 | 3 | 4 {
  switch (category) {
    case 'hc':
      return 4;
    case '1':
      return 4;
    case '2':
      return 3;
    case '3':
      return 2;
    case '4':
      return 1;
    default:
      return 0;
  }
}

// --- Scrub cursor -----------------------------------------------------------------------------

/** The grid sample at `sec` seconds into the ride, kept inside the grid. */
export function scrubIndexAt(sec: number, stepSec: number, n: number): number {
  if (n <= 0 || stepSec <= 0) return 0;
  return Math.min(n - 1, Math.max(0, Math.round(sec / stepSec)));
}

/** The first grid sample whose cumulative distance reaches `targetM` (binary search); the last sample when the ride is shorter. */
export function indexAtDistance(dist: readonly number[], targetM: number): number {
  if (dist.length === 0) return 0;
  let lo = 0;
  let hi = dist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dist[mid]! >= targetM) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Grid sample where each split ends; the last split ends at the last sample. Empty without a distance series. */
export function splitEnds(dist: readonly number[] | null, splits: readonly Pick<RideSplit, 'distM'>[]): number[] {
  if (!dist || dist.length === 0) return [];
  let cumulative = 0;
  return splits.map((s, k) => {
    cumulative += s.distM;
    return k === splits.length - 1 ? dist.length - 1 : indexAtDistance(dist, cumulative);
  });
}

/** Cumulative kilometres at the end of each split, for the row labels. */
export function splitEndKm(splits: readonly Pick<RideSplit, 'distM'>[]): number[] {
  let cumulative = 0;
  return splits.map((s) => {
    cumulative += s.distM;
    return cumulative / 1000;
  });
}

/** Bar lengths 0..1 for speeds, relative to the fastest; null speeds get 0. */
export function speedBarFractions(speeds: readonly (number | null)[]): number[] {
  let top = 0;
  for (const v of speeds) if (v !== null && v > top) top = v;
  return speeds.map((v) => (v !== null && top > 0 ? v / top : 0));
}

/** Index of the fastest value, -1 when there is none. */
export function fastestSpeedIndex(speeds: readonly (number | null)[]): number {
  let best = -1;
  for (let i = 0; i < speeds.length; i++) {
    const v = speeds[i];
    if (v !== null && v !== undefined && (best === -1 || v > speeds[best]!)) best = i;
  }
  return best;
}

// --- Power zones ------------------------------------------------------------------------------

/** Share of the zone time (0..1) of each zone; all zeros without time. */
export function zoneShares(zones: readonly Pick<PowerZone, 'sec'>[]): number[] {
  const total = zones.reduce((sum, z) => sum + z.sec, 0);
  return zones.map((z) => (total > 0 ? z.sec / total : 0));
}

/** Bar width as a percentage string for a 0..1 share, whole percent. */
export function barWidth(fraction: number): `${number}%` {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  return `${Math.round(f * 100)}%`;
}

export type ZoneRangeKind = 'range' | 'from' | 'to';

/** How a zone's watt range reads: both bounds, open ended above, or (the first zone) from zero. */
export function zoneRangeKind(zone: Pick<PowerZone, 'fromW' | 'toW'>): ZoneRangeKind {
  if (zone.toW === null) return 'from';
  return zone.fromW <= 0 ? 'to' : 'range';
}

// --- Power curve ------------------------------------------------------------------------------

/** Tick candidates of the duration axis, seconds. */
export const CURVE_TICKS_SEC: readonly number[] = [1, 5, 15, 60, 300, 1200, 3600, 7200];

export type DurationUnit = 'sec' | 'min' | 'hour';

/** `{ value: 20, unit: 'min' }` for 1200 s: the largest unit that gives a whole number. */
export function durationParts(sec: number): { value: number; unit: DurationUnit } {
  if (sec >= 3600 && sec % 3600 === 0) return { value: sec / 3600, unit: 'hour' };
  if (sec >= 60 && sec % 60 === 0) return { value: sec / 60, unit: 'min' };
  return { value: sec, unit: 'sec' };
}

/** Position 0..1 of a duration on the log axis from `minSec` to `maxSec`. */
export function logFraction(sec: number, minSec: number, maxSec: number): number {
  if (maxSec <= minSec || minSec <= 0) return 0;
  const f = (Math.log(Math.max(sec, minSec)) - Math.log(minSec)) / (Math.log(maxSec) - Math.log(minSec));
  return Math.max(0, Math.min(1, f));
}

/** The axis ticks that fit between the first and last duration of the curve. */
export function curveTicks(minSec: number, maxSec: number): number[] {
  return CURVE_TICKS_SEC.filter((t) => t >= minSec && t <= maxSec);
}

export interface CurveDomain {
  minSec: number;
  maxSec: number;
  maxWatts: number;
}

/** The axis range both lines share: from the shortest to the longest duration of either, and the top watt rounded up to 50 W. */
export function curveDomain(...lines: readonly (readonly Pick<PowerEffort, 'sec' | 'watts'>[])[]): CurveDomain | null {
  let minSec = Infinity;
  let maxSec = 0;
  let maxWatts = 0;
  for (const line of lines) {
    for (const p of line) {
      if (p.sec < minSec) minSec = p.sec;
      if (p.sec > maxSec) maxSec = p.sec;
      if (p.watts > maxWatts) maxWatts = p.watts;
    }
  }
  if (!Number.isFinite(minSec) || maxSec <= minSec || maxWatts <= 0) return null;
  return { minSec, maxSec, maxWatts: Math.ceil(maxWatts / 50) * 50 };
}

export interface CurveBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function curveX(sec: number, domain: CurveDomain, box: CurveBox): number {
  return box.left + logFraction(sec, domain.minSec, domain.maxSec) * box.width;
}

export function curveY(watts: number, domain: CurveDomain, box: CurveBox): number {
  return box.top + box.height * (1 - Math.max(0, Math.min(domain.maxWatts, watts)) / domain.maxWatts);
}

/** An SVG path through the points, whole pixels tenth-rounded; empty for fewer than two points. */
export function curvePath(points: readonly Pick<PowerEffort, 'sec' | 'watts'>[], domain: CurveDomain, box: CurveBox): string {
  if (points.length < 2) return '';
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${curveX(p.sec, domain, box).toFixed(1)} ${curveY(p.watts, domain, box).toFixed(1)}`)
    .join(' ');
}

/** Y-axis ticks in watts: 0 and every step up to the top. */
export function wattTicks(maxWatts: number, target = 4): number[] {
  if (maxWatts <= 0) return [0];
  const step = Math.max(50, Math.ceil(maxWatts / target / 50) * 50);
  const out: number[] = [];
  for (let w = 0; w <= maxWatts; w += step) out.push(w);
  return out;
}

export interface KeyEffortRow {
  sec: number;
  watts: number;
  wkg: number | null;
  /** True when this ride set the all-time best for the duration. */
  record: boolean;
  /** The all-time best watts when this ride did not beat it. */
  bestWatts: number | null;
}

/** Rows of the key durations the ride is long enough for; `records` are the durations that are all-time bests. */
export function keyEffortRows(
  curve: readonly PowerEffort[],
  keys: readonly number[],
  weightKg: number | null,
  records: readonly number[],
  allTime: readonly { sec: number; watts: number }[],
): KeyEffortRow[] {
  const rows: KeyEffortRow[] = [];
  for (const sec of keys) {
    const e = curve.find((p) => p.sec === sec);
    if (!e) continue;
    const record = records.includes(sec);
    const best = allTime.find((a) => a.sec === sec)?.watts ?? null;
    rows.push({
      sec,
      watts: e.watts,
      wkg: weightKg !== null && weightKg > 0 ? e.watts / weightKg : null,
      record,
      bestWatts: !record && best !== null ? best : null,
    });
  }
  return rows;
}

// --- FTP --------------------------------------------------------------------------------------

/** The estimate is worth showing when there is no FTP yet or it differs from it by 3 percent or more. */
export function ftpSuggestionDiffers(suggested: number, ftp: number | null): boolean {
  if (ftp === null || ftp <= 0) return true;
  return Math.abs(suggested - ftp) / ftp >= 0.03;
}

// --- Cadence ----------------------------------------------------------------------------------

export type CadenceBandLabel = { kind: 'coasting' } | { kind: 'range'; from: number; to: number } | { kind: 'open'; from: number };

/** How a band reads: coasting (0 rpm), `60-69`, `110+`. The engine's bounds are inclusive below, exclusive above. */
export function cadenceBandLabel(band: Pick<CadenceBand, 'fromRpm' | 'toRpm'>): CadenceBandLabel {
  if (band.fromRpm === 0 && band.toRpm === 1) return { kind: 'coasting' };
  if (band.toRpm === null) return { kind: 'open', from: band.fromRpm };
  return { kind: 'range', from: band.fromRpm, to: band.toRpm - 1 };
}

/** Share (0..1) of pedalling against coasting; null when neither has time. */
export function pedallingShare(pedallingSec: number, coastingSec: number): number | null {
  const total = pedallingSec + coastingSec;
  return total > 0 ? pedallingSec / total : null;
}

// --- Heart rate -------------------------------------------------------------------------------

export type DecouplingVerdict = 'good' | 'drift' | 'better';

/** Under 5 percent is a good aerobic base; 5 or more means the heart rate drifted up; a fall of 5 or more is a better second half. */
export function decouplingVerdict(pct: number): DecouplingVerdict {
  if (pct >= 5) return 'drift';
  if (pct <= -5) return 'better';
  return 'good';
}

// --- Power balance ----------------------------------------------------------------------------

/** Left and right shares in whole percent that add up to 100. */
export function balanceSplit(leftPct: number): { left: number; right: number } {
  const left = Math.max(0, Math.min(100, Math.round(leftPct)));
  return { left, right: 100 - left };
}

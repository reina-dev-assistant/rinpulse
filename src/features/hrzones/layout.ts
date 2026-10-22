/**
 * What the Zona HR screen draws, worked out from the resolved zones: the boundary boxes between the zones (bpm and percent), the zone band
 * with its percent ticks and the sizes that keep both readable at any font scale. No React: unit tested with `bun test`.
 */
import { HR_ZONE_COUNT, methodPercents, ZONE_MIN_BPM, type HrZones } from './zones';

type Scaled = Pick<HrZones, 'method' | 'maxHr' | 'restingHr' | 'lthr'>;

/** What a percentage is a share of: `base + range x percent / 100` is the bpm. Maximum: 0 and max HR. Reserve: rest and max minus rest. LTHR: 0 and the LTHR. */
export function percentScale(zones: Scaled): { base: number; range: number } {
  if (zones.method === 'hrr') return { base: zones.restingHr, range: Math.max(1, zones.maxHr - zones.restingHr) };
  if (zones.method === 'lthr') return { base: 0, range: Math.max(1, zones.lthr ?? zones.maxHr) };
  return { base: 0, range: Math.max(1, zones.maxHr) };
}

/** The lowest whole bpm at or above `percent`: how the zone limits are worked out from their percentages. */
export function percentToBpm(percent: number, scale: { base: number; range: number }): number {
  return Math.ceil((scale.range * percent) / 100) + scale.base;
}

/** The share of the scale a bpm is, rounded to a whole percent. */
export function bpmToPercent(bpm: number, scale: { base: number; range: number }): number {
  return Math.round(((bpm - scale.base) * 100) / scale.range);
}

/** A boundary between two zones (or the top of the highest one): its bpm and percent, and the limit a box edits when it is one. */
export interface Boundary {
  /** 0 is the top, the maximum; then the lowest bpm of each zone from the highest down. */
  position: number;
  bpm: number;
  percent: number;
  /** Index (0..4) of the zone limit this boundary is; null for the maximum and for the reserve method's fixed warm-up start. */
  limit: number | null;
}

/**
 * The boundaries top to bottom: `zones.bounds.length + 1` of them, the maximum first. A percentage of the method's own table is shown as that
 * table says (a limit is rounded up to a whole bpm, so working the share back from the bpm can be a point off); one the person moved is worked out.
 */
export function boundaries(zones: Pick<HrZones, 'method' | 'maxHr' | 'restingHr' | 'lthr' | 'bounds'>): Boundary[] {
  const scale = percentScale(zones);
  const table = methodPercents(zones.method);
  const n = zones.bounds.length;
  const offset = n - HR_ZONE_COUNT;
  const out: Boundary[] = [{ position: 0, bpm: zones.maxHr, percent: bpmToPercent(zones.maxHr, scale), limit: null }];
  for (let position = 1; position <= n; position++) {
    const b = n - position;
    const bpm = zones.bounds[b] ?? zones.maxHr;
    const listed = table[b];
    out.push({
      position,
      bpm,
      percent: listed !== undefined && percentToBpm(listed, scale) === bpm ? listed : bpmToPercent(bpm, scale),
      limit: b - offset >= 0 ? b - offset : null,
    });
  }
  return out;
}

/** The lowest and highest bpm limit `index` (0..4) may be moved to without touching a neighbour (the same bounds `moveLimit` keeps). */
export function limitRange(limits: readonly number[], index: number, maxHr: number): { min: number; max: number } {
  const before = limits[index - 1];
  const after = limits[index + 1];
  return {
    min: index === 0 || before === undefined ? ZONE_MIN_BPM : before + 1,
    max: index === HR_ZONE_COUNT - 1 || after === undefined ? maxHr - 1 : after - 1,
  };
}

/** The band starts at this share, as Huawei Health's does; a limit set lower pulls the start down to it. */
export const BAND_START_PERCENT = 30;

export interface BandSegment {
  /** Zero-based zone. */
  zone: number;
  /** Share of the band's width, in 0..1; the zones and the lead together make 1. */
  share: number;
}

/** The zone band: the stretch under the first zone (no zone) and one proportional segment per zone, lowest first. */
export function bandLayout(zones: Pick<HrZones, 'method' | 'maxHr' | 'restingHr' | 'lthr' | 'bounds'>): {
  start: number;
  lead: number;
  segments: BandSegment[];
} {
  const scale = percentScale(zones);
  const first = zones.bounds[0] ?? zones.maxHr;
  const start = Math.min(percentToBpmExact(BAND_START_PERCENT, scale), first);
  const span = Math.max(1, zones.maxHr - start);
  const at = (bpm: number) => Math.min(1, Math.max(0, (bpm - start) / span));
  const segments = zones.bounds.map((from, zone) => {
    const next = zones.bounds[zone + 1] ?? zones.maxHr;
    return { zone, share: Math.max(0, at(next) - at(from)) };
  });
  return { start, lead: at(first), segments };
}

function percentToBpmExact(percent: number, scale: { base: number; range: number }): number {
  return scale.base + (scale.range * percent) / 100;
}

/** Percent ticks to label under the band: every multiple of `step` the band covers, with where each sits as a share of its width. */
export function bandTicks(
  zones: Pick<HrZones, 'method' | 'maxHr' | 'restingHr' | 'lthr' | 'bounds'>,
  step: number,
): { percent: number; at: number }[] {
  const scale = percentScale(zones);
  const { start } = bandLayout(zones);
  const span = Math.max(1, zones.maxHr - start);
  const out: { percent: number; at: number }[] = [];
  if (!(step > 0)) return out;
  const last = Math.floor(((zones.maxHr - scale.base) * 100) / scale.range + 1e-9);
  for (let percent = Math.ceil(((start - scale.base) * 100) / scale.range / step - 1e-9) * step; percent <= last; percent += step) {
    out.push({ percent, at: (percentToBpmExact(percent, scale) - start) / span });
  }
  return out;
}

/** Room one tick label (such as "100%") needs at a font scale, in px. */
export const TICK_LABEL_PX = 36;

/** The spacing of the ticks that keeps their labels apart: 10 percent when they fit, else 20, 25 or 50. */
export function tickStep(bandWidth: number, spanPercent: number, fontScale: number): number {
  if (!(bandWidth > 0) || !(spanPercent > 0)) return 20;
  const need = TICK_LABEL_PX * Math.max(1, fontScale);
  for (const step of [10, 20, 25, 50]) {
    if ((bandWidth * step) / spanPercent >= need) return step;
  }
  return 50;
}

export interface ZoneGeometry {
  /** Height of a boundary box. */
  box: number;
  /** Distance between two boundaries: the height of a zone's row. */
  row: number;
}

/** Sizes of the zone list at a font scale: a box holds one figure of the themed size, a row two lines of a zone name. */
export function zoneGeometry(fontScale: number): ZoneGeometry {
  const scale = Math.min(2, Math.max(1, Number.isFinite(fontScale) ? fontScale : 1));
  const box = Math.max(48, Math.ceil(26 * 1.2 * scale) + 10);
  return { box, row: Math.max(box + 12, Math.ceil(2 * 21 * scale) + 14) };
}

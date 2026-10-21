/**
 * Pure maths behind the shared bar readout: which bar a touch lands on, how a tap changes the selection, and whether
 * value labels fit above the bars. No React, no react-native: unit tested with `bun test`.
 */

/** Bars at or under this count may print a small value above each bar. */
export const LABEL_MAX_BARS = 12;
/** Average glyph width of the 11pt caption used for the value labels. */
export const LABEL_CHAR_WIDTH = 6;
const LABEL_GAP = 4;

/** The bar under touch x, for `count` equal slots spanning [left, left + width). -1 when there is no bar there. */
export function bucketAt(x: number, left: number, width: number, count: number): number {
  if (count <= 0 || width <= 0 || !Number.isFinite(x)) return -1;
  if (x < left || x > left + width) return -1;
  return Math.min(count - 1, Math.floor(((x - left) / width) * count));
}

/** The point nearest touch x, for `count` points evenly spaced from `left` to `left + width` (one point sits in the middle). -1 off the chart. */
export function pointAt(x: number, left: number, width: number, count: number): number {
  if (count <= 0 || width <= 0 || !Number.isFinite(x)) return -1;
  const step = count > 1 ? width / (count - 1) : width;
  if (x < left - step / 2 || x > left + width + step / 2) return -1;
  if (count === 1) return 0;
  return Math.max(0, Math.min(count - 1, Math.round((x - left) / step)));
}

/** The bar after a touch ended: a drag keeps what it landed on, a tap on the selected bar (or outside any bar) clears. */
export function nextSelection(current: number | null, hit: number, moved: boolean): number | null {
  if (hit < 0) return null;
  if (!moved && hit === current) return null;
  return hit;
}

/** True when every bar can carry its own value label: few bars, and the longest label fits in one slot. */
export function labelsFit(count: number, width: number, longestLabel: number): boolean {
  if (count <= 0 || count > LABEL_MAX_BARS || width <= 0) return false;
  return width / count >= longestLabel * LABEL_CHAR_WIDTH + LABEL_GAP;
}

/**
 * Which bars print a value label. The selected bar never does: the readout above the chart already says its value.
 * Otherwise all bars when they fit, else only `highlighted` (the current or busiest bar; null while a bar is selected).
 */
export function labelledBars(
  count: number,
  width: number,
  labels: readonly string[],
  highlighted: number | null,
  selected: number | null = null,
): ReadonlySet<number> {
  const longest = labels.reduce((m, l) => Math.max(m, l.length), 0);
  const shown = labelsFit(count, width, longest)
    ? new Set(labels.keys())
    : highlighted !== null && highlighted >= 0 && highlighted < count
      ? new Set([highlighted])
      : new Set<number>();
  if (selected !== null) shown.delete(selected);
  return shown;
}

/** Centre x of bar `index` among `count` equal slots separated by `gap`, in a chart `width` wide. */
export function slotCenter(index: number, count: number, width: number, gap: number): number {
  if (count <= 0) return 0;
  const slot = (width - gap * (count - 1)) / count;
  return index * (slot + gap) + slot / 2;
}

/**
 * Left edge for a label `labelWidth` wide, centred on `center` and kept inside [inset, width - inset]. A label wider
 * than that room starts at `inset` and runs over the right edge rather than being cut.
 */
export function labelLeft(center: number, labelWidth: number, width: number, inset = 0): number {
  return Math.max(inset, Math.min(center - labelWidth / 2, width - inset - labelWidth));
}

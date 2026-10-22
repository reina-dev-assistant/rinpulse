/**
 * Pure maths behind the shared bar readout: which bar a touch lands on, how a tap changes the selection, and whether
 * value labels fit above the bars. No React, no react-native: unit tested with `bun test`.
 */

/** Bars at or under this count may print a small value above each bar. */
export const LABEL_MAX_BARS = 12;
/** Width of one digit of the 13pt caption used for the value labels, taken as 0.6 em (Space Grotesk's digits run 0.43 em for 1 to 0.65 em), so a label is never estimated narrower than it prints. */
const LABEL_DIGIT_WIDTH = 8;
/** Thousands separator of that caption. */
const LABEL_SEPARATOR_WIDTH = 4;
const LABEL_GAP = 4;

/** Width in px a bar's value label takes, counted by glyph kind: a separator is half a digit, so "100,000" is not "1000000". */
export function labelWidth(label: string): number {
  let width = 0;
  for (const ch of label) width += ch === ',' || ch === '.' || ch === ' ' ? LABEL_SEPARATOR_WIDTH : LABEL_DIGIT_WIDTH;
  return width;
}

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

/** True when every bar can carry its own value label: few bars, and the widest label (px, `labelWidth`) fits in one slot. */
export function labelsFit(count: number, width: number, widestLabel: number): boolean {
  if (count <= 0 || count > LABEL_MAX_BARS || width <= 0) return false;
  return width / count >= widestLabel + LABEL_GAP;
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
  const widest = labels.reduce((m, l) => Math.max(m, labelWidth(l)), 0);
  const shown = labelsFit(count, width, widest)
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

/** The value the bars are scaled to: the tallest bar or the goal line, whichever is more. Values that are not numbers do not take part. */
export function chartPeak(values: readonly number[], goal = 0): number {
  let peak = Number.isFinite(goal) && goal > 0 ? goal : 0;
  for (const v of values) if (Number.isFinite(v) && v > peak) peak = v;
  return peak;
}

/**
 * Height of a bar in px: proportional to the peak, never below `min` so a day with a few steps next to a day with 100,000 is still
 * a bar, never above `height`. 0 (or less, or not a number) is the `min` stub; a value with no peak to compare to is a full bar.
 */
export function barHeight(value: number, peak: number, height: number, min: number): number {
  if (!(value > 0)) return min;
  if (!(peak > 0) || value >= peak) return height;
  return Math.min(height, Math.max(min, (value / peak) * height));
}

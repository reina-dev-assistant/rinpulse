/**
 * Pure maths behind `Ring`: the filled fraction, the dotted ring's geometry and which dots light up, and the room the centre text has.
 * No React, no react-native: unit tested with `bun test`.
 */

/** Gap between dots of a dotted ring, in stroke widths from center to center. */
export const DOT_PITCH = 2;
/** Fewest dots a dotted ring draws, so a small ring still reads as a ring. */
export const MIN_DOTS = 12;

/** `value / max` as a fraction held to 0..1. Anything that is not a usable number (NaN, no goal, a negative goal) is 0; a value past the goal, or Infinity, is a full ring. */
export function ringRatio(value: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(max) || Number.isNaN(value) || value <= 0) return 0;
  if (value >= max) return 1;
  return value / max;
}

export interface DotGeometry {
  /** Radius of the circle the dots sit on. */
  r: number;
  circumference: number;
  /** Whole number of dots around the ring, so the pattern closes without a short gap. */
  count: number;
  /** Arc length from one dot centre to the next. */
  pitch: number;
}

/** Geometry of a ring `size` wide drawn with `stroke` wide dots. Degenerate sizes (a stroke wider than the ring, zero) still give a finite, closed ring. */
export function dotGeometry(size: number, stroke: number): DotGeometry {
  const half = (size - stroke) / 2;
  const r = half > 1 ? half : 1;
  const circumference = 2 * Math.PI * r;
  const raw = stroke > 0 ? Math.round(circumference / (stroke * DOT_PITCH)) : MIN_DOTS;
  const count = Number.isFinite(raw) ? Math.max(MIN_DOTS, raw) : MIN_DOTS;
  return { r, circumference, count, pitch: circumference / count };
}

/**
 * Dots lit for a ring `ratio` full, out of `count`. Never 0 for progress that exists, so a few steps still show; never all of them
 * until the ratio is 1, so 99.6% of a goal does not read as reached.
 */
export function litDots(ratio: number, count: number): number {
  if (!(ratio > 0) || count <= 0) return 0;
  if (ratio >= 1) return count;
  return Math.min(count - 1, Math.max(1, Math.round(ratio * count)));
}

/** What the progress bar announces. A goal that is not a usable number announces 0 of 100 rather than NaN or Infinity. */
export function ringA11yValue(value: number, max: number): { min: 0; max: number; now: number } {
  const usable = Number.isFinite(max) && max > 0;
  const top = usable ? Math.round(max) : 100;
  const now = !usable || Number.isNaN(value) ? 0 : Math.round(Math.min(Math.max(value, 0), top));
  return { min: 0, max: top, now };
}

/** Share of the inner diameter a line of centre text may fill: a line sits on a chord, shorter than the diameter. */
const CENTER_CHORD = 0.88;

/** Width a figure inside a ring `size` wide with `stroke` wide dots may take without touching the dots. */
export function ringInnerWidth(size: number, stroke: number): number {
  return Math.max(0, Math.floor((size - 2 * stroke) * CENTER_CHORD));
}

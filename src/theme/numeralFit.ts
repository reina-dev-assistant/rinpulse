/**
 * Sizing a figure to the room it has. A monospaced numeral face (Doto in the Titik theme, JetBrains Mono in Neon) is as wide as
 * its character count says, so the size that fits is a sum, not a guess: "30,000" is 6 cells wide, "100,000" is 7. Proportional
 * faces get the platform's `adjustsFontSizeToFit` instead. No React, no react-native: unit tested with `bun test`.
 */

/** Advance of every glyph of a monospaced numeral family, in em (digits and the thousands separator share one cell). Measured from the font files. */
const MONO_ADVANCE_EM: Readonly<Record<string, number>> = {
  Doto_900Black: 0.6,
  JetBrainsMono_800ExtraBold: 0.6,
};

export function monoAdvance(family: string): number | null {
  return MONO_ADVANCE_EM[family] ?? null;
}

/** Smallest share of the themed size a figure shrinks to before the platform's own fitting (and then the ellipsis) takes over. */
export const MIN_FIT_SCALE = 0.5;

export interface FitInput {
  /** The characters drawn: digits and separators, no unit. */
  text: string;
  /** Themed font size. */
  size: number;
  /** Themed letter spacing in px per character (may be negative). */
  tracking: number;
  /** Advance of one character in em. */
  advance: number;
  /** Room for the figure in px. */
  maxWidth: number;
}

/** Width of `text` in px for a monospaced face at `size`. */
export function monoWidth(text: string, size: number, tracking: number, advance: number): number {
  return [...text].length * (advance * size + tracking);
}

/**
 * Largest size up to `size` at which `text` fits `maxWidth`, not below `MIN_FIT_SCALE` of `size`. A width that is not usable
 * (NaN, zero) leaves the size as it is.
 */
export function fitMonoSize({ text, size, tracking, advance, maxWidth }: FitInput): number {
  const chars = [...text].length;
  if (chars === 0 || !(maxWidth > 0) || !(advance > 0) || monoWidth(text, size, tracking, advance) <= maxWidth) return size;
  const fitted = (maxWidth / chars - tracking) / advance;
  return Math.max(Math.floor(size * MIN_FIT_SCALE), Math.min(size, Math.floor(fitted)));
}

/**
 * How big a value can be drawn in a cell. Pure: the cell measures itself, this decides the font size, so a long value ("12:34:56") shrinks
 * and a short one ("8") grows until the cell's height or width is used. `adjustsFontSizeToFit` alone is not enough: it shrinks only after
 * layout, flickers on every digit change and cannot grow.
 */

/**
 * Advance of a tabular heavy digit as a fraction of the font size: the widest digit (0) of Plus Jakarta Sans 800 is 0.70 em wide, and tabular
 * figures give every digit that width (measured in a browser with the real font file; the ride's -2 % tracking takes a little back).
 */
export const DIGIT_ASPECT = 0.7;

/** Line height as a fraction of the font size; numerals have no descenders, so this is tight. */
const LINE_RATIO = 1.05;

/** Width of a character relative to a tabular digit, measured with the same font: separators are narrow, `%` is wide. */
const NARROW: Record<string, number> = { '.': 0.6, ',': 0.55, ':': 0.6, ' ': 0.3, '-': 0.9, '/': 0.8, '%': 1.55 };

/** The width of `text` counted in digits: `12:34` is 4.2 digits. Letters count as a full digit (wide ones are rare in a value). */
export function textUnits(text: string): number {
  let units = 0;
  for (const char of text) units += NARROW[char] ?? 1;
  return units;
}

/** Average advance of a bold label letter as a fraction of its font size (measured on Indonesian and English field names). */
export const LABEL_ASPECT = 0.6;
/** Gap kept between the label and the unit on the same line, in dp. */
const LABEL_GAP = 8;

/** Whether `label` and the `unit` after it fit on one line of `width` dp at `fontSize`, so the cell can print the full name. */
export function labelFits(label: string, unit: string | null, fontSize: number, width: number): boolean {
  const chars = label.length + (unit ? unit.length : 0);
  return chars * fontSize * LABEL_ASPECT + (unit ? LABEL_GAP : 0) <= width;
}

export interface FitOptions {
  min?: number;
  max?: number;
}

/**
 * Largest whole font size (dp) for `chars` digit-widths on one line inside `width` x `height`, where one digit is `aspect` x the font
 * size wide. Never below `min` (default 12) or above `max` (default 220); a degenerate box gives `min`.
 */
export function fitFontSize(width: number, height: number, chars: number, aspect: number, { min = 12, max = 220 }: FitOptions = {}): number {
  if (!(width > 0) || !(height > 0) || !(aspect > 0)) return min;
  const byHeight = height / LINE_RATIO;
  const byWidth = width / (Math.max(chars, 1) * aspect);
  return Math.min(max, Math.max(min, Math.floor(Math.min(byHeight, byWidth))));
}

export { LINE_RATIO };

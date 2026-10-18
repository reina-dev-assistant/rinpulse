/**
 * Where a horizontal chip row should scroll so one chip is fully visible, with a sliver of its neighbor showing past it so the row
 * reads as scrollable. Pure, so the rule is a plain function with a test.
 */

export interface ChipBox {
  x: number;
  width: number;
}

/** How much of the next chip stays in view beyond the one scrolled to. */
export const PEEK = 44;

/**
 * The scroll offset that shows `chip` inside a viewport of `viewport` dp, or `null` when it is already comfortably visible (a tap on
 * a visible chip must not make the row jump). `inset` is the row's own side padding; `content` bounds the result.
 */
export function scrollTargetFor(chip: ChipBox, offset: number, viewport: number, content: number, inset: number): number | null {
  if (viewport <= 0 || content <= viewport) return null;
  const maxOffset = content - viewport;
  const left = chip.x - inset;
  const right = chip.x + chip.width + inset;
  let target: number | null = null;
  if (left - PEEK < offset) target = left - PEEK;
  else if (right + PEEK > offset + viewport) target = right + PEEK - viewport;
  if (target === null) return null;
  const clamped = Math.min(maxOffset, Math.max(0, target));
  return Math.abs(clamped - offset) < 1 ? null : clamped;
}

/** Which edges have more chips behind them, for the fades. */
export function edgesFor(offset: number, viewport: number, content: number): { start: boolean; end: boolean } {
  if (viewport <= 0 || content <= viewport + 1) return { start: false, end: false };
  return { start: offset > 1, end: offset + viewport < content - 1 };
}

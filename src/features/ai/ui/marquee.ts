/** Timing of the title marquee, in milliseconds. */
export const MARQUEE = {
  /** Idle time before the first slide. */
  startMs: 2_000,
  /** Rest at the end before it slides back. */
  pauseMs: 1_500,
  /** The slide back to the start. */
  backMs: 450,
  /** From the start of one slide to the start of the next: no more often than this. */
  cycleMs: 8_000,
  /** The wait before a repeated round (the first round has `startMs`). */
  restartDelayMs: 0,
  /** Slide speed: milliseconds per pixel. */
  msPerPx: 22,
  minTravelMs: 600,
  maxTravelMs: 2_600,
  /** A title wider than its box by less than this is not worth moving (it would only be clipped by a few pixels). */
  minOverflowPx: 6,
} as const;

export interface MarqueePlan {
  travelMs: number;
  /** Quiet time after the slide back, so a whole cycle lasts `cycleMs`. */
  gapMs: number;
}

/** The plan for a title that is `overflow` pixels wider than its box, or null when it must stay still (it fits, or motion is reduced). */
export function marqueePlan(overflow: number, reducedMotion: boolean): MarqueePlan | null {
  if (reducedMotion || !Number.isFinite(overflow) || overflow < MARQUEE.minOverflowPx) return null;
  const travelMs = Math.min(MARQUEE.maxTravelMs, Math.max(MARQUEE.minTravelMs, Math.round(overflow * MARQUEE.msPerPx)));
  return { travelMs, gapMs: Math.max(1_000, MARQUEE.cycleMs - travelMs - MARQUEE.pauseMs - MARQUEE.backMs) };
}

/** Slide start to next slide start: slide + rest + back + quiet gap. */
export const cycleMs = (plan: MarqueePlan): number => plan.travelMs + MARQUEE.pauseMs + MARQUEE.backMs + plan.gapMs;

import { describe, expect, test } from 'bun:test';

import { cycleMs, MARQUEE, marqueePlan } from './marquee';

describe('title marquee plan', () => {
  test('a title that fits, or reduced motion, never moves', () => {
    expect(marqueePlan(0, false)).toBeNull();
    expect(marqueePlan(-30, false)).toBeNull();
    expect(marqueePlan(MARQUEE.minOverflowPx - 1, false)).toBeNull();
    expect(marqueePlan(200, true)).toBeNull();
    expect(marqueePlan(Number.NaN, false)).toBeNull();
  });
  test('a longer overflow takes longer to slide, within bounds', () => {
    expect(marqueePlan(10, false)!.travelMs).toBe(MARQUEE.minTravelMs);
    expect(marqueePlan(60, false)!.travelMs).toBe(60 * MARQUEE.msPerPx);
    expect(marqueePlan(5_000, false)!.travelMs).toBe(MARQUEE.maxTravelMs);
  });
  test('a slide starts no more often than every 8 seconds, whatever the length', () => {
    for (const overflow of [10, 60, 150, 1_000, 9_000]) expect(cycleMs(marqueePlan(overflow, false)!)).toBe(MARQUEE.cycleMs);
    expect(MARQUEE.startMs).toBe(2_000);
    expect(MARQUEE.pauseMs).toBe(1_500);
  });
});

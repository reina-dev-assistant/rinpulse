import { describe, expect, it } from 'bun:test';
import { REVEAL_MARGIN, revealDelta } from '@/components/keyboardReveal';

describe('revealDelta', () => {
  it('scrolls by the part of the input (plus margin) under the keyboard', () => {
    expect(revealDelta(900, 800, 0)).toBe(100);
    expect(revealDelta(900, 800)).toBe(100 + REVEAL_MARGIN);
  });
  it('is zero when the input already clears the keyboard', () => {
    expect(revealDelta(300, 800)).toBe(0);
  });
  it('rounds to whole pixels', () => {
    expect(revealDelta(800.4, 800, 0)).toBe(0);
    expect(revealDelta(800.6, 800, 0)).toBe(1);
  });
});

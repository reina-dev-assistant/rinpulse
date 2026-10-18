import { describe, expect, it } from 'bun:test';

import { edgesFor, PEEK, scrollTargetFor } from './chipScroll';

describe('scrollTargetFor', () => {
  it('does nothing when everything fits', () => {
    expect(scrollTargetFor({ x: 20, width: 80 }, 0, 400, 380, 20)).toBeNull();
  });
  it('leaves a chip that is already visible alone', () => {
    expect(scrollTargetFor({ x: 150, width: 90 }, 0, 400, 1000, 20)).toBeNull();
  });
  it('scrolls right to a chip past the right edge and leaves a peek of the next one', () => {
    const target = scrollTargetFor({ x: 600, width: 120 }, 0, 400, 1200, 20);
    expect(target).toBe(600 + 120 + 20 + PEEK - 400);
  });
  it('scrolls back left to a chip behind the left edge', () => {
    const target = scrollTargetFor({ x: 300, width: 100 }, 500, 400, 1200, 20);
    expect(target).toBe(300 - 20 - PEEK);
  });
  it('never goes past either end', () => {
    expect(scrollTargetFor({ x: 1100, width: 80 }, 0, 400, 1200, 20)).toBe(800);
    expect(scrollTargetFor({ x: 20, width: 80 }, 300, 400, 1200, 20)).toBe(0);
  });
  it('ignores an unmeasured viewport', () => {
    expect(scrollTargetFor({ x: 600, width: 120 }, 0, 0, 1200, 20)).toBeNull();
  });
});

describe('edgesFor', () => {
  it('shows a fade only on the sides with more chips', () => {
    expect(edgesFor(0, 400, 1000)).toEqual({ start: false, end: true });
    expect(edgesFor(300, 400, 1000)).toEqual({ start: true, end: true });
    expect(edgesFor(600, 400, 1000)).toEqual({ start: true, end: false });
  });
  it('has none when the row fits', () => {
    expect(edgesFor(0, 400, 400)).toEqual({ start: false, end: false });
  });
});

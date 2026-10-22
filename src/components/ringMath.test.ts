import { describe, expect, test } from 'bun:test';

import { dotGeometry, litDots, ringA11yValue, ringInnerWidth, ringRatio } from './ringMath';

describe('ringRatio', () => {
  test('0, 1, a day under the goal and the goal exactly', () => {
    expect(ringRatio(0, 8000)).toBe(0);
    expect(ringRatio(1, 8000)).toBe(1 / 8000);
    expect(ringRatio(7825, 8000)).toBe(7825 / 8000);
    expect(ringRatio(8000, 8000)).toBe(1);
  });
  test('past the goal is a full ring, however far past', () => {
    expect(ringRatio(30_000, 8000)).toBe(1);
    expect(ringRatio(100_000, 8000)).toBe(1);
    expect(ringRatio(Infinity, 8000)).toBe(1);
  });
  test('a goal of 0, negative, NaN or Infinity is an empty ring, not NaN', () => {
    for (const goal of [0, -5, NaN]) expect(ringRatio(30_000, goal)).toBe(0);
    expect(ringRatio(30_000, Infinity)).toBe(0);
    expect(ringRatio(100_000, 100_000)).toBe(1);
  });
  test('a value that is NaN or negative is empty', () => {
    expect(ringRatio(NaN, 8000)).toBe(0);
    expect(ringRatio(-1, 8000)).toBe(0);
    expect(ringRatio(-Infinity, 8000)).toBe(0);
  });
});

describe('dotGeometry', () => {
  test('the Today hero ring: 120 wide, 11 dots, a whole number of them', () => {
    const g = dotGeometry(120, 11);
    expect(g.count).toBe(16);
    expect(g.pitch * g.count).toBeCloseTo(g.circumference, 9);
    expect(g.r).toBe(54.5);
  });
  test('a small ring still has at least 12 dots', () => {
    expect(dotGeometry(40, 8).count).toBe(12);
  });
  test('a stroke of 0, wider than the ring or NaN stays finite', () => {
    for (const [size, stroke] of [[100, 0], [10, 40], [0, 0], [NaN, 5], [100, NaN]] as const) {
      const g = dotGeometry(size, stroke);
      expect(Number.isFinite(g.r)).toBe(true);
      expect(Number.isFinite(g.circumference)).toBe(true);
      expect(Number.isInteger(g.count)).toBe(true);
      expect(g.count).toBeGreaterThanOrEqual(12);
      expect(Number.isFinite(g.pitch)).toBe(true);
    }
  });
});

describe('litDots', () => {
  const count = 16;
  test('no progress lights nothing; a few steps light one dot, not none', () => {
    expect(litDots(0, count)).toBe(0);
    expect(litDots(ringRatio(0, 8000), count)).toBe(0);
    expect(litDots(ringRatio(1, 8000), count)).toBe(1);
    expect(litDots(1e-9, count)).toBe(1);
  });
  test('7,825 of 8,000 is 15 of 16 dots: not full until the goal is reached', () => {
    expect(litDots(ringRatio(7825, 8000), count)).toBe(15);
    expect(litDots(0.999, count)).toBe(15);
    expect(litDots(ringRatio(8000, 8000), count)).toBe(16);
  });
  test('30,000 and 100,000 of 8,000 light every dot, exactly once', () => {
    expect(litDots(ringRatio(30_000, 8000), count)).toBe(16);
    expect(litDots(ringRatio(100_000, 8000), count)).toBe(16);
  });
  test('half way is half the dots', () => {
    expect(litDots(0.5, count)).toBe(8);
  });
  test('a goal of 0 or NaN lights nothing', () => {
    expect(litDots(ringRatio(30_000, 0), count)).toBe(0);
    expect(litDots(ringRatio(30_000, NaN), count)).toBe(0);
    expect(litDots(NaN, count)).toBe(0);
  });
  test('never more than the ring has', () => {
    for (const ratio of [0, 0.01, 0.3, 0.97, 1, 5]) {
      const lit = litDots(ratio, count);
      expect(lit).toBeGreaterThanOrEqual(0);
      expect(lit).toBeLessThanOrEqual(count);
    }
  });
});

describe('ringA11yValue', () => {
  test('a day under, at and over the goal', () => {
    expect(ringA11yValue(7825, 8000)).toEqual({ min: 0, max: 8000, now: 7825 });
    expect(ringA11yValue(30_000, 8000)).toEqual({ min: 0, max: 8000, now: 8000 });
    expect(ringA11yValue(100_000, 100_000)).toEqual({ min: 0, max: 100_000, now: 100_000 });
  });
  test('0 steps is 0', () => {
    expect(ringA11yValue(0, 8000).now).toBe(0);
  });
  test('a goal of 0, NaN or Infinity announces 0 of 100, a value of NaN announces 0', () => {
    for (const goal of [0, NaN, Infinity, -1]) expect(ringA11yValue(30_000, goal)).toEqual({ min: 0, max: 100, now: 0 });
    expect(ringA11yValue(NaN, 8000)).toEqual({ min: 0, max: 8000, now: 0 });
  });
});

describe('ringInnerWidth', () => {
  test('the Today hero leaves 86 px for the steps', () => {
    expect(ringInnerWidth(120, 11)).toBe(86);
  });
  test('a stroke wider than the ring leaves nothing, not a negative width', () => {
    expect(ringInnerWidth(20, 30)).toBe(0);
  });
});

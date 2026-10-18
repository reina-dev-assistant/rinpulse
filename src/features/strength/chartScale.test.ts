import { describe, expect, it } from 'bun:test';

import { inRange, labelIndices, layoutBars, layoutLine, nearestIndex, niceDomain, niceStep, type Plot } from './chartScale';

const DAY = 86_400_000;
const plot: Plot = { width: 300, height: 200, left: 40, right: 10, top: 10, bottom: 20 };

describe('inRange', () => {
  const now = 400 * DAY;
  const points = [{ at: now - 380 * DAY }, { at: now - 200 * DAY }, { at: now - 100 * DAY }, { at: now - 10 * DAY }];
  it('keeps the points of the range', () => {
    expect(inRange(points, '3m', now).length).toBe(1);
    expect(inRange(points, '6m', now).length).toBe(2);
    expect(inRange(points, '1y', now).length).toBe(3);
    expect(inRange(points, 'all', now).length).toBe(4);
  });
  it('is empty for nothing', () => {
    expect(inRange([], '3m', now)).toEqual([]);
  });
});

describe('niceDomain', () => {
  it('rounds to round gridlines that cover the data', () => {
    const d = niceDomain(62, 84);
    expect(d.min).toBeLessThanOrEqual(62);
    expect(d.max).toBeGreaterThanOrEqual(84);
    expect(d.ticks[0]).toBe(d.min);
    expect(d.ticks[d.ticks.length - 1]).toBe(d.max);
    const steps = d.ticks.slice(1).map((t, i) => t - d.ticks[i]!);
    expect(new Set(steps.map((s) => Math.round(s * 1e6))).size).toBe(1);
  });
  it('starts at zero when asked', () => {
    expect(niceDomain(300, 900, 4, true).min).toBe(0);
  });
  it('handles a flat series without dividing by zero', () => {
    const d = niceDomain(80, 80);
    expect(d.max).toBeGreaterThan(d.min);
    expect(d.min).toBeLessThan(80);
    expect(d.max).toBeGreaterThan(80);
    const z = niceDomain(0, 0, 4, true);
    expect(z.max).toBeGreaterThan(0);
  });
  it('picks 1, 2, 2.5, 5 steps', () => {
    expect(niceStep(0.9)).toBe(1);
    expect(niceStep(1.4)).toBe(2);
    expect(niceStep(2.2)).toBe(2.5);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0)).toBe(1);
  });
});

describe('layoutLine', () => {
  it('has nothing to place for no points', () => {
    const l = layoutLine([], plot);
    expect(l.x).toEqual([]);
    expect(l.domain.ticks.length).toBeGreaterThan(1);
  });

  it('puts a single point in the middle', () => {
    const l = layoutLine([{ at: 5, value: 60 }], plot);
    expect(l.x[0]).toBe(40 + 125);
    expect(l.y[0]).toBeGreaterThan(10);
    expect(l.y[0]).toBeLessThan(180);
  });

  it('spreads many points by time inside the plot, higher values higher up', () => {
    const l = layoutLine(
      [
        { at: 0, value: 60 },
        { at: 10 * DAY, value: 70 },
        { at: 100 * DAY, value: 65 },
      ],
      plot,
    );
    expect(l.x[0]).toBe(40);
    expect(l.x[2]).toBe(290);
    expect(l.x[1]).toBeCloseTo(40 + 250 * 0.1, 5);
    expect(l.y[1]!).toBeLessThan(l.y[0]!);
    expect(l.y[1]!).toBeLessThan(l.y[2]!);
    for (const y of l.y) {
      expect(y).toBeGreaterThanOrEqual(10);
      expect(y).toBeLessThanOrEqual(180);
    }
  });

  it('centres points at the same instant', () => {
    const l = layoutLine([{ at: 5, value: 1 }, { at: 5, value: 2 }], plot);
    expect(l.x).toEqual([165, 165]);
  });
});

describe('layoutBars', () => {
  it('has no bars for no points', () => {
    expect(layoutBars([], plot).x).toEqual([]);
  });

  it('draws one bar for one point, capped in width, from the base up', () => {
    const l = layoutBars([{ at: 1, value: 500 }], plot);
    expect(l.barWidth).toBe(28);
    expect(l.y[0]!).toBeLessThan(l.base);
    expect(l.x[0]! + l.barWidth).toBeLessThanOrEqual(290);
  });

  it('keeps bars at least 2 px wide with very many points and inside the plot', () => {
    const points = Array.from({ length: 400 }, (_, i) => ({ at: i, value: 100 + (i % 7) }));
    const l = layoutBars(points, plot);
    expect(l.barWidth).toBe(2);
    expect(l.x[0]!).toBeGreaterThanOrEqual(40 - 1);
    expect(l.x[399]! + 2).toBeLessThanOrEqual(291);
  });
});

describe('nearestIndex and labels', () => {
  it('finds the closest point to a touch', () => {
    expect(nearestIndex([10, 50, 90], 60)).toBe(1);
    expect(nearestIndex([10, 50, 90], 1000)).toBe(2);
    expect(nearestIndex([], 5)).toBe(-1);
  });
  it('labels the ends, the middle when wide', () => {
    expect(labelIndices(0, true)).toEqual([]);
    expect(labelIndices(1, true)).toEqual([0]);
    expect(labelIndices(2, true)).toEqual([0, 1]);
    expect(labelIndices(9, true)).toEqual([0, 4, 8]);
    expect(labelIndices(9, false)).toEqual([0, 8]);
  });
});

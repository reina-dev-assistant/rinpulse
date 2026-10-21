import { describe, expect, test } from 'bun:test';

import { bucketAt, labelLeft, labelledBars, labelsFit, nextSelection, pointAt, slotCenter } from './barScrub';

describe('bucketAt', () => {
  test('maps x to equal slots', () => {
    expect(bucketAt(0, 0, 100, 4)).toBe(0);
    expect(bucketAt(24.9, 0, 100, 4)).toBe(0);
    expect(bucketAt(25, 0, 100, 4)).toBe(1);
    expect(bucketAt(99, 0, 100, 4)).toBe(3);
  });
  test('the right edge belongs to the last bar', () => {
    expect(bucketAt(100, 0, 100, 4)).toBe(3);
  });
  test('honours the left inset', () => {
    expect(bucketAt(5, 10, 100, 4)).toBe(-1);
    expect(bucketAt(10, 10, 100, 4)).toBe(0);
    expect(bucketAt(60, 10, 100, 4)).toBe(2);
  });
  test('outside or degenerate input finds nothing', () => {
    expect(bucketAt(101, 0, 100, 4)).toBe(-1);
    expect(bucketAt(-1, 0, 100, 4)).toBe(-1);
    expect(bucketAt(10, 0, 100, 0)).toBe(-1);
    expect(bucketAt(10, 0, 0, 4)).toBe(-1);
    expect(bucketAt(NaN, 0, 100, 4)).toBe(-1);
  });
});

describe('nextSelection', () => {
  test('a tap selects, a second tap on the same bar clears', () => {
    expect(nextSelection(null, 2, false)).toBe(2);
    expect(nextSelection(2, 2, false)).toBeNull();
    expect(nextSelection(2, 3, false)).toBe(3);
  });
  test('a drag keeps the bar it ends on', () => {
    expect(nextSelection(2, 2, true)).toBe(2);
  });
  test('a touch outside any bar clears', () => {
    expect(nextSelection(2, -1, false)).toBeNull();
    expect(nextSelection(2, -1, true)).toBeNull();
  });
});

describe('labels', () => {
  test('fit only for few, wide-enough slots', () => {
    expect(labelsFit(7, 300, 5)).toBe(true);
    expect(labelsFit(12, 300, 5)).toBe(false);
    expect(labelsFit(13, 900, 2)).toBe(false);
    expect(labelsFit(0, 300, 2)).toBe(false);
  });
  test('falls back to the highlighted bar only', () => {
    expect([...labelledBars(24, 300, ['1', '2'], 5)]).toEqual([5]);
    expect([...labelledBars(24, 300, ['1', '2'], null)]).toEqual([]);
    expect([...labelledBars(3, 300, ['1', '2', '3'], 1)]).toEqual([0, 1, 2]);
  });
  test('the selected bar is left to the readout', () => {
    expect([...labelledBars(24, 300, ['1', '2'], null, 5)]).toEqual([]);
    expect([...labelledBars(3, 300, ['1', '2', '3'], null, 1)]).toEqual([0, 2]);
    expect([...labelledBars(24, 300, ['1', '2'], 5, 5)]).toEqual([]);
    expect([...labelledBars(24, 300, ['1', '2'], 5, 7)]).toEqual([5]);
  });
});

describe('slotCenter', () => {
  test('centres of equal slots with gaps', () => {
    expect(slotCenter(0, 4, 100, 0)).toBe(12.5);
    expect(slotCenter(3, 4, 100, 0)).toBe(87.5);
    // 24 slots of 10px and 3px gaps: width 24 * 10 + 23 * 3.
    expect(slotCenter(0, 24, 309, 3)).toBe(5);
    expect(slotCenter(23, 24, 309, 3)).toBe(304);
  });
  test('no slots', () => {
    expect(slotCenter(0, 0, 100, 3)).toBe(0);
  });
});

describe('labelLeft', () => {
  test('centres on the bar when there is room', () => {
    expect(labelLeft(100, 30, 300)).toBe(85);
  });
  test('slides in at the left edge', () => {
    expect(labelLeft(5, 30, 300)).toBe(0);
    expect(labelLeft(5, 30, 300, 6)).toBe(6);
  });
  test('slides in at the right edge', () => {
    expect(labelLeft(304, 30, 309)).toBe(279);
    expect(labelLeft(304, 30, 309, 6)).toBe(273);
  });
  test('a label wider than the chart starts at the edge, never off to the left', () => {
    expect(labelLeft(50, 120, 100)).toBe(0);
  });
});

describe('pointAt', () => {
  test('snaps to the nearest of evenly spaced points', () => {
    expect(pointAt(0, 5, 100, 5)).toBe(0);
    expect(pointAt(5, 5, 100, 5)).toBe(0);
    expect(pointAt(29, 5, 100, 5)).toBe(1);
    expect(pointAt(31, 5, 100, 5)).toBe(1);
    expect(pointAt(105, 5, 100, 5)).toBe(4);
  });
  test('a lone point and off-chart touches', () => {
    expect(pointAt(50, 5, 100, 1)).toBe(0);
    expect(pointAt(300, 5, 100, 5)).toBe(-1);
    expect(pointAt(50, 5, 100, 0)).toBe(-1);
  });
});

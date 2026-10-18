import { describe, expect, test } from 'bun:test';

import { DIGIT_ASPECT, fitFontSize, labelFits, LINE_RATIO, textUnits } from './fitText';

describe('fitFontSize', () => {
  test('a short value is limited by the height', () => {
    expect(fitFontSize(400, 100, 1, 0.6)).toBe(Math.floor(100 / LINE_RATIO));
  });

  test('a long value is limited by the width', () => {
    expect(fitFontSize(200, 400, 5, 0.6)).toBe(66);
  });

  test('more characters never give a bigger size', () => {
    let last = Infinity;
    for (let chars = 1; chars <= 10; chars++) {
      const size = fitFontSize(300, 180, chars, DIGIT_ASPECT);
      expect(size).toBeLessThanOrEqual(last);
      last = size;
    }
  });

  test('a bigger box never gives a smaller size', () => {
    expect(fitFontSize(300, 200, 4, 0.6)).toBeGreaterThanOrEqual(fitFontSize(200, 150, 4, 0.6));
  });

  test('the text fits the box at the size it returns', () => {
    for (const [w, h, chars] of [[180, 120, 4], [360, 90, 7], [90, 90, 2], [640, 300, 3]] as const) {
      const size = fitFontSize(w, h, chars, DIGIT_ASPECT);
      expect(size * DIGIT_ASPECT * chars).toBeLessThanOrEqual(w + 1e-9);
      expect(size * LINE_RATIO).toBeLessThanOrEqual(h + 1e-9);
    }
  });

  test('is a whole number, clamped to min and max', () => {
    expect(Number.isInteger(fitFontSize(333, 177, 4.4, DIGIT_ASPECT))).toBe(true);
    expect(fitFontSize(10, 10, 8, 0.6)).toBe(12);
    expect(fitFontSize(10_000, 10_000, 1, 0.6)).toBe(220);
    expect(fitFontSize(10_000, 10_000, 1, 0.6, { max: 120 })).toBe(120);
    expect(fitFontSize(10, 10, 8, 0.6, { min: 20 })).toBe(20);
  });

  test('a degenerate box or aspect gives the minimum, never NaN', () => {
    expect(fitFontSize(0, 100, 3, 0.6)).toBe(12);
    expect(fitFontSize(100, -5, 3, 0.6)).toBe(12);
    expect(fitFontSize(100, 100, 3, 0)).toBe(12);
    expect(fitFontSize(Number.NaN, 100, 3, 0.6)).toBe(12);
  });

  test('zero characters counts as one', () => {
    expect(fitFontSize(100, 1000, 0, 0.5)).toBe(200);
  });
});

describe('textUnits', () => {
  test('digits count one, separators less', () => {
    expect(textUnits('28')).toBe(2);
    expect(textUnits('28,4')).toBeCloseTo(3.55, 10);
    expect(textUnits('1:23:45')).toBeCloseTo(6.2, 10);
    expect(textUnits('--')).toBeCloseTo(1.8, 10);
  });
  test('empty text is zero', () => {
    expect(textUnits('')).toBe(0);
  });
});

describe('labelFits', () => {
  test('a short name fits a narrow cell, a long one does not', () => {
    expect(labelFits('Kadens', 'rpm', 13, 170)).toBe(true);
    expect(labelFits('Kecepatan rata-rata', 'km/j', 13, 170)).toBe(false);
  });
  test('the unit takes room too', () => {
    expect(labelFits('Detak jantung', null, 13, 110)).toBe(true);
    expect(labelFits('Detak jantung', 'bpm', 13, 110)).toBe(false);
  });
  test('a bigger font or a narrower cell never makes it fit', () => {
    expect(labelFits('Jarak ke finis', 'km', 13, 150)).toBe(true);
    expect(labelFits('Jarak ke finis', 'km', 18, 150)).toBe(false);
    expect(labelFits('Jarak ke finis', 'km', 13, 60)).toBe(false);
  });
});

import { describe, expect, test } from 'bun:test';

import { canStep, stepValue } from './stepMath';

const km = { min: 1000, max: 100_000, step: 1000 };

describe('stepValue', () => {
  test('moves by one step', () => {
    expect(stepValue(5000, 1, km)).toBe(6000);
    expect(stepValue(5000, -1, km)).toBe(4000);
  });

  test('stops at the ends', () => {
    expect(stepValue(1000, -1, km)).toBe(1000);
    expect(stepValue(100_000, 1, km)).toBe(100_000);
  });

  test('a value off the grid snaps to the next grid point in that direction', () => {
    expect(stepValue(5300, 1, km)).toBe(6000);
    expect(stepValue(5300, -1, km)).toBe(5000);
  });

  test('a value outside the range comes back inside', () => {
    expect(stepValue(500, 1, km)).toBe(1000);
    expect(stepValue(250_000, -1, km)).toBe(100_000);
  });

  test('works with a step that is not 1 and a minimum that is not 0', () => {
    const offCourse = { min: 30, max: 200, step: 10 };
    expect(stepValue(50, 1, offCourse)).toBe(60);
    expect(stepValue(35, -1, offCourse)).toBe(30);
  });
});

describe('canStep', () => {
  test('false at the ends, true between', () => {
    expect(canStep(1000, -1, km)).toBe(false);
    expect(canStep(100_000, 1, km)).toBe(false);
    expect(canStep(5000, -1, km)).toBe(true);
    expect(canStep(5000, 1, km)).toBe(true);
  });
});

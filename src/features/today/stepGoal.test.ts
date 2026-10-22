import { describe, expect, test } from 'bun:test';

import { DEFAULT_STEP_GOAL, MAX_STEP_GOAL, MIN_STEP_GOAL, parseStepGoal, stepGoalOf } from './stepGoal';

describe('parseStepGoal', () => {
  test('whole numbers in range, at both ends', () => {
    expect(parseStepGoal('8000')).toBe(8000);
    expect(parseStepGoal(' 10000 ')).toBe(10_000);
    expect(parseStepGoal('1000')).toBe(MIN_STEP_GOAL);
    expect(parseStepGoal('100000')).toBe(MAX_STEP_GOAL);
    expect(parseStepGoal('99999')).toBe(99_999);
  });
  test('one past either end is refused', () => {
    expect(parseStepGoal('999')).toBeNull();
    expect(parseStepGoal('100001')).toBeNull();
    expect(parseStepGoal('0')).toBeNull();
    expect(parseStepGoal('65536000')).toBeNull();
  });
  test('thousands separators typed or pasted are read, in both languages', () => {
    expect(parseStepGoal('30.000')).toBe(30_000);
    expect(parseStepGoal('30,000')).toBe(30_000);
    expect(parseStepGoal('100.000')).toBe(100_000);
    expect(parseStepGoal('10 000')).toBe(10_000);
    expect(parseStepGoal('10\u00a0000')).toBe(10_000);
  });
  test('anything else is refused: decimals, exponents, hex, signs, words, empty', () => {
    for (const text of ['12.5', '12,5', '1e4', '0x2710', '-8000', '+8000', '8k', 'abc', '', '  ', '1.00.000', '10.0000', 'NaN', 'Infinity']) {
      expect({ text, goal: parseStepGoal(text) }).toEqual({ text, goal: null });
    }
  });
});

describe('stepGoalOf', () => {
  test('a saved goal is the goal', () => {
    expect(stepGoalOf(8000)).toEqual({ goal: 8000, isDefault: false });
    expect(stepGoalOf(100_000)).toEqual({ goal: 100_000, isDefault: false });
  });
  test('no profile, 0, negative, NaN and Infinity are the default', () => {
    for (const saved of [undefined, null, 0, -1, NaN, Infinity, -Infinity]) {
      expect({ saved, goal: stepGoalOf(saved) }).toEqual({ saved, goal: { goal: DEFAULT_STEP_GOAL, isDefault: true } });
    }
  });
  test('a goal above the watch maximum is held to it, a fraction is rounded', () => {
    expect(stepGoalOf(150_000)).toEqual({ goal: MAX_STEP_GOAL, isDefault: false });
    expect(stepGoalOf(65_536)).toEqual({ goal: 65_536, isDefault: false });
    expect(stepGoalOf(8000.4)).toEqual({ goal: 8000, isDefault: false });
  });
});

import { describe, expect, test } from 'bun:test';

import { parseWeightKg, withWeight } from './weight';

const FALLBACK = { heightCm: 175, weightKg: 70, birthYear: 1990, sex: 'unknown' as const, dailyStepGoal: 8000 };

describe('parseWeightKg', () => {
  test('accepts a comma or a dot and rounds to 0.1 kg', () => {
    expect(parseWeightKg('72,5')).toBe(72.5);
    expect(parseWeightKg(' 80.04 ')).toBe(80);
  });
  test('rejects what is not a body weight', () => {
    expect(parseWeightKg('')).toBeNull();
    expect(parseWeightKg('abc')).toBeNull();
    expect(parseWeightKg('19')).toBeNull();
    expect(parseWeightKg('301')).toBeNull();
  });
});

describe('withWeight', () => {
  test('changes only the weight of a stored profile', () => {
    const stored = { heightCm: 168, weightKg: 60, birthYear: 1985, sex: 'female' as const, dailyStepGoal: 10000 };
    expect(withWeight(stored, 62, FALLBACK)).toEqual({ ...stored, weightKg: 62 });
  });
  test('starts from the fallback when nothing was stored', () => {
    expect(withWeight(null, 82, FALLBACK)).toEqual({ ...FALLBACK, weightKg: 82 });
  });
});

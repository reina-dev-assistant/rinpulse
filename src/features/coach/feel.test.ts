import { describe, expect, test } from 'bun:test';

import { FEELS, feelReadiness, parseFeel, serializeFeel } from './feel';

describe('feel', () => {
  test('every answer counts as a readiness word, in order', () => {
    expect(FEELS.map(feelReadiness)).toEqual(['Primed', 'Balanced', 'Strained', 'Run down']);
  });

  test('an answer is kept for the day it was given', () => {
    const raw = serializeFeel('2026-10-18', 'tired');
    expect(parseFeel(raw, '2026-10-18')).toBe('tired');
    expect(parseFeel(raw, '2026-10-19')).toBeNull();
  });

  test('nothing, garbage and unknown answers are null', () => {
    expect(parseFeel(null, '2026-10-18')).toBeNull();
    expect(parseFeel('{', '2026-10-18')).toBeNull();
    expect(parseFeel(JSON.stringify({ day: '2026-10-18', feel: 'meh' }), '2026-10-18')).toBeNull();
  });
});

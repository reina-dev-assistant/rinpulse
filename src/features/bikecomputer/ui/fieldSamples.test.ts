import { describe, expect, test } from 'bun:test';

import { FIELD_IDS } from '../types';
import { sampleContext, sampleElevation, sampleFieldValue } from './fieldSamples';
import { stripGeometry } from './elevationGeometry';

describe('field samples', () => {
  test('every field has an example value, never the dashes', () => {
    for (const id of FIELD_IDS) {
      const value = sampleFieldValue(id, sampleContext());
      expect(`${id}: ${value.value}`).not.toBe(`${id}: --`);
      expect(value.value.length).toBeGreaterThan(0);
    }
  });

  test('the same call gives the same text (the instant is fixed)', () => {
    expect(sampleFieldValue('timeOfDay').value).toBe(sampleFieldValue('timeOfDay').value);
  });

  test('the sample profile is drawable', () => {
    expect(stripGeometry(sampleElevation(), 300, 100)).not.toBeNull();
  });
});

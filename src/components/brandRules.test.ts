import { describe, expect, test } from 'bun:test';

import { brandAllowed } from './brandRules';

describe('brandAllowed', () => {
  test('Apple Health shows on iOS only', () => {
    expect(brandAllowed('apple-health', 'ios')).toBe(true);
    expect(brandAllowed('apple-health', 'android')).toBe(false);
    expect(brandAllowed('apple-health', 'web')).toBe(false);
  });

  test('Health Connect shows on Android only', () => {
    expect(brandAllowed('health-connect', 'android')).toBe(true);
    expect(brandAllowed('health-connect', 'ios')).toBe(false);
  });

  test('Strava shows everywhere', () => {
    expect(brandAllowed('strava', 'ios')).toBe(true);
    expect(brandAllowed('strava', 'android')).toBe(true);
  });
});

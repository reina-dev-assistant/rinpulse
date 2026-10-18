import { describe, expect, test } from 'bun:test';

import { effortKind } from '@/features/share/shareStats';

describe('effortKind', () => {
  test('picks the unit that fits the sport', () => {
    expect(effortKind('Pool swimming')).toBe('pace100m');
    expect(effortKind('Open water swim')).toBe('pace100m');
    expect(effortKind('Outdoor run')).toBe('paceKm');
    expect(effortKind('Indoor walking')).toBe('paceKm');
    expect(effortKind('Hiking')).toBe('paceKm');
    expect(effortKind('Outdoor cycling')).toBe('speed');
    expect(effortKind('Rowing machine')).toBe('speed');
  });
});

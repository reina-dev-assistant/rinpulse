import { describe, expect, test } from 'bun:test';

import { shouldWarnUnsigned } from '@/features/watchfaces/unsignedWarning';

describe('shouldWarnUnsigned', () => {
  test('warns for a user .hwt when the watch requires signatures', () => {
    expect(shouldWarnUnsigned({ requiresSignature: true }, 'user-hwt')).toBe(true);
  });
  test('does not warn when the bit is unset', () => {
    expect(shouldWarnUnsigned({ requiresSignature: false }, 'user-hwt')).toBe(false);
  });
  test('does not warn when the capability is unknown', () => {
    expect(shouldWarnUnsigned({ requiresSignature: null }, 'user-hwt')).toBe(false);
    expect(shouldWarnUnsigned({}, 'user-hwt')).toBe(false);
    expect(shouldWarnUnsigned(null, 'user-hwt')).toBe(false);
  });
  test('never warns for photo faces or Huawei faces', () => {
    expect(shouldWarnUnsigned({ requiresSignature: true }, 'photo')).toBe(false);
    expect(shouldWarnUnsigned({ requiresSignature: true }, 'huawei')).toBe(false);
  });
});

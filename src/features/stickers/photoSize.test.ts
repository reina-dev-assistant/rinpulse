import { describe, expect, test } from 'bun:test';

import { PHOTO_MAX_SIDE, photoTargetSize } from './photoSize';

describe('photoTargetSize', () => {
  test('keeps a photo that already fits', () => {
    expect(photoTargetSize({ width: 1600, height: 1200 })).toEqual({ width: 1600, height: 1200, resize: false });
    expect(photoTargetSize({ width: PHOTO_MAX_SIDE, height: 900 }).resize).toBe(false);
  });

  test('scales the longest side down to the limit, keeping the ratio', () => {
    expect(photoTargetSize({ width: 4000, height: 3000 })).toEqual({ width: 2048, height: 1536, resize: true });
    expect(photoTargetSize({ width: 3024, height: 4032 })).toEqual({ width: 1536, height: 2048, resize: true });
  });

  test('a 48 MP photo lands within the limit', () => {
    const out = photoTargetSize({ width: 8000, height: 6000 });
    expect(Math.max(out.width, out.height)).toBe(PHOTO_MAX_SIDE);
  });

  test('a custom limit and bad sizes', () => {
    expect(photoTargetSize({ width: 2000, height: 1000 }, 1000)).toEqual({ width: 1000, height: 500, resize: true });
    expect(photoTargetSize({ width: 0, height: 0 }).resize).toBe(false);
    expect(photoTargetSize({ width: Number.NaN, height: 100 }).resize).toBe(false);
  });
});

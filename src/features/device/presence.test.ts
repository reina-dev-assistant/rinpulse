import { describe, expect, test } from 'bun:test';

import { presenceOf, showsWatchUi } from './presence';

const NOTHING = { linked: false, remembered: false, stored: false, hasData: false };

describe('presenceOf', () => {
  test('a phone that never saw a watch has none', () => {
    expect(presenceOf(NOTHING)).toBe('none');
  });
  test('any trace of a paired watch is a watch', () => {
    expect(presenceOf({ ...NOTHING, linked: true })).toBe('watch');
    expect(presenceOf({ ...NOTHING, remembered: true })).toBe('watch');
    expect(presenceOf({ ...NOTHING, stored: true })).toBe('watch');
  });
  test('imported watch data without a watch is data', () => {
    expect(presenceOf({ ...NOTHING, hasData: true })).toBe('data');
    expect(presenceOf({ ...NOTHING, hasData: true, stored: true })).toBe('watch');
  });
  test('only none hides the watch screens', () => {
    expect(showsWatchUi('none')).toBe(false);
    expect(showsWatchUi('data')).toBe(true);
    expect(showsWatchUi('watch')).toBe(true);
  });
});

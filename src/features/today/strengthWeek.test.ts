import { describe, expect, test } from 'bun:test';

import { strengthGlance } from './strengthWeek';

const DAY = 86_400_000;
const now = 100 * DAY;

describe('strengthGlance', () => {
  test('nothing logged', () => {
    expect(strengthGlance([], now)).toEqual({ lastAt: null, lastName: '', lastWeek: 0 });
  });
  test('the newest workout and the count of the past 7 days', () => {
    const g = strengthGlance(
      [
        { startedAt: now - 10 * DAY, name: 'old' },
        { startedAt: now - 2 * DAY, name: 'push' },
        { startedAt: now - 5 * DAY, name: 'pull' },
      ],
      now,
    );
    expect(g).toEqual({ lastAt: now - 2 * DAY, lastName: 'push', lastWeek: 2 });
  });
});

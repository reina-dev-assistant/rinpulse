import { describe, expect, test } from 'bun:test';

import { initDim, msUntilDim, stepDim, type DimConfig } from './dimMachine';

const on: DimConfig = { enabled: true, afterSec: 20 };
const off: DimConfig = { enabled: false, afterSec: 20 };

describe('stepDim', () => {
  test('stays bright before the timeout and dims at it', () => {
    const s0 = initDim(1000);
    expect(stepDim(s0, { type: 'tick', nowMs: 20_999 }, on).dimmed).toBe(false);
    expect(stepDim(s0, { type: 'tick', nowMs: 21_000 }, on).dimmed).toBe(true);
  });

  test('a touch restarts the idle clock', () => {
    let s = initDim(0);
    s = stepDim(s, { type: 'touch', nowMs: 15_000 }, on);
    s = stepDim(s, { type: 'tick', nowMs: 30_000 }, on);
    expect(s.dimmed).toBe(false);
    s = stepDim(s, { type: 'tick', nowMs: 35_000 }, on);
    expect(s.dimmed).toBe(true);
  });

  test('a touch wakes a dimmed screen', () => {
    const dimmed = stepDim(initDim(0), { type: 'tick', nowMs: 25_000 }, on);
    expect(dimmed.dimmed).toBe(true);
    const woke = stepDim(dimmed, { type: 'touch', nowMs: 26_000 }, on);
    expect(woke).toEqual({ dimmed: false, lastActiveMs: 26_000 });
  });

  test('an alert wakes a dimmed screen and restarts the clock', () => {
    const dimmed = stepDim(initDim(0), { type: 'tick', nowMs: 25_000 }, on);
    const woke = stepDim(dimmed, { type: 'alert', nowMs: 40_000 }, on);
    expect(woke.dimmed).toBe(false);
    expect(stepDim(woke, { type: 'tick', nowMs: 59_999 }, on).dimmed).toBe(false);
    expect(stepDim(woke, { type: 'tick', nowMs: 60_000 }, on).dimmed).toBe(true);
  });

  test('ticks while dimmed change nothing', () => {
    const dimmed = stepDim(initDim(0), { type: 'tick', nowMs: 25_000 }, on);
    expect(stepDim(dimmed, { type: 'tick', nowMs: 99_000 }, on)).toBe(dimmed);
  });

  test('disabled never dims', () => {
    const s = stepDim(initDim(0), { type: 'tick', nowMs: 10 * 60_000 }, off);
    expect(s.dimmed).toBe(false);
  });

  test('turning the setting off while dimmed wakes the screen on the next tick', () => {
    const dimmed = stepDim(initDim(0), { type: 'tick', nowMs: 25_000 }, on);
    expect(stepDim(dimmed, { type: 'tick', nowMs: 26_000 }, off).dimmed).toBe(false);
  });

  test('a shorter timeout applies to the idle time already spent', () => {
    const s = initDim(0);
    expect(stepDim(s, { type: 'tick', nowMs: 8000 }, { enabled: true, afterSec: 5 }).dimmed).toBe(true);
  });
});

describe('msUntilDim', () => {
  test('counts down from the last activity', () => {
    expect(msUntilDim(initDim(1000), on, 6000)).toBe(15_000);
  });
  test('is zero once overdue, null when dimmed or disabled', () => {
    expect(msUntilDim(initDim(0), on, 99_000)).toBe(0);
    expect(msUntilDim({ dimmed: true, lastActiveMs: 0 }, on, 5000)).toBeNull();
    expect(msUntilDim(initDim(0), off, 5000)).toBeNull();
  });
});

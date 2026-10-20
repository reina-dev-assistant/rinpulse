import { describe, expect, it } from 'bun:test';

import { ownTotalsOf, type WatchTotals } from './watchDayTotals';

const MINE = 'AA:AA:AA:AA:AA:01';
const BAND = 'BB:BB:BB:BB:BB:02';
const DAY = 1_790_000_000;

const mine = { address: MINE, tracksHealth: true };
const band = { address: BAND, tracksHealth: true };
const guestBand = { address: BAND, tracksHealth: false };

const totals = (address: string | null, steps: number, at = DAY + 600): WatchTotals => ({ steps, calories: 10, distance: 100, at, address });

describe('ownTotalsOf: which watch counter may stand for the day on Today', () => {
  it('a phone with one watch shows that watch counter', () => {
    const t = totals(MINE, 8_200);
    expect(ownTotalsOf(t, [mine], DAY)).toBe(t);
  });

  it('a borrowed band connected next to the owner watch never puts its counter on the ring', () => {
    // Salim's report: the band reports its own (near zero) day; the stored minutes are his.
    expect(ownTotalsOf(totals(BAND, 0), [mine, band], DAY)).toBeNull();
    expect(ownTotalsOf(totals(BAND, 312), [mine, band], DAY)).toBeNull();
  });

  it('with two watches that store health data the day is the merged minutes, even for the owner counter', () => {
    expect(ownTotalsOf(totals(MINE, 8_200), [mine, band], DAY)).toBeNull();
  });

  it('a guest band that stores nothing is ignored and the owner counter stands again', () => {
    expect(ownTotalsOf(totals(MINE, 8_200), [mine, guestBand], DAY)?.steps).toBe(8_200);
    // The guest sync reports zeros (nothing stored): not the day either.
    expect(ownTotalsOf(totals(BAND, 0), [mine, guestBand], DAY)).toBeNull();
  });

  it('switching back to the owner watch while the guest has health off shows the owner counter again', () => {
    expect(ownTotalsOf(totals(BAND, 0), [mine, guestBand], DAY)).toBeNull();
    expect(ownTotalsOf(totals(MINE, 9_100), [mine, guestBand], DAY)?.steps).toBe(9_100);
  });

  it('a counter of an earlier day, or no counter, is never used', () => {
    expect(ownTotalsOf(totals(MINE, 8_200, DAY - 1), [mine], DAY)).toBeNull();
    expect(ownTotalsOf(null, [mine], DAY)).toBeNull();
  });

  it('a counter whose watch is unknown is not used once there is more than one watch row, and is used on a one-watch phone', () => {
    expect(ownTotalsOf(totals(null, 500), [mine, guestBand], DAY)).toBeNull();
    expect(ownTotalsOf(totals(null, 500), [mine], DAY)?.steps).toBe(500);
  });

  it('before the watch list has loaded the counter is used as it always was', () => {
    const t = totals(MINE, 8_200);
    expect(ownTotalsOf(t, [], DAY)).toBe(t);
  });
});

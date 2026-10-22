import { describe, expect, it } from 'bun:test';

import { addDays } from '@/features/trends/series';

import { anchorFor, bucketsOf, canStepForward, daysOf, holdsToday, periodFor, shiftAnchor } from './range';

/** Local midnight of 2026-10-22 (a Thursday). */
const THU = Math.floor(new Date(2026, 9, 22).getTime() / 1000);
const local = (y: number, m: number, d: number) => Math.floor(new Date(y, m - 1, d).getTime() / 1000);

describe('periodFor', () => {
  it('a week runs Monday to Sunday', () => {
    const p = periodFor('W', THU);
    expect(p.from).toBe(local(2026, 10, 19));
    expect(p.to).toBe(local(2026, 10, 26));
  });

  it('a month is the calendar month and a year the calendar year', () => {
    expect(periodFor('M', THU)).toMatchObject({ from: local(2026, 10, 1), to: local(2026, 11, 1) });
    expect(periodFor('Y', THU)).toMatchObject({ from: local(2026, 1, 1), to: local(2027, 1, 1) });
  });

  it('three months are thirteen weeks that end with the anchor week', () => {
    const p = periodFor('3M', THU);
    expect(p.to).toBe(local(2026, 10, 26));
    expect(bucketsOf(p)).toHaveLength(13);
    expect(p.from).toBe(local(2026, 7, 27));
  });
});

describe('bucketsOf', () => {
  it('counts hours, days, weeks and months', () => {
    expect(bucketsOf(periodFor('D', THU))).toHaveLength(24);
    expect(bucketsOf(periodFor('W', THU))).toHaveLength(7);
    expect(bucketsOf(periodFor('M', THU))).toHaveLength(31);
    expect(bucketsOf(periodFor('M', local(2026, 2, 10)))).toHaveLength(28);
    expect(bucketsOf(periodFor('Y', THU))).toHaveLength(12);
  });

  it('buckets abut with no gap or overlap', () => {
    for (const range of ['W', 'M', '3M', 'Y'] as const) {
      const b = bucketsOf(periodFor(range, THU));
      for (let i = 1; i < b.length; i++) expect(b[i].from).toBe(b[i - 1].to);
    }
  });

  it('daysOf lists every local midnight, also over a daylight-saving change', () => {
    const march = periodFor('M', local(2026, 3, 15));
    expect(daysOf(march)).toHaveLength(31);
    expect(daysOf(periodFor('Y', THU))).toHaveLength(365);
  });
});

describe('stepping', () => {
  it('moves by one period each way and lands on a period that abuts the old one', () => {
    for (const range of ['D', 'W', 'M', '3M', 'Y'] as const) {
      const now = periodFor(range, THU);
      const before = periodFor(range, shiftAnchor(now, -1));
      expect(before.to).toBe(now.from);
      const forth = periodFor(range, shiftAnchor(before, 1));
      expect(forth.from).toBe(now.from);
    }
  });

  it('cannot step past a period that holds today', () => {
    expect(holdsToday(periodFor('W', THU), THU)).toBe(true);
    expect(canStepForward(periodFor('W', THU), THU)).toBe(false);
    expect(canStepForward(periodFor('W', addDays(THU, -7)), THU)).toBe(true);
    expect(canStepForward(periodFor('D', addDays(THU, -1)), THU)).toBe(true);
    expect(canStepForward(periodFor('D', THU), THU)).toBe(false);
  });

  it('keeps the day in view when the range changes, never past today', () => {
    expect(anchorFor(periodFor('W', local(2026, 10, 20)), THU)).toBe(local(2026, 10, 20));
    expect(anchorFor(periodFor('W', local(2026, 10, 30)), THU)).toBe(THU);
  });
});

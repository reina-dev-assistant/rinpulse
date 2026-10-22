import { describe, expect, it } from 'bun:test';

import { addDays } from '@/features/trends/series';
import { intensityMinutes, mondayOf, WEEKLY_TARGET_MIN } from './intensityMinutes';

type Zones = number[];
const local = (y: number, m: number, d: number, h = 0) => Math.floor(new Date(y, m - 1, d, h).getTime() / 1000);

describe('mondayOf', () => {
  it('goes back to Monday, Sunday included', () => {
    const monday = local(2026, 10, 12);
    expect(mondayOf(local(2026, 10, 12))).toBe(monday);
    expect(mondayOf(local(2026, 10, 14, 15))).toBe(monday);
    expect(mondayOf(local(2026, 10, 18, 23))).toBe(monday);
    expect(mondayOf(local(2026, 10, 19))).toBe(local(2026, 10, 19));
  });
});

describe('intensityMinutes', () => {
  const monday = local(2026, 10, 12);
  const day = (offset: number, zoneMinutes: Zones) => ({ day: addDays(monday, offset), zoneMinutes });

  it('counts zones 2 and 3 once and zones 4 and 5 twice, zone 1 not at all', () => {
    const w = intensityMinutes([day(0, [30, 20, 10, 5, 5])], monday, 'max');
    expect(w.moderate).toBe(30);
    expect(w.vigorous).toBe(10);
    expect(w.total).toBe(50);
    expect(w.days[0].total).toBe(50);
    expect(w.target).toBe(WEEKLY_TARGET_MIN);
    expect(w.target).toBe(150);
  });

  it('sums the week and keeps Monday to Sunday', () => {
    const w = intensityMinutes([day(0, [0, 40, 0, 0, 0]), day(3, [0, 0, 0, 30, 0]), day(6, [0, 0, 20, 0, 10])], monday, 'max');
    expect(w.days.length).toBe(7);
    expect(w.days.map((d) => d.total)).toEqual([40, 0, 0, 60, 0, 0, 40]);
    expect(w.total).toBe(140);
  });

  it('leaves days outside the week out and is zero when empty', () => {
    const w = intensityMinutes([day(-1, [0, 99, 0, 0, 0]), day(7, [0, 99, 0, 0, 0])], monday, 'max');
    expect(w.total).toBe(0);
    expect(intensityMinutes([], monday, 'max').total).toBe(0);
  });

  it('reserve method: warm-up and aerobic base are moderate, aerobic advance and up vigorous (Z1-Z6)', () => {
    const w = intensityMinutes([day(0, [10, 30, 20, 10, 5, 5])], monday, 'hrr');
    expect(w.moderate).toBe(40);
    expect(w.vigorous).toBe(40);
    expect(w.total).toBe(120);
    // The same minutes read as five maximum-method zones would be: zones 2-3 moderate, 4-5 vigorous.
    expect(intensityMinutes([day(0, [10, 30, 20, 10, 5])], monday, 'max').total).toBe(50 + 30);
  });
});

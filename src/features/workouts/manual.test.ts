import { describe, expect, test } from 'bun:test';

import { estimateManualKcal, manualRow, parseClock, parseKcal, parseKm, parseMinutes, startAt } from './manual';

describe('manual workout row', () => {
  test('a 5 km run: end, metres, pace and an estimated energy', () => {
    const row = manualRow({ sport: 'run', start: 1_000_000, minutes: 30, km: 5, kcal: null, weightKg: 70 });
    expect(row.end).toBe(1_000_000 + 1800);
    expect(row.distance).toBe(5000);
    expect(row.duration).toBe(1800);
    expect(row.type).toBe(1);
    expect(row.name).toBe('Run');
    expect(row.calories).toBe(Math.round(9.8 * 70 * 0.5));
    const summary = JSON.parse(row.summary);
    expect(summary.kind).toBe('RUNNING');
    expect(summary.avgPaceSecPerKm).toBeCloseTo(360, 5);
    expect(summary.gps).toBe('none');
    expect(summary.manual).toBe(true);
  });

  test("the person's own energy figure wins over the estimate", () => {
    expect(manualRow({ sport: 'ride', start: 0, minutes: 60, km: 20, kcal: 480, weightKg: 70 }).calories).toBe(480);
  });

  test('no distance means zero metres and no pace; a ride never shows pace', () => {
    const none = manualRow({ sport: 'other', start: 0, minutes: 45, km: null, kcal: null, weightKg: 60 });
    expect(none.distance).toBe(0);
    expect(JSON.parse(none.summary).avgSpeed).toBeUndefined();
    const ride = manualRow({ sport: 'ride', start: 0, minutes: 60, km: 25, kcal: null, weightKg: 60 });
    expect(JSON.parse(ride.summary).avgPaceSecPerKm).toBeUndefined();
    expect(JSON.parse(ride.summary).avgSpeed).toBeCloseTo(25000 / 3600, 5);
  });

  test('energy scales with weight and time', () => {
    expect(estimateManualKcal('walk', 60, 80)).toBe(Math.round(3.8 * 80));
    expect(estimateManualKcal('walk', 30, 80)).toBe(Math.round(3.8 * 40));
  });
});

describe('field parsing', () => {
  test('minutes', () => {
    expect(parseMinutes('45')).toBe(45);
    expect(parseMinutes('0')).toBeNull();
    expect(parseMinutes('1441')).toBeNull();
    expect(parseMinutes('abc')).toBeNull();
  });
  test('kilometres allow a comma and an empty field', () => {
    expect(parseKm('5,25')).toEqual({ ok: true, km: 5.25 });
    expect(parseKm('')).toEqual({ ok: true, km: null });
    expect(parseKm('-1')).toEqual({ ok: false });
    expect(parseKm('501')).toEqual({ ok: false });
  });
  test('energy: empty estimates, a figure is kept', () => {
    expect(parseKcal('')).toEqual({ ok: true, kcal: null });
    expect(parseKcal('350')).toEqual({ ok: true, kcal: 350 });
    expect(parseKcal('0')).toEqual({ ok: false });
  });
  test('clock', () => {
    expect(parseClock('7:05')).toEqual({ hour: 7, minute: 5 });
    expect(parseClock('18.30')).toEqual({ hour: 18, minute: 30 });
    expect(parseClock('0705')).toEqual({ hour: 7, minute: 5 });
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('7:60')).toBeNull();
    expect(parseClock('x')).toBeNull();
  });
  test('a start on a day before today', () => {
    const now = new Date(2026, 9, 18, 12, 0, 0);
    expect(startAt(now, 1, { hour: 6, minute: 30 })).toBe(Math.floor(new Date(2026, 9, 17, 6, 30).getTime() / 1000));
  });
});

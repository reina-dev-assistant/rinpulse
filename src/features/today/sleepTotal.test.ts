import { describe, expect, it } from 'bun:test';

import { recentNightsAsleep } from '@/features/fitness/sleepNeed';
import { buildNights, sleepByDay } from '@/features/sleep/nights';
import { sleepSeries } from '@/features/trends/series';
import { applyLocale } from '@/i18n';
import type { SleepSegment } from '@/wear';

import { readiness } from './readiness';
import { lastSleepSession } from './stats';

const H = 3600;
const MIN = 60;

/** Unix seconds of `clock` on 2026-10-`day`, device-local time (the day a session belongs to follows the local clock). */
function at(day: number, clock: string): number {
  const [h, m] = clock.split(':').map(Number);
  return Math.floor(new Date(2026, 9, day, h, m).getTime() / 1000);
}

function seg(start: number, end: number, stage: SleepSegment['stage'] = 'light'): SleepSegment {
  return { start, end, type: 6, stage };
}

const NEED = 7.5 * H;
const dayStart = at(18, '00:00');

// Night 4 h (23:00 to 03:00), woke on the 18th, then a 1 h 30 min nap that afternoon.
const night = [seg(at(17, '23:00'), at(18, '03:00'))];
const nap = [seg(at(18, '14:00'), at(18, '15:30'))];

const sleepSignal = (segments: SleepSegment[]) =>
  readiness({
    dayStart,
    resting: new Map(),
    strain: [],
    sleep: lastSleepSession(segments),
    hrv: { missing: 'HRV: nothing' },
  }).signals.find((s) => s.key === 'sleep');

describe('the day total of sleep includes naps', () => {
  applyLocale('id');

  it('night 4 h + nap 1.5 h is 5.5 h, 73% of 7 h 30 min, with the nap listed on its own', () => {
    const summary = lastSleepSession([...night, ...nap]);
    expect(summary?.dayAsleepSeconds).toBe(5.5 * H);
    expect(summary?.naps).toEqual([{ start: nap[0].start, end: nap[0].end, seconds: 1.5 * H }]);
    // The stages, range and score still describe the main sleep.
    expect(summary?.start).toBe(night[0].start);
    expect(summary?.end).toBe(night[0].end);
    expect(summary?.totalSeconds).toBe(4 * H);

    const share = sleepSignal([...night, ...nap])?.amount ?? 0;
    expect(share).toBeCloseTo((5.5 * H) / NEED, 6);
    expect(Math.round(share * 100)).toBe(73);
  });

  it('the night alone is 4 h, 53%', () => {
    const summary = lastSleepSession(night);
    expect(summary?.dayAsleepSeconds).toBe(4 * H);
    expect(summary?.naps).toEqual([]);
    expect(Math.round((sleepSignal(night)?.amount ?? 0) * 100)).toBe(53);
  });

  it('time covered twice is counted once', () => {
    // A second staged segment lies over the last hour of the night, and the nap is recorded twice.
    const overlapping = [...night, seg(at(18, '02:00'), at(18, '03:30'), 'deep'), ...nap, seg(at(18, '14:30'), at(18, '15:00'), 'rem')];
    const summary = lastSleepSession(overlapping);
    // 23:00 to 03:30 (4.5 h) + 14:00 to 15:30 (1.5 h)
    expect(summary?.dayAsleepSeconds).toBe(6 * H);
    const nights = buildNights(overlapping, []);
    expect(sleepByDay(nights).get(dayStart)?.asleepSeconds).toBe(6 * H);
  });

  it('awake time is not sleep', () => {
    const staged = [seg(at(17, '23:00'), at(18, '02:00')), seg(at(18, '02:00'), at(18, '02:30'), 'awake'), seg(at(18, '02:30'), at(18, '04:30'))];
    expect(lastSleepSession([...staged, ...nap])?.dayAsleepSeconds).toBe((3 + 2 + 1.5) * H);
  });

  it('a nap on the next wake day is not added to the night before it', () => {
    const nextDayNap = [seg(at(19, '14:00'), at(19, '15:30'))];
    // Looking at the 18th: the 19th nap does not exist yet. Looking after it, the day is the 19th.
    expect(lastSleepSession(night)?.dayAsleepSeconds).toBe(4 * H);
    const summary = lastSleepSession([...night, ...nextDayNap]);
    expect(summary?.dayAsleepSeconds).toBe(1.5 * H);
    expect(summary?.naps).toEqual([]);
    expect(sleepByDay(buildNights([...night, ...nextDayNap], [])).get(dayStart)?.asleepSeconds).toBe(4 * H);
  });

  it('a nap that ended the day before the wake day is not added', () => {
    // Night 22:00 on the 17th to 05:00 on the 18th wakes on the 18th; the 17th afternoon nap belongs to the 17th.
    const previous = [seg(at(17, '14:00'), at(17, '15:00'))];
    const summary = lastSleepSession([...previous, seg(at(17, '22:00'), at(18, '05:00'))]);
    expect(summary?.dayAsleepSeconds).toBe(7 * H);
    expect(summary?.naps).toEqual([]);
  });

  it('per-day totals feed the sleep debt, the trend and the day list; a day with only a nap has no night', () => {
    const segments = [...night, ...nap, seg(at(19, '14:00'), at(19, '14:40'))];
    const nights = buildNights(segments, []);
    const byDay = sleepByDay(nights);
    expect(byDay.get(dayStart)).toEqual({ asleepSeconds: 5.5 * H, napSeconds: 1.5 * H, hasNight: true });
    expect(byDay.get(at(19, '00:00'))).toEqual({ asleepSeconds: 40 * MIN, napSeconds: 40 * MIN, hasNight: false });

    expect(recentNightsAsleep(segments, at(19, '18:00'))).toEqual([5.5 * H]);

    const days = [at(17, '00:00'), dayStart, at(19, '00:00')];
    expect(sleepSeries(days, nights, []).hours).toEqual([null, 5.5, null]);
  });
});

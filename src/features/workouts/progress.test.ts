import { afterEach, describe, expect, it } from 'bun:test';

import { aggregateProgress, periodStarts, progressIsEmpty, PROGRESS_BUCKETS, type ProgressRow } from './progress';

// Bun keeps the last zone after `delete process.env.TZ`, so restore the resolved zone explicitly.
const ORIGINAL_TZ = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const sec = (ms: number) => Math.floor(ms / 1000);
const local = (y: number, m: number, d: number, h = 0, min = 0) => sec(new Date(y, m - 1, d, h, min).getTime());

function run(start: number, distance = 5000, extra: Partial<ProgressRow> = {}): ProgressRow {
  return { start, end: start + 1800, sportName: 'Running', duration: 1800, distance, gain: null, ...extra };
}

describe('periodStarts', () => {
  it('weeks open on Monday midnight and the list ends with the next Monday', () => {
    // Tuesday 20 Oct 2026.
    const starts = periodStarts('week', local(2026, 10, 20, 15));
    expect(starts).toHaveLength(PROGRESS_BUCKETS + 1);
    expect(starts[PROGRESS_BUCKETS - 1]).toBe(local(2026, 10, 19));
    expect(starts[PROGRESS_BUCKETS]).toBe(local(2026, 10, 26));
    expect(starts[0]).toBe(local(2026, 8, 3));
  });

  it('a Sunday still belongs to the week that began the Monday before', () => {
    const starts = periodStarts('week', local(2026, 10, 25, 23, 59));
    expect(starts[PROGRESS_BUCKETS - 1]).toBe(local(2026, 10, 19));
    expect(periodStarts('week', local(2026, 10, 19, 0, 0))[PROGRESS_BUCKETS - 1]).toBe(local(2026, 10, 19));
  });

  it('months open on the 1st and cross the year', () => {
    const starts = periodStarts('month', local(2026, 3, 31, 12));
    expect(starts[PROGRESS_BUCKETS - 1]).toBe(local(2026, 3, 1));
    expect(starts[PROGRESS_BUCKETS]).toBe(local(2026, 4, 1));
    expect(starts[0]).toBe(local(2025, 4, 1));
  });

  it('keeps local midnights across a daylight-saving change', () => {
    process.env.TZ = 'America/New_York';
    // DST ended Sunday 1 Nov 2026: the week of Monday 26 Oct is 7 calendar days but 169 hours.
    const starts = periodStarts('week', local(2026, 11, 3, 10));
    expect(starts[PROGRESS_BUCKETS - 1]).toBe(local(2026, 11, 2));
    expect(starts[PROGRESS_BUCKETS - 2]).toBe(local(2026, 10, 26));
    expect(new Date(starts[PROGRESS_BUCKETS - 2]! * 1000).getHours()).toBe(0);
    expect(starts[PROGRESS_BUCKETS - 1]! - starts[PROGRESS_BUCKETS - 2]!).toBe(169 * 3600);
  });
});

describe('aggregateProgress', () => {
  const now = local(2026, 10, 20, 15);

  it('puts a workout in the bucket its start falls in, with edges inclusive at the start and exclusive at the end', () => {
    const rows = [
      run(local(2026, 10, 19, 0, 0), 1000), // Monday 00:00: this week
      run(local(2026, 10, 18, 23, 59), 2000), // Sunday night: last week
      run(local(2026, 10, 26, 0, 0), 9000), // next Monday: after the chart
    ];
    const { current, previous } = aggregateProgress(rows, 'run', 'week', now);
    expect(current.distance).toBe(1000);
    expect(current.count).toBe(1);
    expect(previous.distance).toBe(2000);
  });

  it('groups by calendar month and compares with the previous one', () => {
    const rows = [run(local(2026, 10, 1, 0, 0), 4000), run(local(2026, 9, 30, 23, 59), 7000), run(local(2026, 9, 1), 1000)];
    const { current, previous, buckets } = aggregateProgress(rows, 'run', 'month', now);
    expect(current.distance).toBe(4000);
    expect(previous.distance).toBe(8000);
    expect(previous.count).toBe(2);
    expect(buckets).toHaveLength(PROGRESS_BUCKETS);
  });

  it('drops workouts older than the oldest bar', () => {
    const rows = [run(local(2026, 8, 2, 23, 59)), run(local(2026, 8, 3, 0, 0))];
    const { buckets } = aggregateProgress(rows, 'run', 'week', now);
    expect(buckets[0]!.count).toBe(1);
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(1);
  });

  it('buckets by the phone time zone, not UTC', () => {
    // 2026-10-18 17:30 UTC is Sunday in UTC but already Monday 00:30 in Jakarta.
    const instant = sec(Date.UTC(2026, 9, 18, 17, 30));
    process.env.TZ = 'Asia/Jakarta';
    const jakarta = aggregateProgress([run(instant, 3000)], 'run', 'week', sec(Date.UTC(2026, 9, 20, 8)));
    expect(jakarta.current.distance).toBe(3000);
    expect(jakarta.previous.distance).toBe(0);

    process.env.TZ = 'UTC';
    const utc = aggregateProgress([run(instant, 3000)], 'run', 'week', sec(Date.UTC(2026, 9, 20, 8)));
    expect(utc.current.distance).toBe(0);
    expect(utc.previous.distance).toBe(3000);
  });

  it('sums moving time, elevation and count of one sport only', () => {
    const rows = [
      run(local(2026, 10, 20, 7), 5000, { gain: 40 }),
      run(local(2026, 10, 19, 7), 3000, { gain: null, duration: 0, end: local(2026, 10, 19, 7) + 600 }),
      run(local(2026, 10, 20, 9), 20000, { sportName: 'Cycling', gain: 300 }),
      run(local(2026, 10, 20, 10), 1000, { sportName: 'Strength' }),
    ];
    const runs = aggregateProgress(rows, 'run', 'week', now).current;
    expect(runs).toMatchObject({ distance: 8000, count: 2, gain: 40, movingSec: 1800 + 600 });
    const rides = aggregateProgress(rows, 'ride', 'week', now).current;
    expect(rides).toMatchObject({ distance: 20000, count: 1, gain: 300 });
  });

  it('reports an empty chart when the sport has nothing in range', () => {
    expect(progressIsEmpty(aggregateProgress([run(local(2024, 1, 1))], 'run', 'week', now))).toBe(true);
    expect(progressIsEmpty(aggregateProgress([run(local(2026, 10, 20))], 'run', 'week', now))).toBe(false);
  });
});

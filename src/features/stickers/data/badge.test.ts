import { afterEach, describe, expect, it } from 'bun:test';

import { applyLocale } from '@/i18n';
import type { StickerSubject } from '@/features/stickers/subject';

import { buildBadgeSubjects, currentStreakDays, longestStreak, milestoneFromTotals, type MilestoneTotals } from './badge';

afterEach(() => applyLocale('id'));

const NOW = 1_800_000_000_000;
const totals = (over: Partial<MilestoneTotals> = {}): MilestoneTotals => ({
  totalDistanceM: 0,
  workoutCount: 0,
  totalMovingSec: 0,
  streakDays: 0,
  nowMs: NOW,
  ...over,
});
const ms = (s: StickerSubject | null) => s!.data.milestone as Record<string, unknown>;

describe('milestoneFromTotals', () => {
  it('nothing crossed', () => {
    expect(milestoneFromTotals(totals(), 'id')).toBeNull();
    expect(milestoneFromTotals(totals({ totalDistanceM: 9999, totalMovingSec: 10 * 3600 - 1, streakDays: 2 }), 'id')).toBeNull();
    expect(milestoneFromTotals(totals({ totalDistanceM: Number.NaN, workoutCount: Infinity }), 'id')).toBeNull();
  });

  it('distance thresholds at each boundary and just below', () => {
    const pick = (km: number) => milestoneFromTotals(totals({ totalDistanceM: km * 1000, justCrossed: 'distance' }), 'id');
    expect(pick(9.99)).toBeNull();
    for (const [km, expected] of [
      [10, 10], [24.9, 10], [25, 25], [49.99, 25], [50, 50], [99.9, 50], [100, 100], [249, 100], [250, 250], [499, 250],
      [500, 500], [999, 500], [1000, 1000], [2499, 1000], [2500, 2500], [4999, 2500], [5000, 5000], [9000, 5000],
    ] as const) {
      const s = pick(km)!;
      expect(s.id).toBe(`badge:distance:${expected}`);
      expect(ms(s).value).toBe(expected * 1000);
    }
  });

  it('workout, hour and streak ladders', () => {
    const only = (kind: MilestoneTotals['justCrossed'], over: Partial<MilestoneTotals>) => milestoneFromTotals(totals({ ...over, justCrossed: kind }), 'id');
    expect(only('workouts', { workoutCount: 0 })).toBeNull();
    expect(only('workouts', { workoutCount: 1 })!.id).toBe('badge:workouts:1');
    expect(only('workouts', { workoutCount: 9 })!.id).toBe('badge:workouts:1');
    expect(only('workouts', { workoutCount: 10 })!.id).toBe('badge:workouts:10');
    expect(only('workouts', { workoutCount: 499 })!.id).toBe('badge:workouts:250');
    expect(only('workouts', { workoutCount: 500 })!.id).toBe('badge:workouts:500');
    expect(only('time', { totalMovingSec: 10 * 3600 - 1 })).toBeNull();
    expect(only('time', { totalMovingSec: 10 * 3600 })!.id).toBe('badge:time:10');
    expect(only('time', { totalMovingSec: 100 * 3600 })!.id).toBe('badge:time:100');
    expect(ms(only('time', { totalMovingSec: 500 * 3600 + 5 }))).toMatchObject({ value: 500 * 3600, kind: 'time' });
    expect(only('streak', { streakDays: 2 })).toBeNull();
    expect(only('streak', { streakDays: 3 })!.id).toBe('badge:streak:3');
    expect(only('streak', { streakDays: 29 })!.id).toBe('badge:streak:14');
    expect(only('streak', { streakDays: 100 })!.id).toBe('badge:streak:100');
  });

  it('justCrossed limits the choice; otherwise the highest rank wins', () => {
    const t = totals({ totalDistanceM: 100_000, workoutCount: 10, streakDays: 3 });
    expect(milestoneFromTotals(t, 'id')!.id).toBe('badge:distance:100');
    expect(milestoneFromTotals({ ...t, justCrossed: 'workouts' }, 'id')!.id).toBe('badge:workouts:10');
    expect(milestoneFromTotals({ ...t, justCrossed: 'time' }, 'id')).toBeNull();
  });

  it('subject shape, texts and json', () => {
    const s = milestoneFromTotals(totals({ totalDistanceM: 100_000, streakDays: 5, bestStreakDays: 9 }), 'id')!;
    expect(s.kinds).toEqual(['badge']);
    expect(s.date).toBe(NOW);
    expect(s.heading).toBe('Bagikan pencapaian');
    expect(s.data.milestone).toEqual({
      kind: 'distance',
      title: '100 km total',
      subtitle: 'Jarak yang sudah kamu tempuh',
      value: 100_000,
      valueText: '100 km',
      unit: 'km',
    });
    expect(s.data.streak).toEqual({ days: 5, best: 9, unit: 'hari berturut-turut' });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('no streak object without a streak or best', () => {
    expect(milestoneFromTotals(totals({ workoutCount: 1 }), 'id')!.data.streak).toBeUndefined();
    expect((milestoneFromTotals(totals({ workoutCount: 1, streakDays: 1 }), 'id')!.data.streak as Record<string, unknown>).best).toBeUndefined();
  });

  it('first workout has its own text; english', async () => {
    const first = milestoneFromTotals(totals({ workoutCount: 1 }), 'id')!;
    expect(ms(first).title).toBe('Latihan pertama');
    await applyLocale('en');
    expect(ms(milestoneFromTotals(totals({ workoutCount: 1 }), 'en')).title).toBe('First workout');
    const s = milestoneFromTotals(totals({ workoutCount: 50 }), 'en')!;
    expect(ms(s)).toMatchObject({ title: '50 workouts', valueText: '50 workouts', unit: 'workouts' });
    expect(ms(milestoneFromTotals(totals({ streakDays: 30 }), 'en')).title).toBe('30 day streak');
    expect(milestoneFromTotals(totals({ totalDistanceM: 1_000_000 }), 'en')!.data.milestone).toMatchObject({ valueText: '1,000 km' });
    expect(s.caption).toContain('Tracked with JoyoFit');
  });
});

describe('buildBadgeSubjects', () => {
  it('lists the best threshold of every crossed ladder, best first', () => {
    const list = buildBadgeSubjects(totals({ totalDistanceM: 30_000, workoutCount: 12, totalMovingSec: 3600, streakDays: 7 }), 'id');
    expect(list.map((s) => s.id)).toEqual(['badge:streak:7', 'badge:workouts:10', 'badge:distance:25']);
  });

  it('justCrossed leads; none crossed gives an empty list', () => {
    const list = buildBadgeSubjects(totals({ totalDistanceM: 30_000, workoutCount: 12, justCrossed: 'workouts' }), 'id');
    expect(list.map((s) => s.id)).toEqual(['badge:workouts:10', 'badge:distance:25']);
    expect(buildBadgeSubjects(totals(), 'id')).toEqual([]);
  });
});

describe('currentStreakDays', () => {
  const today = '2026-10-18';
  it('counts back from today', () => {
    expect(currentStreakDays(['2026-10-18', '2026-10-17', '2026-10-16'], today)).toBe(3);
  });
  it('survives an empty today when yesterday is present', () => {
    expect(currentStreakDays(['2026-10-17', '2026-10-16'], today)).toBe(2);
  });
  it('is broken by a gap', () => {
    expect(currentStreakDays(['2026-10-18', '2026-10-16', '2026-10-15'], today)).toBe(1);
    expect(currentStreakDays(['2026-10-16', '2026-10-15'], today)).toBe(0);
  });
  it('ignores duplicates and order', () => {
    expect(currentStreakDays(['2026-10-16', '2026-10-18', '2026-10-17', '2026-10-17', '2026-10-18'], today)).toBe(3);
  });
  it('crosses month and year ends', () => {
    expect(currentStreakDays(['2026-01-01', '2025-12-31', '2025-12-30'], '2026-01-01')).toBe(3);
    expect(currentStreakDays(['2026-03-01', '2026-02-28'], '2026-03-01')).toBe(2);
  });
  it('empty and bad input', () => {
    expect(currentStreakDays([], today)).toBe(0);
    expect(currentStreakDays(['2026-10-18'], 'nope')).toBe(0);
  });
});

describe('longestStreak', () => {
  it('finds the longest run, unsorted and duplicated', () => {
    const days = ['2026-10-05', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-02', '2026-10-06', '2026-10-07', '2026-10-09'];
    expect(longestStreak(days)).toBe(3);
    expect(longestStreak(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-01'])).toBe(4);
  });
  it('single day, empty, junk, month end', () => {
    expect(longestStreak(['2026-10-05'])).toBe(1);
    expect(longestStreak([])).toBe(0);
    expect(longestStreak(['x', ''])).toBe(0);
    expect(longestStreak(['2026-09-30', '2026-10-01', '2026-10-02'])).toBe(3);
  });
});

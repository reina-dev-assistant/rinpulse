import { afterEach, describe, expect, it } from 'bun:test';

import { applyLocale } from '@/i18n';
import type { StickerSubject } from '@/features/stickers/subject';

import { buildPlanSubject, type PlanShareInput } from './plan';

afterEach(() => applyLocale('id'));

const input = (over: Partial<PlanShareInput> = {}): PlanShareInput => ({
  planId: 'p123',
  goal: 'run5k',
  week: 3,
  weeks: 8,
  phase: 'build',
  done: 7,
  total: 24,
  weekComplete: false,
  next: { type: 'easy', distanceM: null, focus: null },
  nowMs: 1_800_000_000_000,
  ...over,
});

const plan = (s: StickerSubject | null) => s!.data.plan as Record<string, unknown>;

describe('buildPlanSubject', () => {
  it('partial progress with a next session', () => {
    const s = buildPlanSubject(input(), 'id')!;
    expect(s.id).toBe('plan:p123:3');
    expect(s.kinds).toEqual(['plan']);
    expect(s.date).toBe(1_800_000_000_000);
    expect(s.data.milestone).toBeUndefined();
    expect(plan(s)).toEqual({
      name: 'Lari 5K',
      goal: 'Menuju 5K',
      week: 3,
      weeks: 8,
      progress: 0.292,
      done: 7,
      total: 24,
      phase: 'Membangun',
      nextLabel: 'Lari santai',
    });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('week complete offers the badge with a milestone', () => {
    const s = buildPlanSubject(input({ weekComplete: true, done: 12, total: 24 }), 'id')!;
    expect(s.kinds).toEqual(['plan', 'badge']);
    expect(s.data.milestone).toEqual({ kind: 'plan', title: 'Minggu 3 selesai', subtitle: 'Lari 5K', value: 50, unit: '%' });
  });

  it('plan complete: progress 1, no next session', () => {
    const s = buildPlanSubject(input({ week: 8, done: 24, total: 24, next: null, weekComplete: true, phase: 'taper' }), 'id')!;
    expect(plan(s).progress).toBe(1);
    expect(plan(s).nextLabel).toBeUndefined();
    expect(plan(s).phase).toBe('Tapering');
    expect((s.data.milestone as Record<string, unknown>).value).toBe(100);
  });

  it('next session labels: race distance and strength focus', () => {
    expect(plan(buildPlanSubject(input({ next: { type: 'race', distanceM: 10_000, focus: null } }), 'id')).nextLabel).toBe('Lari 10,00 km');
    expect(plan(buildPlanSubject(input({ next: { type: 'race', distanceM: null, focus: null } }), 'id')).nextLabel).toBe('Lari 5,00 km');
    expect(plan(buildPlanSubject(input({ goal: 'strengthFull', next: { type: 'strength', distanceM: null, focus: 'B' } }), 'id')).nextLabel).toBe('Full body B');
    expect(plan(buildPlanSubject(input({ next: { type: 'intervals', distanceM: null, focus: null } }), 'id')).nextLabel).toBe('Interval');
  });

  it('clamps and rejects bad numbers', () => {
    expect(buildPlanSubject(input({ total: 0 }), 'id')).toBeNull();
    expect(buildPlanSubject(input({ total: Number.NaN }), 'id')).toBeNull();
    expect(buildPlanSubject(input({ nowMs: Infinity }), 'id')).toBeNull();
    const s = buildPlanSubject(input({ done: 99, week: 40, weeks: 8 }), 'id')!;
    expect(plan(s).done).toBe(24);
    expect(plan(s).progress).toBe(1);
    expect(plan(s).week).toBe(8);
    expect(plan(buildPlanSubject(input({ done: Number.NaN }), 'id')).done).toBe(0);
    expect(plan(buildPlanSubject(input({ done: -3 }), 'id')).progress).toBe(0);
  });

  it('english', async () => {
    await applyLocale('en');
    const s = buildPlanSubject(input({ weekComplete: true, phase: 'cutback' }), 'en')!;
    expect(plan(s).goal).toBe('Heading to 5K');
    expect(plan(s).name).toBe('5K run');
    expect(plan(s).phase).toBe('Easy week');
    expect((s.data.milestone as Record<string, unknown>).title).toBe('Week 3 done');
    expect(s.heading).toBe('Share plan');
  });
});

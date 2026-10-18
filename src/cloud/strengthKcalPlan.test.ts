import { describe, expect, it } from 'bun:test';

import type { StrengthWorkout } from '@/features/strength/types';

import { desiredKcal, externalIdFor, planKcal, type KcalPayload, type KcalSentRow } from './strengthKcalPlan';

const label = (name: string) => (name === '' ? 'Strength training' : `Strength: ${name}`);

const workout = (over: Partial<StrengthWorkout> = {}): StrengthWorkout => ({
  id: 'wabc123',
  name: 'Push',
  // 2026-10-18 23:30 UTC = 2026-10-19 06:30 WIB
  startedAt: Date.UTC(2026, 9, 18, 23, 30),
  endedAt: Date.UTC(2026, 9, 19, 0, 20),
  durationSec: 3000,
  note: '',
  routineId: null,
  planKey: null,
  exercises: [],
  workoutStart: 1_790_000_000,
  kcal: 262.4,
  kcalSource: 'estimate',
  updatedAt: 1,
  deletedAt: null,
  ...over,
});

describe('desiredKcal', () => {
  it('describes the diary row of an estimated workout on the logger own row', () => {
    expect(desiredKcal(workout(), true, label)).toEqual({
      externalId: 'strength:wabc123',
      date: '2026-10-19',
      name: 'Strength: Push',
      durationMin: 50,
      kcal: 262,
    });
  });

  it('pushes the energy measured with a heart rate strap exactly like the estimate, on the logger own row only', () => {
    const estimated = desiredKcal(workout(), true, label);
    expect(desiredKcal(workout({ kcalSource: 'hr' }), true, label)).toEqual(estimated);
    expect(desiredKcal(workout({ kcalSource: 'hr', kcal: 301.6 }), true, label)?.kcal).toBe(302);
    expect(desiredKcal(workout({ kcalSource: 'hr' }), false, label)).toBeNull();
    expect(desiredKcal(workout({ kcalSource: 'hr', kcal: null }), true, label)).toBeNull();
  });

  it('uses the WIB day, not the phone day', () => {
    expect(desiredKcal(workout({ startedAt: Date.UTC(2026, 9, 18, 16, 59) }), true, label)?.date).toBe('2026-10-18');
    expect(desiredKcal(workout({ startedAt: Date.UTC(2026, 9, 18, 17, 0) }), true, label)?.date).toBe('2026-10-19');
  });

  it('nothing for a workout merged with a watch workout, a watch figure, or no row', () => {
    expect(desiredKcal(workout(), false, label)).toBeNull();
    expect(desiredKcal(workout({ kcalSource: 'watch' }), true, label)).toBeNull();
    expect(desiredKcal(workout({ kcalSource: null }), true, label)).toBeNull();
    expect(desiredKcal(workout({ workoutStart: null }), false, label)).toBeNull();
  });

  it('nothing for imported JoyoRogo history, a deleted workout, or no energy', () => {
    expect(desiredKcal(workout({ id: 'rogo:abc' }), true, label)).toBeNull();
    expect(desiredKcal(workout({ deletedAt: 5 }), true, label)).toBeNull();
    expect(desiredKcal(workout({ kcal: null }), true, label)).toBeNull();
    expect(desiredKcal(workout({ kcal: 0.2 }), true, label)).toBeNull();
  });

  it('keeps the numbers inside what JoyoRogo accepts', () => {
    expect(desiredKcal(workout({ durationSec: 10 }), true, label)?.durationMin).toBe(1);
    expect(desiredKcal(workout({ durationSec: 3 * 86_400 }), true, label)?.durationMin).toBe(1440);
    expect(desiredKcal(workout({ kcal: 50_000 }), true, label)?.kcal).toBe(10_000);
    expect(desiredKcal(workout({ name: 'x'.repeat(500) }), true, label)?.name.length).toBe(200);
    expect(desiredKcal(workout({ name: '   ' }), true, label)?.name).toBe('Strength training');
    expect(externalIdFor('w'.repeat(200)).length).toBe(100);
  });
});

const payload = (over: Partial<KcalPayload> = {}): KcalPayload => ({
  externalId: 'strength:wabc123',
  date: '2026-10-19',
  name: 'Strength: Push',
  durationMin: 50,
  kcal: 262,
  ...over,
});
const sent = (over: Partial<KcalSentRow> = {}): KcalSentRow => ({
  workoutId: 'wabc123',
  externalId: 'strength:wabc123',
  date: '2026-10-19',
  kcal: 262,
  sentAt: 1,
  ...over,
});

describe('planKcal', () => {
  it('sends a workout that was never sent', () => {
    expect(planKcal(payload(), null)).toEqual({ type: 'send', payload: payload() });
  });

  it('sends once: the same energy and day again is nothing', () => {
    expect(planKcal(payload(), sent())).toEqual({ type: 'none' });
    expect(planKcal(payload({ name: 'Strength: Renamed', durationMin: 55 }), sent())).toEqual({ type: 'none' });
  });

  it('sends again when the energy or the day changed', () => {
    expect(planKcal(payload({ kcal: 300 }), sent()).type).toBe('send');
    expect(planKcal(payload({ date: '2026-10-18' }), sent()).type).toBe('send');
  });

  it('takes back what was sent when the workout should have no row any more', () => {
    expect(planKcal(null, sent())).toEqual({ type: 'remove', externalId: 'strength:wabc123' });
    expect(planKcal(null, null)).toEqual({ type: 'none' });
  });
});

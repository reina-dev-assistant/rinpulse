import { describe, expect, it } from 'bun:test';

import { DETACHED_HASH } from '@/db/cloud';

import { externalIdForWatch, needsWatchKcalSend, watchKcalEligible, watchKcalPayload, WATCH_KCAL_WINDOW_S, type WatchWorkoutRow } from './watchKcalPlan';

const NOW = 1_792_100_000;
const walk: WatchWorkoutRow = {
  start: 1_792_058_016,
  end: 1_792_059_816,
  duration: 1790,
  calories: 143.4,
  sportType: 2,
  sportName: 'Walking',
  imported: 0,
  complete: 1,
  cloudHash: null,
};

describe('watchKcalEligible: what reaches the diary', () => {
  it('a complete watch workout of the last 30 days does', () => {
    expect(watchKcalEligible(walk, DETACHED_HASH, NOW)).toBe(true);
    expect(watchKcalEligible({ ...walk, cloudHash: 'abc' }, DETACHED_HASH, NOW)).toBe(true);
  });

  it('imports, FIT files and phone recordings (imported = 1) do not', () => {
    expect(watchKcalEligible({ ...walk, imported: 1 }, DETACHED_HASH, NOW)).toBe(false);
  });

  it('a workout whose download failed in part waits for the retry', () => {
    expect(watchKcalEligible({ ...walk, complete: 0 }, DETACHED_HASH, NOW)).toBe(false);
  });

  it('only the last 30 days: the edge is in, older is out', () => {
    expect(watchKcalEligible({ ...walk, start: NOW - WATCH_KCAL_WINDOW_S }, DETACHED_HASH, NOW)).toBe(true);
    expect(watchKcalEligible({ ...walk, start: NOW - WATCH_KCAL_WINDOW_S - 1 }, DETACHED_HASH, NOW)).toBe(false);
  });

  it('a workout kept apart from the account that signed in afterwards (Simpan terpisah) is never sent to it', () => {
    expect(watchKcalEligible({ ...walk, cloudHash: DETACHED_HASH }, DETACHED_HASH, NOW)).toBe(false);
  });
});

describe('watchKcalPayload', () => {
  it('one diary row per workout, keyed by its start, on the WIB day, as long as the session Health Connect gets', () => {
    expect(watchKcalPayload(walk, 'Jalan')).toEqual({
      externalId: 'watch:1792058016',
      date: '2026-10-15',
      name: 'Jalan',
      durationMin: 30,
      kcal: 143,
      type: 'jalan_cepat',
    });
  });

  it('falls back to the stored duration when the end is unknown', () => {
    expect(watchKcalPayload({ ...walk, end: 0, duration: 600 }, 'Jalan')!.durationMin).toBe(10);
  });

  it('maps watch sports to JoyoRogo activity types, an unknown sport to a neutral key', () => {
    const type = (sportType: number) => watchKcalPayload({ ...walk, sportType }, 'x')!.type;
    expect([1, 2, 3, 5, 7, 14, 137, 140, 255].map(type)).toEqual([
      'lari',
      'jalan_cepat',
      'sepeda',
      'lari',
      'sepeda',
      'jalan_cepat',
      'yoga',
      'angkat_beban',
      'latihan',
    ]);
  });

  it('the day is Jakarta\'s: a walk at 20:00 UTC is already tomorrow there', () => {
    const lateUtc = Date.UTC(2026, 9, 17, 20, 0, 0) / 1000;
    expect(watchKcalPayload({ ...walk, start: lateUtc, end: lateUtc + 600 }, 'x')!.date).toBe('2026-10-18');
  });

  it('nothing to send without energy; limits are respected', () => {
    expect(watchKcalPayload({ ...walk, calories: 0 }, 'x')).toBeNull();
    expect(watchKcalPayload({ ...walk, calories: 0.4 }, 'x')).toBeNull();
    expect(watchKcalPayload({ ...walk, calories: 99_999 }, 'x')!.kcal).toBe(10_000);
    expect(watchKcalPayload({ ...walk, end: walk.start + 5 }, 'x')!.durationMin).toBe(1);
    expect(watchKcalPayload({ ...walk, end: walk.start + 99 * 3600 }, 'x')!.durationMin).toBe(1440);
    expect(watchKcalPayload(walk, 'n'.repeat(300))!.name).toHaveLength(200);
  });

  it('the external id is stable and distinct from the phone and strength ids', () => {
    expect(externalIdForWatch(7)).toBe('watch:7');
  });
});

describe('needsWatchKcalSend', () => {
  const payload = watchKcalPayload(walk, 'Jalan')!;
  const sent = { accountId: 'acc-1', externalId: payload.externalId, date: payload.date, kcal: payload.kcal };

  it('sends when nothing was sent', () => {
    expect(needsWatchKcalSend(payload, null, 'acc-1')).toBe(true);
  });

  it('does not send again what the same account already has', () => {
    expect(needsWatchKcalSend(payload, sent, 'acc-1')).toBe(false);
  });

  it('sends again when the energy or the day changed', () => {
    expect(needsWatchKcalSend(payload, { ...sent, kcal: 100 }, 'acc-1')).toBe(true);
    expect(needsWatchKcalSend(payload, { ...sent, date: '2026-10-01' }, 'acc-1')).toBe(true);
  });

  it('sends everything again to another JoyoRogo account', () => {
    expect(needsWatchKcalSend(payload, sent, 'acc-2')).toBe(true);
  });
});

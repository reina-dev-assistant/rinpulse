import { describe, expect, it } from 'bun:test';

import { externalIdForPhone, needsPhoneKcalSend, phoneKcalPayload } from './phoneKcalPlan';

const run = { start: 1_792_058_016, duration: 1810, calories: 312.4, sportType: 1, name: 'Lari' };

describe('phoneKcalPayload', () => {
  it('one diary row per workout, keyed by its start, on the WIB day, with JoyoRogo\'s activity type', () => {
    expect(phoneKcalPayload(run)).toEqual({
      externalId: 'phone:1792058016',
      date: '2026-10-15',
      name: 'Lari',
      durationMin: 30,
      kcal: 312,
      type: 'lari',
    });
  });

  it('the day is Jakarta\'s: a run at 20:00 UTC is already tomorrow there', () => {
    const lateUtc = Date.UTC(2026, 9, 17, 20, 0, 0) / 1000;
    expect(phoneKcalPayload({ ...run, start: lateUtc })!.date).toBe('2026-10-18');
  });

  it('maps sports to activity types, and an unknown sport to a neutral key', () => {
    const type = (sportType: number) => phoneKcalPayload({ ...run, sportType })!.type;
    expect([type(2), type(3), type(5), type(7), type(14), type(255)]).toEqual(['jalan_cepat', 'sepeda', 'lari', 'sepeda', 'jalan_cepat', 'latihan']);
  });

  it('nothing to send without energy; limits are respected', () => {
    expect(phoneKcalPayload({ ...run, calories: 0 })).toBeNull();
    expect(phoneKcalPayload({ ...run, calories: 99_999 })!.kcal).toBe(10_000);
    expect(phoneKcalPayload({ ...run, duration: 5 })!.durationMin).toBe(1);
    expect(phoneKcalPayload({ ...run, duration: 99 * 3600 })!.durationMin).toBe(1440);
  });

  it('external id is stable', () => {
    expect(externalIdForPhone(7)).toBe('phone:7');
  });
});

describe('needsPhoneKcalSend', () => {
  const payload = phoneKcalPayload(run)!;
  it('sends when nothing was sent or the energy or day changed, not otherwise', () => {
    expect(needsPhoneKcalSend(payload, null)).toBe(true);
    expect(needsPhoneKcalSend(payload, { externalId: payload.externalId, date: payload.date, kcal: payload.kcal })).toBe(false);
    expect(needsPhoneKcalSend(payload, { externalId: payload.externalId, date: payload.date, kcal: 100 })).toBe(true);
    expect(needsPhoneKcalSend(payload, { externalId: payload.externalId, date: '2026-10-01', kcal: payload.kcal })).toBe(true);
  });
});

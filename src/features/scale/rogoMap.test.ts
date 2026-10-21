import { beforeAll, describe, expect, it } from 'bun:test';

import { resolveRogoZone, rogoDay, rogoNoon, setRogoProfileZone } from '@/cloud/rogoZone';

import { toRogoCheckIn } from './rogoMap';

beforeAll(() => setRogoProfileZone('Asia/Jakarta'));

describe('rogoDay', () => {
  it('counts the Indonesian day in UTC+7', () => {
    expect(rogoDay(Date.UTC(2026, 9, 19, 16, 59), 'Asia/Jakarta')).toBe('2026-10-19');
    expect(rogoDay(Date.UTC(2026, 9, 19, 17, 0), 'Asia/Jakarta')).toBe('2026-10-20');
    expect(rogoDay(Date.UTC(2026, 11, 31, 18, 0), 'Asia/Jakarta')).toBe('2027-01-01');
  });

  it('counts the Malaysian and Singapore day in UTC+8', () => {
    expect(rogoDay(Date.UTC(2026, 9, 19, 15, 59), 'Asia/Kuala_Lumpur')).toBe('2026-10-19');
    expect(rogoDay(Date.UTC(2026, 9, 19, 16, 0), 'Asia/Kuala_Lumpur')).toBe('2026-10-20');
    expect(rogoDay(Date.UTC(2026, 9, 19, 16, 0), 'Asia/Singapore')).toBe('2026-10-20');
  });

  it('a 23:30 MYT weigh-in is that MYT day for a MY user, and the same instant in WIB for an ID user', () => {
    const at = Date.parse('2026-10-19T23:30:00+08:00');
    setRogoProfileZone('Asia/Kuala_Lumpur');
    expect(toRogoCheckIn({ weightKg: 70 }, at)!.date).toBe('2026-10-19');
    setRogoProfileZone(null);
    expect(toRogoCheckIn({ weightKg: 70 }, at)!.date).toBe(rogoDay(at, 'Asia/Jakarta'));
    // 00:30 MYT on the 20th is still the 19th, 23:30, in WIB.
    const after = Date.parse('2026-10-20T00:30:00+08:00');
    setRogoProfileZone('Asia/Kuala_Lumpur');
    expect(toRogoCheckIn({ weightKg: 70 }, after)!.date).toBe('2026-10-20');
    setRogoProfileZone('Asia/Jakarta');
    expect(toRogoCheckIn({ weightKg: 70 }, after)!.date).toBe('2026-10-19');
  });

  it('noon of a day is noon in that zone', () => {
    expect(rogoNoon('2026-10-10', 'Asia/Jakarta')).toBe(Date.parse('2026-10-10T05:00:00.000Z'));
    expect(rogoNoon('2026-10-10', 'Asia/Kuala_Lumpur')).toBe(Date.parse('2026-10-10T04:00:00.000Z'));
  });
});

describe('resolveRogoZone', () => {
  it('takes the profile zone, else the device zone when supported, else Jakarta', () => {
    expect(resolveRogoZone('Asia/Singapore', 'Asia/Jakarta')).toBe('Asia/Singapore');
    expect(resolveRogoZone(null, 'Asia/Kuala_Lumpur')).toBe('Asia/Kuala_Lumpur');
    expect(resolveRogoZone(undefined, 'Europe/Paris')).toBe('Asia/Jakarta');
    expect(resolveRogoZone(null, undefined)).toBe('Asia/Jakarta');
    expect(resolveRogoZone('Europe/Paris', 'Asia/Singapore')).toBe('Asia/Jakarta');
  });
});

describe('toRogoCheckIn', () => {
  const at = Date.UTC(2026, 9, 19, 1, 0);

  it('sends the weight to 0.1 kg and the Jakarta day', () => {
    expect(toRogoCheckIn({ weightKg: 73.46 }, at)).toEqual({ weightKg: 73.5, date: '2026-10-19', source: 'scale' });
    expect(toRogoCheckIn({ weightKg: 73.44 }, at)).toEqual({ weightKg: 73.4, date: '2026-10-19', source: 'scale' });
  });

  it('rejects what weight.checkIn would reject (25..400 kg)', () => {
    expect(toRogoCheckIn({ weightKg: 24.9 }, at)).toBeNull();
    expect(toRogoCheckIn({ weightKg: 25 }, at)).not.toBeNull();
    expect(toRogoCheckIn({ weightKg: 400 }, at)).not.toBeNull();
    expect(toRogoCheckIn({ weightKg: 400.1 }, at)).toBeNull();
    expect(toRogoCheckIn({ weightKg: Number.NaN }, at)).toBeNull();
  });

  it('carries only weight, date and source without body values', () => {
    expect(Object.keys(toRogoCheckIn({ weightKg: 70 }, at) ?? {}).sort()).toEqual(['date', 'source', 'weightKg']);
  });

  it('maps body values: reported first, estimate as fallback, rounded', () => {
    const out = toRogoCheckIn(
      {
        weightKg: 70,
        reported: { bodyFatPct: 18.26, boneKg: 2.555, visceralFat: 7.4 },
        estimate: { bodyFatPct: 25, musclePct: 40.04, waterPct: 55.55, bmrKcal: 1650.6, proteinPct: 16.04 },
      },
      at,
    );
    expect(out).toEqual({
      weightKg: 70, date: '2026-10-19', source: 'scale',
      bodyFatPct: 18.3, boneKg: 2.56, visceralFat: 7, musclePct: 40, waterPct: 55.6, bmrKcal: 1651, proteinPct: 16,
    });
  });

  it('drops out-of-range body values', () => {
    const out = toRogoCheckIn(
      { weightKg: 70, reported: { bodyFatPct: 1.9, musclePct: 81, waterPct: 19, boneKg: 8.1, visceralFat: 0, bmrKcal: 5001, proteinPct: 41 } },
      at,
    );
    expect(out).toEqual({ weightKg: 70, date: '2026-10-19', source: 'scale' });
    expect(toRogoCheckIn({ weightKg: 70, reported: { bodyFatPct: 2, visceralFat: 60 } }, at)).toMatchObject({ bodyFatPct: 2, visceralFat: 60 });
  });
});

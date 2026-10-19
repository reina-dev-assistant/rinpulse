import { describe, expect, it } from 'bun:test';

import { jakartaDay, toRogoCheckIn } from './rogoMap';

describe('jakartaDay', () => {
  it('counts the day in UTC+7', () => {
    expect(jakartaDay(Date.UTC(2026, 9, 19, 16, 59))).toBe('2026-10-19');
    expect(jakartaDay(Date.UTC(2026, 9, 19, 17, 0))).toBe('2026-10-20');
    expect(jakartaDay(Date.UTC(2026, 11, 31, 18, 0))).toBe('2027-01-01');
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

import { describe, expect, it } from 'bun:test';

import { applyLocale } from '@/i18n';

import { nightHrvAvailability, type NightHrvInput } from './nightHrv';
import { headlineLabel, hrvNote, readiness } from './readiness';
import type { Recovery, RecoveryState } from './recovery';

const input: NightHrvInput = {
  platform: 'android',
  knownSupported: true,
  enabled: true,
  calibratedAt: 1,
  nightsSinceSetup: 0,
  nightRowsSinceSetup: 0,
  anyNightRowInHistory: false,
};
const missing: RecoveryState = { missing: 'HRV: nothing', wait: { kind: 'none' } };
const spot = { recovery: { percent: 60, band: 'yellow', rmssd: 40, source: 'spot', baselineRmssd: 38, z: 0.4, baselineCount: 5 } as Recovery };
const night = { recovery: { ...spot.recovery, source: 'night' } as Recovery };

describe('hrvNote', () => {
  it('says readiness has no night HRV for an unsupported watch', () => {
    const a = nightHrvAvailability({ ...input, knownSupported: false });
    expect(hrvNote(missing, a)).toBe(
      'Kesiapan di sini memakai tidur, detak jantung istirahat, dan beban latihan, tanpa HRV malam: HRV malam tidak tersedia di jam ini.',
    );
  });

  it('says so when the watch recorded none, and on iPhone', () => {
    expect(hrvNote(missing, nightHrvAvailability({ ...input, nightsSinceSetup: 3 }))).toContain('tanpa HRV malam: HRV malam tidak tersedia di jam ini.');
    expect(hrvNote(missing, nightHrvAvailability({ ...input, platform: 'ios' }))).toContain('HRV malam belum dibaca di iPhone');
  });

  it('says a 1-minute reading stands in for night HRV', () => {
    expect(hrvNote(spot, nightHrvAvailability({ ...input, knownSupported: false }))).toBe(
      'HRV di sini adalah pengukuran 1 menit sebagai pengganti HRV malam: HRV malam tidak tersedia di jam ini.',
    );
    expect(hrvNote(spot, null)).toBe('HRV di sini adalah pengukuran 1 menit sebagai pengganti HRV malam.');
  });

  it('has no note for a night reading, when nothing is known, or while only the baseline is short', () => {
    expect(hrvNote(night, null)).toBeNull();
    expect(hrvNote(missing, null)).toBeNull();
    expect(hrvNote(missing, { state: 'available' })).toBeNull();
  });
});

describe('readiness', () => {
  const rest = { dayStart: 0, resting: new Map<number, number>(), strain: [], sleep: null };

  it('carries the note and leaves the headline logic alone', () => {
    const a = nightHrvAvailability({ ...input, knownSupported: false });
    const r = readiness({ ...rest, hrv: missing, availability: a });
    expect(r.hrvNote).toContain('tanpa HRV malam');
    expect(r.headline).toBeNull();
    expect(readiness({ ...rest, hrv: spot, availability: a }).headline).toBe('Balanced');
  });

  it('has no note without availability', () => {
    expect(readiness({ ...rest, hrv: missing }).hrvNote).toBeNull();
  });

  it('words the headline and a signal in the app language, keeping the headline identifier', async () => {
    const r = readiness({ ...rest, hrv: spot });
    expect(r.headline).toBe('Balanced');
    expect(headlineLabel('Run down')).toBe('Kelelahan');
    expect(r.signals[0].detail).toBe('+0,4 SD dari biasanya 38 ms (5 pengukuran)');
    await applyLocale('en');
    try {
      expect(headlineLabel('Run down')).toBe('Run down');
      expect(readiness({ ...rest, hrv: spot }).signals[0].detail).toBe('+0.4 SD against your usual 38 ms (5 readings)');
    } finally {
      await applyLocale('id');
    }
  });
});

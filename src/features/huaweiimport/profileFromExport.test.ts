import { describe, expect, it } from 'bun:test';

import { profileFromExport } from './profileFromExport';

const hint = { heightCm: 172, weightKg: 89.2, sex: 'male', birthYear: 1992 } as const;

describe('profileFromExport', () => {
  it('fills an empty profile from the export', () => {
    expect(profileFromExport(null, hint, 10000, 2026)).toEqual({ heightCm: 172, weightKg: 89.2, birthYear: 1992, sex: 'male', dailyStepGoal: 10000 });
  });

  it('never touches a profile the phone has', () => {
    expect(profileFromExport({ heightCm: 180 }, hint, 10000, 2026)).toBeNull();
  });

  it('does not make up what the export does not say', () => {
    expect(profileFromExport(null, { heightCm: 172, weightKg: 89.2 }, 10000, 2026)).toBeNull();
    expect(profileFromExport(null, { weightKg: 89.2, birthYear: 1992 }, 10000, 2026)).toBeNull();
    expect(profileFromExport(null, undefined, 10000, 2026)).toBeNull();
  });

  it('takes sex unknown when the export has no gender, and refuses implausible values', () => {
    expect(profileFromExport(null, { ...hint, sex: undefined }, 10000, 2026)?.sex).toBe('unknown');
    expect(profileFromExport(null, { ...hint, heightCm: 17 }, 10000, 2026)).toBeNull();
    expect(profileFromExport(null, { ...hint, birthYear: 2030 }, 10000, 2026)).toBeNull();
    expect(profileFromExport(null, { ...hint, weightKg: 5 }, 10000, 2026)).toBeNull();
  });
});

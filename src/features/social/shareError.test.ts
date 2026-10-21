import { describe, expect, it } from 'bun:test';

import { needsRogoProfile } from './shareError';

describe('needsRogoProfile', () => {
  it("recognises JoyoRogo's FAILED_PRECONDITION refusal (RogoError carries the ORPC code)", () => {
    expect(needsRogoProfile(Object.assign(new Error('Finish onboarding first.'), { status: 412, code: 'FAILED_PRECONDITION' }))).toBe(true);
  });

  it('leaves every other failure alone', () => {
    expect(needsRogoProfile(Object.assign(new Error('x'), { status: 400, code: 'BAD_REQUEST' }))).toBe(false);
    expect(needsRogoProfile(new Error('offline'))).toBe(false);
    expect(needsRogoProfile(null)).toBe(false);
    expect(needsRogoProfile('FAILED_PRECONDITION')).toBe(false);
  });
});

describe('onboarding links', () => {
  it('tries the JoyoRogo app first, then the web onboarding', async () => {
    const { ROGO_ONBOARDING_URLS } = await import('./shareError');
    expect(ROGO_ONBOARDING_URLS[0]).toStartWith('joyorogo://onboarding');
    expect(ROGO_ONBOARDING_URLS[1]).toStartWith('https://joyorogo.com/onboarding');
  });
});

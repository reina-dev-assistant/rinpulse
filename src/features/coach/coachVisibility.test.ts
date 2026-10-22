import { describe, expect, test } from 'bun:test';

import { coachVisibility, type CoachAccess } from './useCoachAccess';

/**
 * What Coach draws on this phone.
 *
 * The gate exists to sell the JoyoRogo account, not to guard a server call: the plan, the suggestions, the
 * progress and the rule-based feedback are computed locally. In local-only mode there is no account to check, so
 * nobody may be asked to sign in or shown an upgrade card for a feature that already works.
 */
describe('coachVisibility', () => {
  test('local-only mode always shows Coach, whatever the account says', () => {
    for (const access of ['checking', 'signedOut', 'free', 'pro'] as CoachAccess[]) {
      expect(coachVisibility(access, true)).toBe('show');
    }
  });

  test('with an account the gate behaves as before', () => {
    expect(coachVisibility('pro', false)).toBe('show');
    expect(coachVisibility('checking', false)).toBe('checking');
    expect(coachVisibility('signedOut', false)).toBe('signIn');
    expect(coachVisibility('free', false)).toBe('upgrade');
  });

  test('never asks a local-only phone to sign in', () => {
    expect(coachVisibility('signedOut', true)).not.toBe('signIn');
    expect(coachVisibility('free', true)).not.toBe('upgrade');
    expect(coachVisibility('checking', true)).not.toBe('checking');
  });
});

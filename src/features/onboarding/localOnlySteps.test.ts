import { describe, expect, test } from 'bun:test';

import { visibleSteps, type StepContext } from './flow';

/**
 * Local-only mode: this phone is the whole app, so the guide must never ask for an account.
 *
 * The account, Pro and cloud steps are the only ones that exist because of JoyoRogo's server. With
 * local-only on, a run has to walk from welcome all the way to done without one of them, and the
 * watch/phone steps must stay exactly as they are.
 */
const ANDROID: StepContext = { platform: 'android', cloudConfigured: true };

/** A fresh run that has paired a watch, so every step is eligible. */
function state(overrides: Record<string, unknown> = {}) {
  return {
    status: 'active' as const,
    step: 'welcome' as const,
    route: 'watch' as const,
    done: [],
    skipped: [],
    without: [],
    ...overrides,
  };
}

describe('local-only mode and the setup guide', () => {
  test('hides account, pro and cloud — every step that needs JoyoRogo', () => {
    const steps = visibleSteps(state(), { ...ANDROID, localOnly: true });
    expect(steps).not.toContain('account');
    expect(steps).not.toContain('pro');
    expect(steps).not.toContain('cloud');
  });

  test('keeps every local step: the watch, the permissions and done', () => {
    const steps = visibleSteps(state(), { ...ANDROID, localOnly: true });
    for (const id of ['welcome', 'unbind', 'pair', 'sync', 'notifications', 'health', 'weather', 'background', 'done']) {
      expect(steps).toContain(id);
    }
  });

  test('without it, the account steps are still shown (the default is unchanged)', () => {
    const steps = visibleSteps(state(), ANDROID);
    expect(steps).toContain('account');
    expect(steps).toContain('pro');
    expect(steps).toContain('cloud');
  });

  test('the phone-only route keeps its shape, minus the account steps', () => {
    const steps = visibleSteps(state({ route: 'none' }), { ...ANDROID, localOnly: true });
    expect(steps).toContain('phone');
    expect(steps).not.toContain('pair');
    expect(steps).not.toContain('account');
    expect(steps).toContain('done');
  });
});

import { describe, expect, it } from 'bun:test';

import { HEALTH_ROUTE, isTabRoot, MORE_ROUTE, SOCIAL_ROUTE, thirdTabRoute } from './tabBarRoutes';

describe('isTabRoot', () => {
  it('shows the bar on the root of Today, Workouts, Social and More', () => {
    expect(isTabRoot('index', undefined)).toBe(true);
    expect(isTabRoot('workouts', 'index')).toBe(true);
    expect(isTabRoot(SOCIAL_ROUTE, 'index')).toBe(true);
    expect(isTabRoot(MORE_ROUTE, 'index')).toBe(true);
    expect(isTabRoot('workouts', undefined)).toBe(true);
  });
  it('hides it on anything pushed on those stacks', () => {
    expect(isTabRoot('workouts', '[id]')).toBe(false);
    expect(isTabRoot('workouts', 'manual')).toBe(false);
    expect(isTabRoot(SOCIAL_ROUTE, 'post')).toBe(false);
    expect(isTabRoot(SOCIAL_ROUTE, 'group')).toBe(false);
    expect(isTabRoot(MORE_ROUTE, 'appearance')).toBe(false);
  });
  it('hides it on the hidden tabs, even on their own index', () => {
    for (const tab of ['watch', 'routes', 'family', 'coach', 'strength', 'sleep', 'heart', 'hrv', 'home-cards', 'ride']) {
      expect(isTabRoot(tab, undefined)).toBe(false);
      expect(isTabRoot(tab, 'index')).toBe(false);
    }
  });
  it('shows it on Health only while Health is the third tab (local-only mode)', () => {
    expect(isTabRoot(HEALTH_ROUTE, undefined, true)).toBe(true);
    expect(isTabRoot(HEALTH_ROUTE, 'index', true)).toBe(true);
    // On an account build `/health` is still a detail screen Today pushes onto, so no bar.
    expect(isTabRoot(HEALTH_ROUTE, undefined, false)).toBe(false);
    expect(isTabRoot(HEALTH_ROUTE, 'index', false)).toBe(false);
    // And a screen pushed on the Health stack has no bar either way.
    expect(isTabRoot(HEALTH_ROUTE, 'trends', true)).toBe(false);
  });
  it('is not fooled by names on the object prototype', () => {
    expect(isTabRoot('constructor', undefined)).toBe(false);
  });
});

describe('thirdTabRoute', () => {
  it('is Social on an account build and Health in local-only mode', () => {
    expect(thirdTabRoute(false)).toBe(SOCIAL_ROUTE);
    expect(thirdTabRoute(true)).toBe(HEALTH_ROUTE);
  });
  it('never leaves the slot empty — the third tab always has a route', () => {
    for (const localOnly of [true, false]) {
      expect(thirdTabRoute(localOnly)).not.toBe('');
      expect(isTabRoot(thirdTabRoute(localOnly), 'index', localOnly)).toBe(true);
    }
  });
});

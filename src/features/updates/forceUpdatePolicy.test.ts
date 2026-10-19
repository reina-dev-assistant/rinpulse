import { describe, expect, test } from 'bun:test';

import {
  CONFIG_TTL_MS,
  OTA_RELOAD_GUARD_MS,
  decideGate,
  isCacheFresh,
  needsFetch,
  parseCachedConfig,
  parseGateConfig,
  resolveGateConfig,
  shouldRecheckGate,
  shouldRefreshOtaAtLaunch,
  storeTargets,
  type GateConfig,
} from './forceUpdatePolicy';

const NOW = 1_800_000_000_000;
const PLAY = 'https://play.google.com/apps/testing/com.joyodigitama.joyofit';
const TF = 'https://testflight.apple.com/join/GXzrQ8GJ';

const config = (over: Partial<GateConfig['android']> = {}, ios: Partial<GateConfig['ios']> = {}): GateConfig => ({
  android: { minBuild: 0, latestBuild: 0, storeUrl: PLAY, ...over },
  ios: { minBuild: 0, latestBuild: 0, storeUrl: TF, ...ios },
  message: null,
});

describe('decideGate', () => {
  test('default config (min 0) never blocks or nags', () => {
    expect(decideGate(config(), 1, 'android')).toEqual({ kind: 'none' });
    expect(decideGate(config(), 1, 'ios')).toEqual({ kind: 'none' });
  });
  test('blocks below minBuild, per platform', () => {
    const c = { ...config({ minBuild: 100 }, { minBuild: 50 }), message: 'Update ya' };
    expect(decideGate(c, 99, 'android')).toEqual({ kind: 'block', storeUrl: PLAY, message: 'Update ya' });
    expect(decideGate(c, 100, 'android')).toEqual({ kind: 'none' });
    expect(decideGate(c, 99, 'ios')).toEqual({ kind: 'none' });
    expect(decideGate(c, 49, 'ios')).toEqual({ kind: 'block', storeUrl: TF, message: 'Update ya' });
  });
  test('banner between minBuild and latestBuild, nothing at latest', () => {
    const c = config({ minBuild: 100, latestBuild: 120 });
    expect(decideGate(c, 110, 'android')).toEqual({ kind: 'banner', storeUrl: PLAY });
    expect(decideGate(c, 120, 'android')).toEqual({ kind: 'none' });
    expect(decideGate(c, 130, 'android')).toEqual({ kind: 'none' });
  });
  test('banner with min 0 when only latest is set', () => {
    expect(decideGate(config({ latestBuild: 10 }), 5, 'android')).toEqual({ kind: 'banner', storeUrl: PLAY });
  });
  test('fails open: no config, unreadable build, web', () => {
    expect(decideGate(null, 1, 'android')).toEqual({ kind: 'none' });
    expect(decideGate(config({ minBuild: 100 }), 0, 'android')).toEqual({ kind: 'none' });
    expect(decideGate(config({ minBuild: 100 }), 1, 'web')).toEqual({ kind: 'none' });
  });
  test('a platform without a usable store url never blocks', () => {
    expect(decideGate(config({ minBuild: 100, storeUrl: '' }), 1, 'android')).toEqual({ kind: 'none' });
  });
});

describe('parseGateConfig', () => {
  test('reads the server shape', () => {
    const parsed = parseGateConfig({
      android: { minBuild: 100, latestBuild: 120, storeUrl: PLAY },
      ios: { minBuild: 5, latestBuild: 4, storeUrl: TF },
      message: '  Halo  ',
    });
    expect(parsed).toEqual({
      android: { minBuild: 100, latestBuild: 120, storeUrl: PLAY },
      ios: { minBuild: 5, latestBuild: 5, storeUrl: TF },
      message: 'Halo',
    });
  });
  test('junk is null or off, never a block', () => {
    expect(parseGateConfig(null)).toBeNull();
    expect(parseGateConfig('x')).toBeNull();
    const bad = parseGateConfig({ android: { minBuild: '100', storeUrl: PLAY }, ios: { minBuild: 9, storeUrl: 'http://x' } }) as GateConfig;
    expect(bad.android.minBuild).toBe(0);
    expect(bad.ios.minBuild).toBe(0);
    expect(decideGate(bad, 1, 'ios')).toEqual({ kind: 'none' });
  });
  test('negative and fractional builds count as off', () => {
    const c = parseGateConfig({ android: { minBuild: -3, latestBuild: 1.5, storeUrl: PLAY }, ios: {} }) as GateConfig;
    expect(c.android).toMatchObject({ minBuild: 0, latestBuild: 0 });
  });
});

describe('cache', () => {
  const cached = { fetchedAt: NOW - 1000, config: config({ minBuild: 100, latestBuild: 100 }) };
  test('fresh inside the TTL only', () => {
    expect(isCacheFresh(cached, NOW)).toBe(true);
    expect(isCacheFresh({ ...cached, fetchedAt: NOW - CONFIG_TTL_MS }, NOW)).toBe(false);
    expect(isCacheFresh(null, NOW)).toBe(false);
  });
  test('a timestamp in the future is not trusted', () => {
    expect(isCacheFresh({ ...cached, fetchedAt: NOW + 5 }, NOW)).toBe(false);
  });
  test('needsFetch: fresh cache skips the network unless forced', () => {
    expect(needsFetch(cached, NOW, false)).toBe(false);
    expect(needsFetch(cached, NOW, true)).toBe(true);
    expect(needsFetch(null, NOW, false)).toBe(true);
  });
  test('resolve: fetched wins; failed fetch falls back to a fresh cache; stale cache fails open', () => {
    const fetched = config({ minBuild: 200 });
    expect(resolveGateConfig({ cached, fetched, now: NOW })).toBe(fetched);
    expect(resolveGateConfig({ cached, fetched: null, now: NOW })).toBe(cached.config);
    expect(resolveGateConfig({ cached: { ...cached, fetchedAt: NOW - CONFIG_TTL_MS - 1 }, fetched: null, now: NOW })).toBeNull();
    expect(resolveGateConfig({ cached: null, fetched: null, now: NOW })).toBeNull();
  });
  test('parseCachedConfig round trip and damage', () => {
    expect(parseCachedConfig(JSON.stringify(cached))).toEqual(cached);
    expect(parseCachedConfig('{')).toBeNull();
    expect(parseCachedConfig(null)).toBeNull();
    expect(parseCachedConfig(JSON.stringify({ fetchedAt: 'x', config: cached.config }))).toBeNull();
  });
});

describe('throttles', () => {
  test('gate re-check on resume', () => {
    expect(shouldRecheckGate(null, NOW)).toBe(true);
    expect(shouldRecheckGate(NOW - 1000, NOW)).toBe(false);
    expect(shouldRecheckGate(NOW - CONFIG_TTL_MS, NOW)).toBe(true);
    expect(shouldRecheckGate(NOW + 1000, NOW)).toBe(true);
  });
  test('cold-start OTA refresh skips only right after our own reload', () => {
    expect(shouldRefreshOtaAtLaunch(null, NOW)).toBe(true);
    expect(shouldRefreshOtaAtLaunch(NOW - 5000, NOW)).toBe(false);
    expect(shouldRefreshOtaAtLaunch(NOW - OTA_RELOAD_GUARD_MS, NOW)).toBe(true);
  });
});

describe('storeTargets', () => {
  const pkg = 'com.joyodigitama.joyofit';
  test('android: market link first, testing page as the second link', () => {
    expect(storeTargets('android', PLAY, pkg)).toEqual({ kind: 'play', primary: [`market://details?id=${pkg}`], secondary: PLAY });
  });
  test('android with a plain store page: market then https fallback', () => {
    const url = `https://play.google.com/store/apps/details?id=${pkg}`;
    expect(storeTargets('android', url, pkg)).toEqual({ kind: 'play', primary: [`market://details?id=${pkg}`, url], secondary: null });
  });
  test('ios: TestFlight join link opens the TestFlight app, https as fallback', () => {
    expect(storeTargets('ios', TF, pkg)).toEqual({ kind: 'testflight', primary: ['itms-beta://testflight.apple.com/join/GXzrQ8GJ', TF], secondary: null });
  });
  test('ios: App Store url as is', () => {
    expect(storeTargets('ios', 'https://apps.apple.com/app/id1', pkg)).toEqual({ kind: 'appstore', primary: ['https://apps.apple.com/app/id1'], secondary: null });
  });
});

import { describe, expect, test } from 'bun:test';
import { appKeys } from './appKeys';
import { LIVE_ROUTE, LIVE_URL } from '../record/liveRoute';
import { mapDeepLink, routePatterns } from './mapDeepLink';

const patterns = routePatterns([
  './_layout.tsx',
  './+native-intent.ts',
  './+not-found.tsx',
  './index.tsx',
  './today.tsx',
  './strength/_layout.tsx',
  './strength/index.tsx',
  './strength/history.tsx',
  './strength/summary/[id].tsx',
  './family/accept.tsx',
  './settings/strava.tsx',
  './(group)/inside.tsx',
  './docs/[...rest].tsx',
]);

describe('routePatterns', () => {
  test('layouts, +files and the root index are not routes; index folds into its folder; groups vanish', () => {
    expect([...patterns].sort()).toEqual(
      ['docs/[...rest]', 'family/accept', 'inside', 'settings/strava', 'strength', 'strength/history', 'strength/summary/[id]', 'today'].sort(),
    );
  });
  test('platform suffixes are dropped', () => {
    expect(routePatterns(['./a.ios.tsx', './b.native.ts', './c/index.android.tsx'])).toEqual(['a', 'b', 'c']);
  });
  test('the real app tree yields the strength screens', () => {
    const real = routePatterns(appKeys());
    expect(real).toContain('strength');
    expect(real).toContain('strength/summary/[id]');
    expect(real).toContain('settings/strava');
    expect(real).toContain('family/accept');
    expect(real.some((r) => r.startsWith('+') || r.includes('_layout'))).toBe(false);
  });
});

describe('mapDeepLink', () => {
  test('host form, path form, trailing slash and single slash reach the same route', () => {
    for (const url of ['joyofit://strength', 'joyofit:///strength', 'joyofit://strength/', 'joyofit:/strength', 'JOYOFIT://strength']) {
      expect(mapDeepLink(url, patterns)).toBe('/strength');
    }
  });
  test('nested and dynamic routes keep their path; the query is kept', () => {
    expect(mapDeepLink('joyofit://strength/history', patterns)).toBe('/strength/history');
    expect(mapDeepLink('joyofit://strength/summary/abc123', patterns)).toBe('/strength/summary/abc123');
    expect(mapDeepLink('joyofit://family/accept?code=ABCD2345', patterns)).toBe('/family/accept?code=ABCD2345');
    expect(mapDeepLink('joyofit://settings/strava?x=1&y=2', patterns)).toBe('/settings/strava?x=1&y=2');
    expect(mapDeepLink('joyofit://docs/a/b/c', patterns)).toBe('/docs/a/b/c');
  });
  test('the link of the recording notification is the live recording screen of the real app tree', () => {
    expect(mapDeepLink(LIVE_URL, routePatterns(appKeys()))).toBe(LIVE_ROUTE);
  });
  test('the app link and the launcher root are the home screen', () => {
    for (const url of ['joyofit://', 'joyofit:///', 'joyofit:', 'joyofit://?', 'joyofit://#x']) {
      expect(mapDeepLink(url, patterns)).toBe('/');
    }
    expect(mapDeepLink('joyofit:///?token=abc', patterns)).toBe('/?token=abc');
  });
  test('?open= names the route when the address has no path', () => {
    expect(mapDeepLink('joyofit://?open=strength', patterns)).toBe('/strength');
    expect(mapDeepLink('joyofit:///?open=strength%2Fhistory', patterns)).toBe('/strength/history');
    expect(mapDeepLink('joyofit://?open=strength&from=rogo', patterns)).toBe('/strength?from=rogo');
    expect(mapDeepLink('joyofit://?from=rogo&open=strength', patterns)).toBe('/strength?from=rogo');
  });
  test('?open= is an ordinary parameter when the address has a path', () => {
    expect(mapDeepLink('joyofit://strength?open=history', patterns)).toBe('/strength?open=history');
  });
  test('an unknown route, or an unknown ?open= target, is the home screen without its query', () => {
    expect(mapDeepLink('joyofit://nope', patterns)).toBe('/');
    expect(mapDeepLink('joyofit://strength/nope', patterns)).toBe('/');
    expect(mapDeepLink('joyofit://strength/summary', patterns)).toBe('/');
    expect(mapDeepLink('joyofit://?open=bike', patterns)).toBe('/');
    expect(mapDeepLink('joyofit://nope?code=1', patterns)).toBe('/');
    expect(mapDeepLink('joyofit://app/strength', patterns)).toBe('/');
  });
  test('an unreadable route list shapes the link without judging it', () => {
    expect(mapDeepLink('joyofit://anything/at/all?x=1', null)).toBe('/anything/at/all?x=1');
    expect(mapDeepLink('joyofit://?open=strength', null)).toBe('/strength');
  });
  test('other schemes and plain paths are returned untouched', () => {
    for (const url of [
      'https://fit.joyorogo.com/strength',
      'exp+joyofit://expo-development-client/?url=http%3A%2F%2F192.168.1.2%3A8081',
      'content://x/document/a.fit',
      '/strength',
      '',
    ]) {
      expect(mapDeepLink(url, patterns)).toBe(url);
    }
  });
});

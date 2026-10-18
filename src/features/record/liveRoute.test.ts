import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { mapDeepLink } from '../deeplink/mapDeepLink';
import {
  anchorLiveStack,
  APP_SCHEME,
  hasLive,
  isLive,
  isLivePath,
  liveState,
  LIVE_ROUTE,
  LIVE_URL,
  OPEN_LIVE,
  showLivePill,
  WORKOUTS_ROUTE,
  WORKOUTS_STACK,
} from './liveRoute';

const ROOT = join(import.meta.dir, '..', '..', '..');

describe('route and link constants', () => {
  test('the live link is the scheme plus the live route, and the deep link mapper turns it back into the route', () => {
    expect(LIVE_ROUTE).toBe('/workouts/record');
    expect(LIVE_URL).toBe('joyofit://workouts/record');
    expect(mapDeepLink(LIVE_URL, ['workouts/record', 'workouts'])).toBe(LIVE_ROUTE);
  });

  test('the scheme is the one of app.json and of the Android notification', () => {
    const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as { expo: { scheme: string } };
    expect(app.expo.scheme).toBe(APP_SCHEME);
    const kotlin = readFileSync(join(ROOT, 'modules/ble-sensors/android/src/main/java/com/joyodigitama/blesensors/NotificationTarget.kt'), 'utf8');
    expect(kotlin).toContain(`const val SCHEME = "${APP_SCHEME}"`);
  });

  test('the route and the stack screen names are files under src/app', () => {
    expect(existsSync(join(ROOT, 'src/app', `${LIVE_ROUTE}.tsx`))).toBe(true);
    expect(existsSync(join(ROOT, 'src/app', WORKOUTS_ROUTE, `${WORKOUTS_STACK.live}.tsx`))).toBe(true);
    expect(existsSync(join(ROOT, 'src/app', WORKOUTS_ROUTE, `${WORKOUTS_STACK.list}.tsx`))).toBe(true);
  });

  test('opening the live screen reuses a live screen on top and anchors a new Workouts stack on the list', () => {
    expect(OPEN_LIVE).toEqual({ withAnchor: true });
  });
});

describe('live state', () => {
  test('a recording is live in every phase but idle, and the card needs a sport as well', () => {
    expect(isLive('idle')).toBe(false);
    for (const phase of ['ready', 'active', 'saving'] as const) expect(isLive(phase)).toBe(true);
    expect(hasLive('active', 'run')).toBe(true);
    expect(hasLive('active', null)).toBe(false);
    expect(hasLive('idle', 'run')).toBe(false);
  });

  test('the wording follows the phase and the recorder status', () => {
    expect(liveState('ready', 'idle')).toBe('ready');
    expect(liveState('active', 'recording')).toBe('recording');
    expect(liveState('saving', 'recording')).toBe('recording');
    expect(liveState('active', 'paused')).toBe('paused');
    expect(liveState('active', 'finished')).toBe('unsaved');
  });

  test('the live path is the route, with or without a trailing slash', () => {
    expect(isLivePath('/workouts/record')).toBe(true);
    expect(isLivePath('/workouts/record/')).toBe(true);
    for (const path of ['/workouts', '/', '/watch/sensors', '/workouts/record/1', '/onboarding']) expect(isLivePath(path)).toBe(false);
  });
});

describe('the pill above the tab bar', () => {
  const base = { phase: 'active', sport: 'run', pathname: '/', tabBarHidden: false } as const;

  test('shows on every tab while a recording exists', () => {
    for (const pathname of ['/', '/workouts', '/social', '/watch', '/watch/sensors', '/settings']) {
      expect(showLivePill({ ...base, pathname })).toBe(true);
    }
    expect(showLivePill({ ...base, phase: 'ready' })).toBe(true);
    expect(showLivePill({ ...base, phase: 'saving' })).toBe(true);
  });

  test('hides while idle, on the live screen and where the tab bar is hidden', () => {
    expect(showLivePill({ ...base, phase: 'idle' })).toBe(false);
    expect(showLivePill({ ...base, sport: null })).toBe(false);
    expect(showLivePill({ ...base, pathname: LIVE_ROUTE })).toBe(false);
    expect(showLivePill({ ...base, tabBarHidden: true })).toBe(false);
  });
});

describe('back from the live screen', () => {
  const r = (name: string, key = name) => ({ name, key });
  const list = () => ({ name: 'index', key: 'index-new' });

  test('a Workouts stack that is [list, live] already pops onto the list: nothing to change', () => {
    expect(anchorLiveStack([r('index'), r('record')], 'active', list)).toBeNull();
  });

  test('a live screen on its own gets the list under it', () => {
    expect(anchorLiveStack([r('record')], 'active', list)?.map((x) => x.name)).toEqual(['index', 'record']);
  });

  test('Manual entry or a workout detail under the live screen is replaced by the list, keeping the existing list entry', () => {
    const index = r('index', 'index-1');
    const next = anchorLiveStack([index, r('manual'), r('record')], 'active', list);
    expect(next?.map((x) => x.name)).toEqual(['index', 'record']);
    expect(next?.[0]).toBe(index);
    expect(anchorLiveStack([r('index'), r('[id]'), r('record')], 'ready', list)?.map((x) => x.name)).toEqual(['index', 'record']);
    expect(anchorLiveStack([r('manual'), r('record')], 'saving', list)?.map((x) => x.name)).toEqual(['index', 'record']);
  });

  test('routes above the live screen stay', () => {
    expect(anchorLiveStack([r('record'), r('manual')], 'active', list)?.map((x) => x.name)).toEqual(['index', 'record', 'manual']);
  });

  test('without a live recording back is the default pop: setup, and after save or discard (the replace to the detail, the back or replace to the list)', () => {
    expect(anchorLiveStack([r('record')], 'idle', list)).toBeNull();
    expect(anchorLiveStack([r('index'), r('manual'), r('record')], 'idle', list)).toBeNull();
  });

  test('a stack without the live screen is left alone', () => {
    expect(anchorLiveStack([r('index'), r('[id]')], 'active', list)).toBeNull();
  });
});

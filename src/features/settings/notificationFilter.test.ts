import { describe, expect, test } from 'bun:test';

import type { NotificationFilterApp, NotificationFilterStatus, NotificationFilterTest } from '@/wear';

import { isTestRunning, rowEnabled, switchesEnabled, testableApps, testBlock } from './notificationFilter';

const app = (packageName: string, sendable: boolean): NotificationFilterApp => ({ packageName, label: packageName, enabled: true, sendable });

function status(patch: Partial<NotificationFilterStatus> = {}): NotificationFilterStatus {
  return {
    connected: true,
    gate: true,
    ancs: true,
    encoding: null,
    apps: [app('com.apple.MobileSMS', false), app('other', false)],
    test: null,
    restorePending: false,
    report: null,
    ...patch,
  };
}

const probe: NotificationFilterTest = { phase: 'probe', app: 'com.apple.MobileSMS', candidate: 'A', step: 1, steps: 4, outcome: null, report: null };
const done: NotificationFilterTest = { ...probe, phase: 'finished', outcome: 'none', report: 'line' };

describe('what blocks the test', () => {
  test('a ready watch has nothing in the way', () => expect(testBlock(status())).toBeNull());
  test('the person fixes them in order: connect, capability, iOS sharing', () => {
    expect(testBlock(status({ connected: false, gate: false, ancs: false }))).toBe('disconnected');
    expect(testBlock(status({ gate: false, ancs: false }))).toBe('noGate');
    expect(testBlock(status({ ancs: false }))).toBe('noAncs');
  });
});

describe('the switches', () => {
  test('stay off until a test proved the encoding', () => {
    expect(switchesEnabled(status())).toBe(false);
    expect(switchesEnabled(status({ encoding: 'A' }))).toBe(true);
  });
  test('stay off while a test runs, and come back once it finished', () => {
    expect(isTestRunning(status({ encoding: 'A', test: probe }))).toBe(true);
    expect(switchesEnabled(status({ encoding: 'A', test: probe }))).toBe(false);
    expect(isTestRunning(status({ test: done }))).toBe(false);
    expect(switchesEnabled(status({ encoding: 'B', test: done }))).toBe(true);
  });
  test('a row needs an id in the proven encoding', () => {
    const s = status({ encoding: 'C1', apps: [app('com.apple.MobileSMS', true), app('jp.naver.line', false)] });
    expect(rowEnabled(s, s.apps[0])).toBe(true);
    expect(rowEnabled(s, s.apps[1])).toBe(false);
  });
});

describe('the apps a test can use', () => {
  test('never the catch-all row', () => {
    expect(testableApps(status()).map((a) => a.packageName)).toEqual(['com.apple.MobileSMS']);
  });
});

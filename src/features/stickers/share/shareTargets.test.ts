import { describe, expect, test } from 'bun:test';

import {
  canSaveToLibrary,
  instagramRoute,
  resolveFacebookAppId,
} from './shareTargets';

describe('resolveFacebookAppId', () => {
  test('prefers the env value and trims it', () => {
    expect(resolveFacebookAppId(' 123 ', '456')).toBe('123');
  });
  test('falls back to expo.extra when env is unset or blank', () => {
    expect(resolveFacebookAppId(undefined, '456')).toBe('456');
    expect(resolveFacebookAppId('  ', '456')).toBe('456');
  });
  test('is null when neither is set', () => {
    expect(resolveFacebookAppId(undefined, undefined)).toBeNull();
    expect(resolveFacebookAppId('', ' ')).toBeNull();
  });
});

describe('instagramRoute', () => {
  test('goes straight to Stories with an App ID', () => {
    expect(instagramRoute('123', 'ios', false)).toBe('stories');
    expect(instagramRoute('123', 'android', true)).toBe('stories');
  });
  test('without an App ID hands the PNG to the Instagram app', () => {
    expect(instagramRoute(null, 'android', false)).toBe('instagram');
    expect(instagramRoute(null, 'android', true)).toBe('instagram');
    expect(instagramRoute(null, 'ios', false)).toBe('instagram');
  });
  test('keeps the iOS sticker transparent by using the system sheet', () => {
    expect(instagramRoute(null, 'ios', true)).toBe('system');
  });
});

describe('canSaveToLibrary', () => {
  test('is offered on iOS and Android 11 and newer', () => {
    expect(canSaveToLibrary('ios', 0)).toBe(true);
    expect(canSaveToLibrary('android', 34)).toBe(true);
    expect(canSaveToLibrary('android', 30)).toBe(true);
  });
  test('is not offered on Android 10', () => {
    expect(canSaveToLibrary('android', 29)).toBe(false);
  });
});

import { describe, expect, test } from 'bun:test';

import {
  formatFaceSize,
  isWebFaceInstalled,
  parseWebFaces,
  toUnixSeconds,
  webInstallBlock,
  webLibraryState,
  type WebFace,
} from './webLibraryModel';

const face = (id: string): WebFace => ({ id, name: id, filename: `${id}.hwt`, size: 10, sha256: 'x', createdAt: 1 });
const base = { configured: true, signedIn: true, sessionPending: false };

describe('webLibraryState', () => {
  test('cloud not set up wins, then session states', () => {
    expect(webLibraryState({ ...base, configured: false, load: { status: 'idle' } })).toBe('notConfigured');
    expect(webLibraryState({ ...base, sessionPending: true, load: { status: 'idle' } })).toBe('loading');
    expect(webLibraryState({ ...base, signedIn: false, load: { status: 'idle' } })).toBe('signedOut');
  });
  test('load states', () => {
    expect(webLibraryState({ ...base, load: { status: 'idle' } })).toBe('loading');
    expect(webLibraryState({ ...base, load: { status: 'loading' } })).toBe('loading');
    expect(webLibraryState({ ...base, load: { status: 'error' } })).toBe('error');
    expect(webLibraryState({ ...base, load: { status: 'loaded', faces: [] } })).toBe('empty');
    expect(webLibraryState({ ...base, load: { status: 'loaded', faces: [face('a')] } })).toBe('ready');
  });
});

describe('parseWebFaces', () => {
  test('keeps good rows newest first, drops broken ones, falls back to the filename', () => {
    const out = parseWebFaces({
      watchfaces: [
        { id: 'a', name: 'Old', filename: 'old.hwt', size: 2048, sha256: 's', createdAt: 1_700_000_000 },
        { id: 'b', name: ' ', filename: 'neon.hwt', size: 5, sha256: 's', createdAt: 1_800_000_000_000 },
        { name: 'no id' },
        null,
        { id: 'c', name: '', filename: '' },
      ],
    });
    expect(out.map((f) => f.id)).toEqual(['b', 'a']);
    expect(out[0].name).toBe('neon');
    expect(out[0].createdAt).toBe(1_800_000_000);
  });
  test('garbage bodies give an empty list', () => {
    expect(parseWebFaces(null)).toEqual([]);
    expect(parseWebFaces({ watchfaces: 'x' })).toEqual([]);
  });
});

test('toUnixSeconds takes seconds, milliseconds and ISO', () => {
  expect(toUnixSeconds(1_700_000_000)).toBe(1_700_000_000);
  expect(toUnixSeconds(1_700_000_000_000)).toBe(1_700_000_000);
  expect(toUnixSeconds('2023-11-14T22:13:20Z')).toBe(1_700_000_000);
  expect(toUnixSeconds('nope')).toBeNull();
});

test('formatFaceSize', () => {
  expect(formatFaceSize(100)).toBe('1 KB');
  expect(formatFaceSize(812 * 1024)).toBe('812 KB');
  expect(formatFaceSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
});

test('isWebFaceInstalled matches names case-insensitively', () => {
  expect(isWebFaceInstalled({ name: 'Neon ' }, [{ name: 'neon' }])).toBe(true);
  expect(isWebFaceInstalled({ name: 'Neon' }, [{ name: 'Other' }])).toBe(false);
  expect(isWebFaceInstalled({ name: 'Neon' }, undefined)).toBe(false);
});

test('webInstallBlock priority: installed, not connected, busy', () => {
  expect(webInstallBlock({ connected: false, idle: true, installed: true })).toBe('installed');
  expect(webInstallBlock({ connected: false, idle: true, installed: false })).toBe('notConnected');
  expect(webInstallBlock({ connected: true, idle: false, installed: false })).toBe('busy');
  expect(webInstallBlock({ connected: true, idle: true, installed: false })).toBeNull();
});

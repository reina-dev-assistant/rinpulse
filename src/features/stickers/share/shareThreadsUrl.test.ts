import { describe, expect, test } from 'bun:test';

import { THREADS_TEXT_MAX } from '../threads/caption';
import { THREADS_COMPOSER, clipThreadsText, threadsComposerUrl } from './shareThreadsUrl';

describe('clipThreadsText', () => {
  test('leaves a text within the limit alone', () => {
    const text = 'a'.repeat(THREADS_TEXT_MAX);
    expect(clipThreadsText(text)).toBe(text);
  });
  test('cuts a longer text to 500 characters', () => {
    expect(clipThreadsText('b'.repeat(900))).toHaveLength(THREADS_TEXT_MAX);
  });
  test('never splits a surrogate pair', () => {
    const clipped = clipThreadsText(`${'c'.repeat(THREADS_TEXT_MAX - 1)}\u{1F3C3}tail`);
    expect(clipped.endsWith('\u{1F3C3}')).toBe(true);
    expect(Array.from(clipped)).toHaveLength(THREADS_TEXT_MAX);
  });
});

describe('threadsComposerUrl', () => {
  test('percent-encodes newlines, spaces, hashtags and non-ASCII text', () => {
    const url = threadsComposerUrl('Lari 5,2 km\n#JoyoFit \u00b7 ok');
    expect(url).toBe(`${THREADS_COMPOSER}?text=Lari%205%2C2%20km%0A%23JoyoFit%20%C2%B7%20ok`);
  });
  test('clips the text before encoding', () => {
    const url = threadsComposerUrl('d'.repeat(800));
    expect(decodeURIComponent(url.split('?text=')[1]!)).toHaveLength(THREADS_TEXT_MAX);
  });
  test('an empty caption opens an empty composer', () => {
    expect(threadsComposerUrl('')).toBe(`${THREADS_COMPOSER}?text=`);
  });
});

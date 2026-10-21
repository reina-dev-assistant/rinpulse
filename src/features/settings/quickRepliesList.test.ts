import { describe, expect, test } from 'bun:test';

import {
  defaultReplies,
  FALLBACK_LIMITS,
  moveReply,
  normalizeReplies,
  parseReplies,
  removeReply,
  sameReplies,
  validateReplies,
} from './quickRepliesList';

const limits = { slots: 3, maxLength: 5 };

describe('quick replies validation', () => {
  test('a fine list passes', () => {
    expect(validateReplies(['Otw', 'Oke'], limits)).toEqual({ items: [null, null], list: null, ok: true });
  });

  test('an empty list is refused: the watch needs at least one', () => {
    expect(validateReplies([], limits)).toEqual({ items: [], list: 'none', ok: false });
  });

  test('more replies than slots', () => {
    const result = validateReplies(['a', 'b', 'c', 'd'], limits);
    expect(result.list).toBe('tooMany');
    expect(result.ok).toBe(false);
  });

  test('blank, too long and multi-line replies are flagged per row', () => {
    const result = validateReplies(['  ', 'enam!!', 'a\nb', 'ok'], { slots: 10, maxLength: 5 });
    expect(result.items).toEqual(['empty', 'tooLong', 'multiline', null]);
    expect(result.ok).toBe(false);
  });

  test('the limit counts trimmed characters, an emoji as one', () => {
    expect(validateReplies(['  12345  '], limits).ok).toBe(true);
    expect(validateReplies(['👍👍👍👍👍'], limits).ok).toBe(true);
    expect(validateReplies(['👍👍👍👍👍👍'], limits).items).toEqual(['tooLong']);
  });

  test('the defaults fit the fallback limits in both languages', () => {
    for (const locale of ['id', 'en']) {
      expect(validateReplies(defaultReplies(locale), FALLBACK_LIMITS).ok).toBe(true);
    }
  });

  test('Indonesian defaults are the agreed six, English is used only for en', () => {
    expect(defaultReplies('id')).toEqual(['Otw', 'Nanti kukabari', 'Lagi nyetir', 'Oke', 'Siap', 'Bentar ya']);
    expect(defaultReplies('en')).not.toEqual(defaultReplies('id'));
    expect(defaultReplies('fr')).toEqual(defaultReplies('id'));
  });
});

describe('quick replies editing', () => {
  test('move and remove leave the input alone', () => {
    const list = ['a', 'b', 'c'];
    expect(moveReply(list, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveReply(list, 2, 1)).toEqual(['a', 'c', 'b']);
    expect(moveReply(list, 0, 3)).toEqual(list);
    expect(removeReply(list, 1)).toEqual(['a', 'c']);
    expect(list).toEqual(['a', 'b', 'c']);
  });

  test('normalize trims, parse rejects anything but strings, sameReplies compares in order', () => {
    expect(normalizeReplies([' a ', 'b'])).toEqual(['a', 'b']);
    expect(parseReplies(['a'])).toEqual(['a']);
    expect(() => parseReplies('a')).toThrow();
    expect(() => parseReplies([1])).toThrow();
    expect(sameReplies(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameReplies(['a', 'b'], ['b', 'a'])).toBe(false);
  });
});

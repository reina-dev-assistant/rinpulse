import { describe, expect, test } from 'bun:test';

import { fitMonoSize, MIN_FIT_SCALE, monoAdvance, monoWidth } from './numeralFit';

/** The Titik medium numeral: Doto at 26 px with -0.4 tracking, in the 86 px the hero ring leaves. */
const hero = (text: string) => fitMonoSize({ text, size: 26, tracking: -0.4, advance: 0.6, maxWidth: 86 });

describe('monoAdvance', () => {
  test('Doto and JetBrains Mono are monospaced at 0.6 em; proportional faces are not', () => {
    expect(monoAdvance('Doto_900Black')).toBe(0.6);
    expect(monoAdvance('JetBrainsMono_800ExtraBold')).toBe(0.6);
    expect(monoAdvance('Manrope_800ExtraBold')).toBeNull();
  });
});

describe('fitMonoSize', () => {
  test('0, 1, 7,825 and 8,000 fit at the themed size', () => {
    for (const text of ['0', '1', '7,825', '8,000']) expect(hero(text)).toBe(26);
  });
  test('10,000 and 30,000 shrink by their width, and then fit', () => {
    for (const text of ['10,000', '30,000', '99,999']) {
      const size = hero(text);
      expect(size).toBeLessThan(26);
      expect(monoWidth(text, size, -0.4, 0.6)).toBeLessThanOrEqual(86);
      // One point larger would not fit: the figure is as big as the room allows.
      expect(monoWidth(text, size + 1, -0.4, 0.6)).toBeGreaterThan(86);
    }
  });
  test('100,000 is smaller than 30,000 and still fits', () => {
    expect(hero('100,000')).toBeLessThan(hero('30,000'));
    expect(monoWidth('100,000', hero('100,000'), -0.4, 0.6)).toBeLessThanOrEqual(86);
  });
  test('the Indonesian separator is as wide as the English one', () => {
    expect(hero('30.000')).toBe(hero('30,000'));
  });
  test('never below half the themed size, however long the text', () => {
    expect(hero('1,000,000,000')).toBe(Math.floor(26 * MIN_FIT_SCALE));
  });
  test('no usable room or no text leaves the size alone', () => {
    for (const maxWidth of [0, NaN, -10]) expect(fitMonoSize({ text: '30,000', size: 26, tracking: -0.4, advance: 0.6, maxWidth })).toBe(26);
    expect(fitMonoSize({ text: '', size: 26, tracking: 0, advance: 0.6, maxWidth: 10 })).toBe(26);
  });
  test('a bigger numeral (hero 56) scales down for the same room', () => {
    const size = fitMonoSize({ text: '30,000', size: 56, tracking: -1, advance: 0.6, maxWidth: 150 });
    expect(size).toBeLessThan(56);
    expect(monoWidth('30,000', size, -1, 0.6)).toBeLessThanOrEqual(150);
  });
});

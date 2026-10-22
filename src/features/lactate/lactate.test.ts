import { describe, expect, it } from 'bun:test';

import { currentLactate, watchLactate, type LactateValue } from './values';

const w = (id: number, end: number, additional?: Record<string, string>) => ({ workout: { id, start: end - 3600, end }, summary: { additional } });

describe('watchLactate', () => {
  it('takes the newest workout that carries a plausible threshold heart rate', () => {
    const v = watchLactate([w(3, 3000, undefined), w(2, 2000, { lthrHr: '167', lthrPace: '312' }), w(1, 1000, { lthrHr: '160', lthrPace: '330' })]);
    expect(v).toEqual({ lthr: 167, paceSecKm: 312, at: 2000, source: 'watch', workoutId: 2 });
  });

  it('drops implausible values and keeps a heart rate whose pace is not a seconds-per-km figure', () => {
    expect(watchLactate([w(1, 1000, { lthrHr: '0', lthrPace: '300' })])).toBeNull();
    expect(watchLactate([w(1, 1000, { lthrHr: 'abc' })])).toBeNull();
    expect(watchLactate([w(1, 1000, { lthrHr: '171', lthrPace: '3.4' })])?.paceSecKm).toBeNull();
  });

  it('is null without any workout totals extension', () => {
    expect(watchLactate([])).toBeNull();
    expect(watchLactate([w(1, 1000)])).toBeNull();
  });
});

describe('currentLactate', () => {
  const test: LactateValue = { lthr: 168, paceSecKm: 305, at: 200, source: 'test', workoutId: 5 };
  const watch: LactateValue = { lthr: 165, paceSecKm: 312, at: 100, source: 'watch', workoutId: 4 };

  it('puts the newer first and keeps the other', () => {
    expect(currentLactate(test, watch)).toEqual({ current: test, other: watch });
    expect(currentLactate(test, { ...watch, at: 300 })?.current.source).toBe('watch');
  });

  it('is the one there is, or nothing', () => {
    expect(currentLactate(null, watch)).toEqual({ current: watch, other: null });
    expect(currentLactate(test, null)).toEqual({ current: test, other: null });
    expect(currentLactate(null, null)).toBeNull();
  });
});

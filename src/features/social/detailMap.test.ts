import { describe, expect, test } from 'bun:test';

import type { RogoWorkoutDetail } from '@/cloud/rogo';
import { detailMapOf } from './detailMap';

const detail = (over: Partial<RogoWorkoutDetail>): RogoWorkoutDetail => ({ locked: false, hr: null, route: null, analysis: null, ...over });
const analysis = (series: unknown) => ({ series }) as unknown as RogoWorkoutDetail['analysis'];

describe('detailMapOf', () => {
  test('a full analysis with a track draws the map, so the post screen shows it only once', () => {
    expect(detailMapOf(detail({ analysis: analysis({ n: 10, track: [null, [1, 2]] }) }))).toBe('shown');
  });

  test('a full analysis without a track or series has no map', () => {
    expect(detailMapOf(detail({ analysis: analysis({ n: 10, track: [null, null] }) }))).toBe('none');
    expect(detailMapOf(detail({ analysis: analysis({ n: 10, track: null }) }))).toBe('none');
    expect(detailMapOf(detail({ analysis: analysis(null) }))).toBe('none');
  });

  test('the basic view draws a map from two route points', () => {
    expect(detailMapOf(detail({ route: [[1, 2], [3, 4]] }))).toBe('shown');
    expect(detailMapOf(detail({ route: [[1, 2]] }))).toBe('none');
  });

  test('a locked viewer gets no map from the analysis, so the post keeps its own', () => {
    expect(detailMapOf(detail({ locked: true }))).toBe('none');
  });
});

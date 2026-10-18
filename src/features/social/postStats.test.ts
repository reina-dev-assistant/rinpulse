import { describe, expect, test } from 'bun:test';

import type { RogoPost } from '@/cloud/rogo';
import { applyLocale } from '@/i18n';
import { postFigures, watchStats } from './postStats';

const post = { durationMin: 42, kcal: 1234, createdAt: '2026-01-01T00:00:00Z', stats: null } as unknown as RogoPost;

/** A JoyoFit workout post; `stats` fields are added to the base ones a post always has. */
function watchPost(over: Partial<RogoPost> = {}, stats: Record<string, number | string | null> = {}): RogoPost {
  return {
    title: 'Outdoor run',
    durationMin: 29,
    kcal: 321,
    createdAt: '2026-01-01T00:00:00Z',
    stats: { source: 'joyofit', distanceM: 5230, avgHr: 152, maxHr: 178, startedAt: 1_767_225_600_000, hasDetail: 1, ...stats },
    ...over,
  } as unknown as RogoPost;
}

describe('postFigures', () => {
  test('labels and values follow the language', async () => {
    expect(postFigures(post)).toEqual([
      { label: 'Waktu', value: '42 mnt' },
      { label: 'Energi', value: '1.234 kcal' },
    ]);
    await applyLocale('en');
    try {
      expect(postFigures(post)).toEqual([
        { label: 'Time', value: '42 min' },
        { label: 'Energy', value: '1,234 kcal' },
      ]);
    } finally {
      await applyLocale('id');
    }
  });

  test('a run shows distance, moving time, pace, elevation, then energy and heart rate', () => {
    const run = watchPost({}, { sportKind: 'run', movingSec: 1500, elevGainM: 42 });
    expect(postFigures(run)).toEqual([
      { label: 'Jarak', value: '5,23 km' },
      { label: 'Waktu', value: '25 mnt' },
      { label: 'Pace', value: '4:47 /km' },
      { label: 'Tanjakan', value: '42 m' },
      { label: 'Energi', value: '321 kcal' },
      { label: 'Detak rata-rata', value: '152 bpm' },
      { label: 'Detak maks', value: '178 bpm' },
    ]);
  });

  test('a ride shows speed instead of pace, and one decimal of distance from 10 km', () => {
    const ride = watchPost({ title: 'Outdoor cycling', kcal: null }, { distanceM: 30000, avgHr: null, maxHr: null, sportKind: 'ride', movingSec: 3600, elevGainM: null });
    expect(postFigures(ride)).toEqual([
      { label: 'Jarak', value: '30,0 km' },
      { label: 'Waktu', value: '1 j 00 mnt' },
      { label: 'Kecepatan', value: '30,0 km/j' },
    ]);
  });

  test('an old post without sport kind or moving time falls back to the title and the duration', () => {
    const old = watchPost({ title: 'Lari pagi', durationMin: 20, kcal: null }, { distanceM: 3000, avgHr: null, maxHr: null });
    expect(postFigures(old)).toEqual([
      { label: 'Jarak', value: '3,00 km' },
      { label: 'Waktu', value: '20 mnt' },
      { label: 'Pace', value: '6:40 /km' },
    ]);
  });

  test('no pace for other sports, no elevation when there is no climb', () => {
    const swim = watchPost({ title: 'Pool swim', kcal: null }, { distanceM: 1000, avgHr: null, maxHr: null, sportKind: 'swim', movingSec: 1200, elevGainM: 0 });
    expect(postFigures(swim).map((figure) => figure.label)).toEqual(['Jarak', 'Waktu']);
  });

  test('English words and decimals', async () => {
    await applyLocale('en');
    try {
      const ride = watchPost({ title: 'Outdoor cycling', kcal: null }, { distanceM: 30000, avgHr: null, maxHr: null, sportKind: 'ride', movingSec: 3600, elevGainM: 120 });
      expect(postFigures(ride)).toEqual([
        { label: 'Distance', value: '30.0 km' },
        { label: 'Time', value: '1 h 00 min' },
        { label: 'Speed', value: '30.0 km/h' },
        { label: 'Elev gain', value: '120 m' },
      ]);
    } finally {
      await applyLocale('id');
    }
  });
});

describe('watchStats', () => {
  test('reads the route and pace fields of a new post', () => {
    const stats = watchStats(watchPost({}, { sportKind: 'ride', movingSec: 1500, elevGainM: 42, hasMap: 1, showMap: 0 }));
    expect(stats).toMatchObject({ sportKind: 'ride', movingSec: 1500, elevGainM: 42, hasMap: 1, showMap: 0, distanceM: 5230, hasDetail: 1 });
  });

  test('an old post has no sport kind, no moving time, no elevation, no map and shows its map by default', () => {
    expect(watchStats(watchPost())).toMatchObject({ sportKind: null, movingSec: null, elevGainM: null, hasMap: 0, showMap: 1 });
  });

  test('an unknown sport kind is dropped, and only JoyoFit posts have watch stats', () => {
    expect(watchStats(watchPost({}, { sportKind: 'kayak' }))?.sportKind).toBeNull();
    expect(watchStats(post)).toBeNull();
  });
});

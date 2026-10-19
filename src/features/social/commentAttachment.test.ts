import { describe, expect, test } from 'bun:test';

import type { RogoAttachment } from '@/cloud/rogo';
import { attachmentCaption, attachmentFigures, attachmentTitle } from './commentAttachment';
import { commentImageResize } from './commentImage';

const attachment = (over: Partial<RogoAttachment>): RogoAttachment => ({
  kind: 'workout',
  title: '',
  date: null,
  mapLine: null,
  hasPhoto: false,
  stats: {},
  ...over,
});

describe('attachmentFigures', () => {
  test('a run shows distance, time, energy and heart rate; missing numbers are left out', () => {
    const figures = attachmentFigures(
      attachment({ title: 'Lari pagi', stats: { distanceM: 5230, durationMin: 29, kcal: 321, avgHr: null, sets: null } }),
    );
    expect(figures).toEqual([
      { label: 'Jarak', value: '5,23 km' },
      { label: 'Waktu', value: '29 mnt' },
      { label: 'Energi', value: '321 kcal' },
    ]);
  });

  test('a strength session shows sets and volume', () => {
    const figures = attachmentFigures(attachment({ stats: { durationMin: 50, sets: 18, volumeKg: 5400 } }));
    expect(figures.map((f) => f.label)).toEqual(['Waktu', 'Set', 'Volume']);
    expect(figures.at(-1)!.value).toBe('5.400 kg');
  });

  test('food words the meal and skips a single-item count', () => {
    const figures = attachmentFigures(attachment({ kind: 'food', stats: { meal: 'makan_siang', kcal: 540, protein: 30, items: 1 } }));
    expect(figures).toEqual([
      { label: 'Waktu makan', value: 'Makan siang' },
      { label: 'Energi', value: '540 kcal' },
      { label: 'Protein', value: '30 g' },
    ]);
  });

  test('weight signs the change', () => {
    const figures = attachmentFigures(attachment({ kind: 'weight', stats: { weightKg: 72.4, deltaKg: -0.6 } }));
    expect(figures).toEqual([
      { label: 'Berat', value: '72,4 kg' },
      { label: 'Perubahan', value: '−0,6 kg' },
    ]);
  });

  test('a recap pairs average energy with the target and days on target with logged days', () => {
    const figures = attachmentFigures(
      attachment({ kind: 'recap', stats: { avgKcal: 1850, targetKcal: 2000, daysOnTarget: 5, loggedDays: 7, streakDays: 4 } }),
    );
    expect(figures.map((f) => f.value)).toEqual(['1.850 / 2.000 kcal', '5 / 7', '4 hari']);
  });

  test('an image has no figures and an unknown stat type is ignored', () => {
    expect(attachmentFigures(attachment({ kind: 'image' }))).toEqual([]);
    expect(attachmentFigures(attachment({ kind: 'route', stats: { distanceM: 'far' } }))).toEqual([]);
  });
});

describe('titles', () => {
  test('the server title wins; kinds without one get a word', () => {
    expect(attachmentTitle(attachment({ title: 'Lari pagi' }))).toBe('Lari pagi');
    expect(attachmentTitle(attachment({ kind: 'weight' }))).toBe('Berat badan');
    expect(attachmentTitle(attachment({ kind: 'image' }))).toBe('Foto');
  });

  test('a recap names its week', () => {
    const caption = attachmentCaption(attachment({ kind: 'recap', stats: { weekStart: '2026-01-05', weekEnd: '2026-01-11' } }));
    expect(caption.startsWith('Rekap mingguan · ')).toBe(true);
  });
});

describe('commentImageResize', () => {
  test('shrinks the longer side to 1280 and leaves small pictures alone', () => {
    expect(commentImageResize(4000, 3000)).toEqual({ width: 1280 });
    expect(commentImageResize(3000, 4000)).toEqual({ height: 1280 });
    expect(commentImageResize(1000, 800)).toBeNull();
    expect(commentImageResize(Number.NaN, 800)).toBeNull();
  });
});

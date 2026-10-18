import type { TemplateInput } from '../core/schema';
import { tl } from './blocks';
import { kit, template, type Kit, type LayerJson } from './dsl';
import { INK, STICKER } from './palette';
import { RANGE, brandRow, dayBars } from './recap-parts';

/** The status word is tinted by the ratio: cool when the load drops, green when it is balanced, warm when it climbs fast. */
const TONES: { color: string; when: Record<string, unknown> }[] = [
  { color: '$accent2', when: { bind: 'load.ratio', lt: 0.8 } },
  { color: '$good', when: { all: [{ bind: 'load.ratio', gte: 0.8 }, { bind: 'load.ratio', lte: 1.3 }] } },
  { color: '$warn', when: { bind: 'load.ratio', gt: 1.3 } },
];

interface StatusStyle {
  size: number;
  labelSize: number;
  labelColor?: string;
  align?: 'left' | 'right' | 'center';
  w?: 'auto' | 'fill';
}

/** The status word (`load.status`), one layer per tone; without a ratio there is no status, so none shows. */
function status(k: Kit, s: StatusStyle): LayerJson[] {
  return TONES.map((tone) =>
    k.stat({ w: s.w ?? 'auto', h: 'auto' }, '{load.status}', {
      label: tl('tpl.load.text.status'),
      size: s.size,
      labelSize: s.labelSize,
      labelColor: s.labelColor,
      align: s.align,
      color: tone.color,
      labelPos: 'above',
      minSize: 44,
      when: tone.when,
    }),
  );
}

const ratio = (k: Kit, size: number, labelSize: number, align: 'left' | 'right' | 'center' = 'left', color = '$fg') =>
  k.stat({ w: 'auto', h: 'auto' }, '{load.ratio|num:2}', { label: tl('tpl.load.text.ratio'), size, labelSize, color, align, labelPos: 'above', minSize: 40 });

const total = (k: Kit, size: number, labelSize: number, color: string, align: 'left' | 'right' | 'center' = 'left') =>
  k.stat({ w: 'auto', h: 'auto' }, '{load.totalStrain|num:1}', { label: tl('tpl.load.text.total'), size, labelSize, color, align, labelPos: 'above', minSize: 60 });

const sessions = (k: Kit, size: number, labelSize: number, align: 'left' | 'right' | 'center' = 'left') =>
  k.stat({ w: 'auto', h: 'auto' }, '{load.sessions|int}', { label: tl('label.workouts'), size, labelSize, align, labelPos: 'above', minSize: 40 });

/** Strain is a 0..21 scale: the bars share that ceiling so a light week looks light. */
const bars = (k: Kit, o: { w: number | 'fill'; h: number | 'fill'; color2: string; labelSize: number; barRadius: number }) =>
  dayBars(k, { w: o.w, h: o.h, series: 'load.dayStrain', labels: 'load.dayLabels', today: 'week.todayIndex', max: 21, color: '$accent', color2: o.color2, labelSize: o.labelSize, barRadius: o.barRadius });

/** `load.bars.story`: teal ink and amber. Total strain is the poster number, the status word sits under it, the bars close. */
function loadBarsStory(): TemplateInput {
  const k = kit('lb');
  const header = k.group(
    { w: 'fill', h: 96 },
    [
      k.group({ w: 96, h: 96 }, [k.shape({ x: 0, y: 0, w: 96, h: 96 }, 'ellipse', { fill: '$surfaceStrong' }), k.icon({ x: 24, y: 24, w: 48, h: 48 }, 'pulse', '$fg')]),
      k.text({ w: 'fill' }, tl('tpl.load.text.title'), { size: 44, weight: 800, upper: true, ls: 3, minSize: 30 }),
      k.text({ w: 'auto' }, RANGE, { size: 34, weight: 600, color: '$fgMuted', align: 'right' }),
    ],
    { dir: 'row', gap: 24, align: 'center' },
  );
  const strain = k.group({ w: 'fill', h: 'auto' }, [total(k, 380, 34, '$accent')], { dir: 'column' });
  const state = k.group(
    { w: 'fill', h: 'auto' },
    [k.group({ w: 'fill', h: 'auto' }, status(k, { size: 104, labelSize: 30, labelColor: '$fgMuted' }), { dir: 'column' }), ratio(k, 104, 30, 'right')],
    { dir: 'row', gap: 36, align: 'end' },
  );
  const chart = bars(k, { w: 936, h: 'fill', color2: '$fg/22', labelSize: 32, barRadius: 20 });
  const root = k.group({ x: 72, y: 250, w: 936, h: 1190 }, [header, strain, state, ...chart], { dir: 'column', gap: 56, align: 'stretch' });

  return template({
    id: 'load.bars.story',
    name: 'Load, bars, story',
    titleKey: 'stickers:tpl.load.bars',
    kind: 'load',
    style: 'bold',
    aspect: 'story',
    background: { kind: 'gradient', angle: 160, stops: [{ at: 0, color: '$bg' }, { at: 1, color: '$bg2' }] },
    dark: INK.dark,
    light: INK.light,
    layers: [root, k.group({ x: 72, y: 1510, w: 936, h: 56 }, [brandRow(k, 56, 30)], { dir: 'column', align: 'stretch' })],
    meta: { tags: ['numbers', 'chart'] },
  });
}

/** `load.bars.square`: status headline, a wide bar chart, the three numbers along the bottom. */
function loadBarsSquare(): TemplateInput {
  const k = kit('ls');
  const header = k.group(
    { w: 'fill', h: 64 },
    [
      k.text({ w: 'fill' }, tl('tpl.load.text.title'), { size: 40, weight: 800, upper: true, ls: 3, minSize: 28 }),
      k.text({ w: 'auto' }, RANGE, { size: 32, weight: 600, color: '$fgMuted', align: 'right' }),
    ],
    { dir: 'row', gap: 24, align: 'center' },
  );
  const headline = k.group({ w: 'fill', h: 'auto' }, status(k, { size: 150, labelSize: 30, labelColor: '$fgMuted', w: 'fill' }), { dir: 'column' });
  const chart = bars(k, { w: 952, h: 'fill', color2: '$fg/22', labelSize: 28, barRadius: 16 });
  const cells = k.group({ w: 'fill', h: 'auto' }, [total(k, 84, 26, '$accent'), ratio(k, 84, 26), sessions(k, 84, 26)], { dir: 'row', gap: 56, align: 'start' });
  const root = k.group({ x: 64, y: 64, w: 952, h: 952 }, [header, headline, ...chart, cells, brandRow(k, 48, 26)], { dir: 'column', gap: 36, align: 'stretch' });

  return template({
    id: 'load.bars.square',
    name: 'Load, bars, square',
    titleKey: 'stickers:tpl.load.bars',
    kind: 'load',
    style: 'bold',
    aspect: 'square',
    background: { kind: 'gradient', angle: 160, stops: [{ at: 0, color: '$bg' }, { at: 1, color: '$bg2' }] },
    dark: INK.dark,
    light: INK.light,
    layers: [root],
    meta: { tags: ['numbers', 'chart'] },
  });
}

/** `load.stats.sticker`: status and total strain over seven bars on a compact panel. */
function loadStatsSticker(): TemplateInput {
  const k = kit('lt');
  const top = k.group(
    { w: 'fill', h: 'auto' },
    [k.group({ w: 'fill', h: 'auto' }, status(k, { size: 84, labelSize: 28, w: 'fill' }), { dir: 'column' }), total(k, 84, 28, '$accent', 'right')],
    { dir: 'row', gap: 24, align: 'end' },
  );
  const chart = bars(k, { w: 'fill', h: 240, color2: '$fg/40', labelSize: 28, barRadius: 12 });
  const panel = k.group({ x: 24, y: 24, w: 1032, h: 'auto' }, [top, ...chart, brandRow(k, 44, 26)], {
    dir: 'column',
    gap: 32,
    align: 'stretch',
    padding: 48,
    fill: '$surfaceStrong',
    radius: 56,
  });

  return template({
    id: 'load.stats.sticker',
    name: 'Load, stats, sticker',
    titleKey: 'stickers:tpl.load.stats',
    kind: 'load',
    style: 'sticker',
    aspect: 'free',
    height: 620,
    background: { kind: 'transparent' },
    dark: STICKER.dark,
    light: STICKER.light,
    layers: [panel],
    meta: { transparent: true, tags: ['numbers', 'chart'] },
  });
}

export const LOAD_TEMPLATES: TemplateInput[] = [loadBarsStory(), loadBarsSquare(), loadStatsSticker()];

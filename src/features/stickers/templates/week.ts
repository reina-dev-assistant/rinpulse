import type { TemplateInput } from '../core/schema';
import { tl } from './blocks';
import { kit, template, type Kit } from './dsl';
import { PAPER, STICKER, VOLT } from './palette';
import { RANGE, brandRow, dayBars, rule, spacer } from './recap-parts';

/** Distance only counts when there was some: a strength-only week has none and the cell disappears. */
const HAS_DISTANCE = { bind: 'week.distanceM', gt: 0 };

interface CellStyle {
  size: number;
  labelSize: number;
  unitSize?: number;
  color?: string;
  labelColor?: string;
  shadow?: boolean;
}

/** The four totals of the week as stat layers; any of them hides itself when its number is missing. */
const totals = {
  workouts: (k: Kit, s: CellStyle, o: { align?: 'left' | 'right' | 'center'; labelPos?: 'above' | 'below' } = {}) =>
    k.stat({ w: 'auto', h: 'auto' }, '{week.workouts|int}', { label: tl('label.workouts'), ...s, ...o, labelPos: o.labelPos ?? 'above', minSize: 40 }),
  distance: (k: Kit, s: CellStyle, o: { align?: 'left' | 'right' | 'center'; labelPos?: 'above' | 'below' } = {}) =>
    k.stat({ w: 'auto', h: 'auto' }, '{week.distanceM|km:1}', {
      unit: tl('unit.km'),
      label: tl('label.distance'),
      ...s,
      ...o,
      labelPos: o.labelPos ?? 'above',
      minSize: 40,
      when: HAS_DISTANCE,
    }),
  time: (k: Kit, s: CellStyle, o: { align?: 'left' | 'right' | 'center'; labelPos?: 'above' | 'below' } = {}) =>
    k.stat({ w: 'auto', h: 'auto' }, '{week.movingSec|durhm}', { label: tl('label.time'), ...s, ...o, labelPos: o.labelPos ?? 'above', minSize: 40 }),
  activeDays: (k: Kit, s: CellStyle, o: { align?: 'left' | 'right' | 'center'; labelPos?: 'above' | 'below' } = {}) =>
    k.stat({ w: 'auto', h: 'auto' }, '{week.activeDays|int}', {
      unit: '/7',
      label: tl('label.activeDays'),
      ...s,
      ...o,
      labelPos: o.labelPos ?? 'above',
      minSize: 40,
    }),
};

/** `week.bold.story`: volt on black. The workout count is the headline, the seven day bars are the poster. */
function weekBoldStory(): TemplateInput {
  const k = kit('wb');
  const header = k.group(
    { w: 'fill', h: 96 },
    [
      k.group({ w: 96, h: 96 }, [k.shape({ x: 0, y: 0, w: 96, h: 96 }, 'ellipse', { fill: '$surfaceStrong' }), k.icon({ x: 24, y: 24, w: 48, h: 48 }, 'calendar', '$fg')]),
      k.text({ w: 'fill' }, tl('tpl.week.text.title'), { size: 44, weight: 800, upper: true, ls: 3, minSize: 30 }),
      k.text({ w: 'auto' }, RANGE, { size: 34, weight: 600, color: '$fgMuted', align: 'right' }),
    ],
    { dir: 'row', gap: 24, align: 'center' },
  );

  const side: CellStyle = { size: 92, labelSize: 28, unitSize: 40, color: '$fg' };
  const hero = k.group(
    { w: 'fill', h: 'auto' },
    [
      totals.workouts(k, { size: 420, labelSize: 34, color: '$accent', labelColor: '$fgMuted' }),
      k.group({ w: 'fill', h: 'auto' }, [totals.distance(k, side, { align: 'right' }), totals.time(k, side, { align: 'right' }), totals.activeDays(k, side, { align: 'right' })], {
        dir: 'column',
        gap: 36,
        align: 'end',
      }),
    ],
    { dir: 'row', gap: 36, align: 'start' },
  );

  const bars = dayBars(k, { w: 936, h: 'fill', series: 'week.dayMin', labels: 'week.dayLabels', today: 'week.todayIndex', color: '$accent', color2: '$accent/26', labelSize: 32, barRadius: 20 });
  const root = k.group({ x: 72, y: 250, w: 936, h: 1190 }, [header, hero, ...bars], { dir: 'column', gap: 48, align: 'stretch' });

  return template({
    id: 'week.bold.story',
    name: 'Week, bold, story',
    titleKey: 'stickers:tpl.week.bold',
    kind: 'week',
    style: 'bold',
    aspect: 'story',
    background: { kind: 'color', color: '$bg' },
    dark: VOLT.dark,
    light: VOLT.light,
    layers: [root, k.group({ x: 72, y: 1510, w: 936, h: 56 }, [brandRow(k, 56, 30)], { dir: 'column', align: 'stretch' })],
    meta: { tags: ['numbers', 'chart'] },
  });
}

/** `week.bold.square`: bars on the left as a tall column chart, the totals stacked on the right. */
function weekBoldSquare(): TemplateInput {
  const k = kit('ws');
  const header = k.group(
    { w: 'fill', h: 64 },
    [
      k.text({ w: 'fill' }, tl('tpl.week.text.title'), { size: 40, weight: 800, upper: true, ls: 3, minSize: 28 }),
      k.text({ w: 'auto' }, RANGE, { size: 32, weight: 600, color: '$fgMuted', align: 'right' }),
    ],
    { dir: 'row', gap: 24, align: 'center' },
  );

  const side: CellStyle = { size: 76, labelSize: 26, unitSize: 34, color: '$fg' };
  const column = k.group(
    { w: 'fill', h: 'fill' },
    [
      totals.workouts(k, { size: 210, labelSize: 30, color: '$accent' }, { align: 'right' }),
      spacer(k),
      totals.distance(k, side, { align: 'right' }),
      totals.time(k, side, { align: 'right' }),
      totals.activeDays(k, side, { align: 'right' }),
    ],
    { dir: 'column', gap: 28, align: 'end' },
  );
  const body = k.group(
    { w: 'fill', h: 'fill' },
    [...dayBars(k, { w: 480, h: 'fill', series: 'week.dayMin', labels: 'week.dayLabels', today: 'week.todayIndex', color: '$accent', color2: '$accent/26', labelSize: 28, barRadius: 16 }), column],
    { dir: 'row', gap: 40, align: 'stretch' },
  );
  const root = k.group({ x: 64, y: 64, w: 952, h: 952 }, [header, body, brandRow(k, 48, 26)], { dir: 'column', gap: 36, align: 'stretch' });

  return template({
    id: 'week.bold.square',
    name: 'Week, bold, square',
    titleKey: 'stickers:tpl.week.bold',
    kind: 'week',
    style: 'bold',
    aspect: 'square',
    background: { kind: 'color', color: '$bg' },
    dark: VOLT.dark,
    light: VOLT.light,
    layers: [root],
    meta: { tags: ['numbers', 'chart'] },
  });
}

/** `week.poster.story`: editorial stock. Distance (or the workout count) set huge, hairline rules, the bars as a graphic. */
function weekPosterStory(): TemplateInput {
  const k = kit('wp');
  const head = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.text({ w: 'fill' }, tl('tpl.week.text.kicker'), { size: 30, weight: 700, upper: true, ls: 4, color: '$fgMuted', minSize: 24 }),
      k.text({ w: 'auto' }, RANGE, { size: 36, weight: 700, color: '$fg', align: 'right' }),
    ],
    { dir: 'row', gap: 24, align: 'center' },
  );

  const giant: CellStyle = { size: 440, labelSize: 32, unitSize: 110, color: '$accent', labelColor: '$fgMuted' };
  const hero = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.stat({ w: 'fill', h: 'auto' }, '{week.distanceM|km:1}', { unit: tl('unit.km'), label: tl('label.distance'), ...giant, labelPos: 'above', minSize: 160, when: HAS_DISTANCE }),
      k.stat({ w: 'fill', h: 'auto' }, '{week.workouts|int}', { unit: tl('label.workouts'), label: tl('tpl.week.text.title'), ...giant, unitSize: 80, labelPos: 'above', minSize: 160, when: { not: HAS_DISTANCE } }),
    ],
    { dir: 'column' },
  );

  const bars = dayBars(k, { w: 936, h: 'fill', series: 'week.dayMin', labels: 'week.dayLabels', today: 'week.todayIndex', color: '$accent', color2: '$fg/22', labelSize: 30, barRadius: 6 });

  const small: CellStyle = { size: 76, labelSize: 28, unitSize: 36, color: '$fg' };
  const cells = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.stat({ w: 'fill', h: 'auto' }, '{week.workouts|int}', { label: tl('label.workouts'), ...small, labelPos: 'above', minSize: 40, when: HAS_DISTANCE }),
      k.stat({ w: 'fill', h: 'auto' }, '{week.movingSec|durhm}', { label: tl('label.time'), ...small, labelPos: 'above', minSize: 40 }),
      k.stat({ w: 'fill', h: 'auto' }, '{week.activeDays|int}', { unit: '/7', label: tl('label.activeDays'), ...small, labelPos: 'above', minSize: 40 }),
    ],
    { dir: 'row', gap: 28, align: 'start' },
  );

  const root = k.group({ x: 72, y: 250, w: 936, h: 1190 }, [head, rule(k), hero, ...bars, rule(k), cells], { dir: 'column', gap: 40, align: 'stretch' });

  return template({
    id: 'week.poster.story',
    name: 'Week, poster, story',
    titleKey: 'stickers:tpl.week.poster',
    kind: 'week',
    style: 'poster',
    aspect: 'story',
    background: { kind: 'color', color: '$bg' },
    dark: PAPER.dark,
    light: PAPER.light,
    layers: [root, k.group({ x: 72, y: 1510, w: 936, h: 56 }, [brandRow(k, 56, 30)], { dir: 'column', align: 'stretch' })],
    meta: { tags: ['numbers', 'chart'] },
  });
}

/** `week.stats.sticker`: a compact panel, three totals over seven bars. Holds on any photo. */
function weekStatsSticker(): TemplateInput {
  const k = kit('wt');
  const cell: CellStyle = { size: 88, labelSize: 28, unitSize: 38, color: '$fg' };
  const row = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.stat({ w: 'fill', h: 'auto' }, '{week.workouts|int}', { label: tl('label.workouts'), ...cell, labelPos: 'above', minSize: 40 }),
      k.stat({ w: 'fill', h: 'auto' }, '{week.distanceM|km:1}', { unit: tl('unit.km'), label: tl('label.distance'), ...cell, labelPos: 'above', minSize: 40, when: HAS_DISTANCE }),
      k.stat({ w: 'fill', h: 'auto' }, '{week.movingSec|durhm}', { label: tl('label.time'), ...cell, labelPos: 'above', minSize: 40 }),
    ],
    { dir: 'row', gap: 24, align: 'start' },
  );
  const bars = dayBars(k, { w: 'fill', h: 250, series: 'week.dayMin', labels: 'week.dayLabels', today: 'week.todayIndex', color: '$accent', color2: '$fg/40', labelSize: 28, barRadius: 12 });
  const panel = k.group({ x: 24, y: 24, w: 1032, h: 'auto' }, [row, ...bars, brandRow(k, 44, 26)], {
    dir: 'column',
    gap: 32,
    align: 'stretch',
    padding: 48,
    fill: '$surfaceStrong',
    radius: 56,
  });

  return template({
    id: 'week.stats.sticker',
    name: 'Week, stats, sticker',
    titleKey: 'stickers:tpl.week.stats',
    kind: 'week',
    style: 'sticker',
    aspect: 'free',
    height: 640,
    background: { kind: 'transparent' },
    dark: STICKER.dark,
    light: STICKER.light,
    layers: [panel],
    meta: { transparent: true, tags: ['numbers', 'chart'] },
  });
}

export const WEEK_TEMPLATES: TemplateInput[] = [weekBoldStory(), weekBoldSquare(), weekPosterStory(), weekStatsSticker()];

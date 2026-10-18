import type { TemplateInput } from '../core/schema';
import { has, lacks, tl } from './blocks';
import { kit, template, type Kit, type LayerJson } from './dsl';
import { INK, STICKER } from './palette';
import { brandRow, spacer } from './recap-parts';

const weekOf = tl('tpl.plan.text.weekOf', { week: '{plan.week}', weeks: '{plan.weeks}' });
const weekN = tl('tpl.plan.text.weekN', { week: '{plan.week}' });
const doneOf = tl('tpl.plan.text.sessionsDone', { done: '{plan.done}', total: '{plan.total}' });

/** "Week 3 of 8"; a plan without a known length says "Week 3". */
function weekLabel(k: Kit, w: number | 'fill' | 'auto', o: { size: number; weight?: number; color?: string; align?: 'left' | 'center' | 'right'; minSize?: number }): LayerJson[] {
  const common = { size: o.size, weight: o.weight ?? 800, color: o.color, align: o.align, minSize: o.minSize ?? 36 };
  return [k.text({ w, h: 'auto' }, weekOf, { ...common, when: has('plan.weeks') }), k.text({ w, h: 'auto' }, weekN, { ...common, when: lacks('plan.weeks') })];
}

interface RingOpts {
  size: number;
  thickness: number;
  pctSize: number;
  labelSize: number;
  withCount: boolean;
  color?: string;
  track?: string;
  pctColor?: string;
  shadow?: boolean;
}

/** A progress ring with the percent in the middle (and the done/total line under it). */
function planRing(k: Kit, o: RingOpts): LayerJson {
  const inner = o.size - o.thickness * 2 - 40;
  const count = k.text({ w: inner, h: 'auto' }, doneOf, { size: o.labelSize, weight: 600, color: '$fgSoft', align: 'center', minSize: 24, shadow: o.shadow });
  const middle = k.group(
    { x: 0, y: 0, w: o.size, h: o.size },
    [
      k.text({ w: inner, h: 'auto' }, '{plan.progress|pct}', { size: o.pctSize, weight: 800, color: o.pctColor ?? '$fg', align: 'center', trim: true, minSize: 60, shadow: o.shadow }),
      k.text({ w: inner, h: 'auto' }, tl('tpl.plan.text.complete'), { size: o.labelSize, weight: 700, upper: true, ls: 3, color: '$fgMuted', align: 'center', minSize: 24, shadow: o.shadow }),
      ...(o.withCount ? [count] : []),
    ],
    { dir: 'column', gap: o.labelSize * 0.5, align: 'center', justify: 'center' },
  );
  return k.group({ w: o.size, h: o.size }, [
    k.ring({ x: 0, y: 0, w: o.size, h: o.size }, { progress: { bind: 'plan.progress' }, thickness: o.thickness, track: o.track ?? '$surfaceStrong', color: o.color ?? '$accent' }),
    middle,
  ]);
}

const GRADIENT = { kind: 'gradient', angle: 160, stops: [{ at: 0, color: '$bg' }, { at: 1, color: '$bg2' }], glows: [{ x: 540, y: 760, r: 760, color: '$accent', opacity: 0.16 }] };

/** `plan.ring.story`: one big ring, "Week 3 of 8" under it, the plan name and the next session. */
function planRingStory(): TemplateInput {
  const k = kit('pr');
  const header = k.group(
    { w: 'fill', h: 96 },
    [
      k.group({ w: 96, h: 96 }, [k.shape({ x: 0, y: 0, w: 96, h: 96 }, 'ellipse', { fill: '$surfaceStrong' }), k.icon({ x: 24, y: 24, w: 48, h: 48 }, 'calendar', '$fg')]),
      k.text({ w: 'fill' }, '{plan.name}', { size: 44, weight: 800, upper: true, ls: 3, fit: 'ellipsis' }),
      k.text({ w: 'auto' }, '{plan.phase}', { size: 34, weight: 600, color: '$fgMuted', align: 'right' }),
    ],
    { dir: 'row', gap: 24, align: 'center' },
  );
  const ring = k.group({ w: 'fill', h: 'auto' }, [planRing(k, { size: 660, thickness: 64, pctSize: 200, labelSize: 32, withCount: true })], { dir: 'column', align: 'center' });
  const title = k.group({ w: 'fill', h: 'auto' }, [...weekLabel(k, 'fill', { size: 92, align: 'center', minSize: 44 }), k.text({ w: 'fill', h: 'auto' }, '{plan.goal}', { size: 44, weight: 600, color: '$fgMuted', align: 'center', minSize: 28 })], {
    dir: 'column',
    gap: 16,
    align: 'stretch',
  });
  const next = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.text({ w: 'fill', h: 'auto' }, tl('tpl.plan.text.next'), { size: 28, weight: 700, upper: true, ls: 3, color: '$fgMuted', minSize: 24 }),
      k.text({ w: 'fill', h: 'auto' }, '{plan.nextLabel}', { size: 50, weight: 800, minSize: 30, fit: 'wrap', maxLines: 2 }),
    ],
    { dir: 'column', gap: 12, align: 'stretch', padding: 40, fill: '$surface', radius: 44, when: has('plan.nextLabel') },
  );
  const root = k.group({ x: 72, y: 250, w: 936, h: 1190 }, [header, ring, title, next], { dir: 'column', gap: 44, align: 'stretch', justify: 'between' });

  return template({
    id: 'plan.ring.story',
    name: 'Plan, ring, story',
    titleKey: 'stickers:tpl.plan.ring',
    kind: 'plan',
    style: 'ring',
    aspect: 'story',
    background: GRADIENT,
    dark: INK.dark,
    light: INK.light,
    layers: [root, k.group({ x: 72, y: 1510, w: 936, h: 56 }, [brandRow(k, 56, 30)], { dir: 'column', align: 'stretch' })],
    meta: { tags: ['ring', 'progress'] },
  });
}

/** `plan.ring.square`: the ring on the left, the week and the next session on the right. */
function planRingSquare(): TemplateInput {
  const k = kit('ps');
  const header = k.group(
    { w: 'fill', h: 64 },
    [
      k.text({ w: 'fill' }, '{plan.name}', { size: 40, weight: 800, upper: true, ls: 3, fit: 'ellipsis' }),
      k.text({ w: 'auto' }, '{plan.phase}', { size: 32, weight: 600, color: '$fgMuted', align: 'right' }),
    ],
    { dir: 'row', gap: 24, align: 'center' },
  );
  const side = k.group(
    { w: 'fill', h: 'fill' },
    [
      k.text({ w: 'fill', h: 'auto' }, tl('tpl.plan.text.weekKicker'), { size: 28, weight: 700, upper: true, ls: 3, color: '$fgMuted', minSize: 24 }),
      ...weekLabel(k, 'fill', { size: 80, minSize: 40 }),
      k.text({ w: 'fill', h: 'auto' }, '{plan.goal}', { size: 40, weight: 600, color: '$fgMuted', minSize: 26, fit: 'wrap', maxLines: 2 }),
      spacer(k),
      k.group(
        { w: 'fill', h: 'auto' },
        [
          k.text({ w: 'fill', h: 'auto' }, tl('tpl.plan.text.next'), { size: 26, weight: 700, upper: true, ls: 3, color: '$fgMuted', minSize: 24 }),
          k.text({ w: 'fill', h: 'auto' }, '{plan.nextLabel}', { size: 44, weight: 800, minSize: 28, fit: 'wrap', maxLines: 2 }),
        ],
        { dir: 'column', gap: 10, align: 'stretch', padding: 32, fill: '$surface', radius: 36, when: has('plan.nextLabel') },
      ),
    ],
    { dir: 'column', gap: 16, align: 'stretch' },
  );
  const body = k.group({ w: 'fill', h: 'fill' }, [planRing(k, { size: 500, thickness: 52, pctSize: 150, labelSize: 28, withCount: true }), side], { dir: 'row', gap: 48, align: 'center' });
  const root = k.group({ x: 64, y: 64, w: 952, h: 952 }, [header, body, brandRow(k, 48, 26)], { dir: 'column', gap: 32, align: 'stretch' });

  return template({
    id: 'plan.ring.square',
    name: 'Plan, ring, square',
    titleKey: 'stickers:tpl.plan.ring',
    kind: 'plan',
    style: 'ring',
    aspect: 'square',
    background: { ...GRADIENT, glows: [{ x: 300, y: 540, r: 560, color: '$accent', opacity: 0.16 }] },
    dark: INK.dark,
    light: INK.light,
    layers: [root],
    meta: { tags: ['ring', 'progress'] },
  });
}

/** `plan.stats.sticker`: a compact panel, the ring with its percent and the week label beside it. */
function planStatsSticker(): TemplateInput {
  const k = kit('pt');
  const side = k.group(
    { w: 'fill', h: 'auto' },
    [
      ...weekLabel(k, 'fill', { size: 66, minSize: 36 }),
      k.text({ w: 'fill', h: 'auto' }, '{plan.name}', { size: 38, weight: 700, color: '$fgSoft', fit: 'ellipsis' }),
      k.text({ w: 'fill', h: 'auto' }, doneOf, { size: 30, weight: 600, color: '$fgMuted', minSize: 24 }),
    ],
    { dir: 'column', gap: 12, align: 'stretch' },
  );
  const row = k.group({ w: 'fill', h: 'auto' }, [planRing(k, { size: 320, thickness: 38, pctSize: 96, labelSize: 24, withCount: false }), side], { dir: 'row', gap: 36, align: 'center' });
  const panel = k.group({ x: 24, y: 24, w: 1032, h: 'auto' }, [row, brandRow(k, 44, 26)], { dir: 'column', gap: 28, align: 'stretch', padding: 48, fill: '$surfaceStrong', radius: 56 });

  return template({
    id: 'plan.stats.sticker',
    name: 'Plan, stats, sticker',
    titleKey: 'stickers:tpl.plan.stats',
    kind: 'plan',
    style: 'sticker',
    aspect: 'free',
    height: 560,
    background: { kind: 'transparent' },
    dark: STICKER.dark,
    light: STICKER.light,
    layers: [panel],
    meta: { transparent: true, tags: ['ring', 'progress'] },
  });
}

export const PLAN_TEMPLATES: TemplateInput[] = [planRingStory(), planRingSquare(), planStatsSticker()];

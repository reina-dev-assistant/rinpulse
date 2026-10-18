import type { TemplateInput } from '../core/schema';
import { all, any, has, lacks, not, tl } from './blocks';
import { kit, template, type LayerJson } from './dsl';
import { concentricRings, type RingSpec } from './fit-shared';
import { STICKER } from './palette';

/** Outermost first, as a watch face stacks them: steps, strain, recovery. Steps may run past 100% into a second lap. */
const RING_SPECS: RingSpec[] = [
  { present: 'watch.stepPct', props: { progress: { bind: 'watch.stepPct' }, color: '$accent2', overColor: '$fg', track: '$line' } },
  { present: 'watch.strainPct', props: { progress: { bind: 'watch.strainPct' }, color: '$accent', track: '$line' } },
  { present: 'watch.recovery', props: { progress: { bind: 'watch.recovery', div: 100 }, color: '$good', track: '$line' } },
];

const RINGS = any(...RING_SPECS.map((spec) => has(spec.present)));

/** `watch.rings.sticker`: a round watch face, three concentric rings, the step count and the date in the middle. */
function watchRings() {
  const k = kit('wr');
  const disc = 940;
  const ringsSize = 860;
  const inset = (disc - ringsSize) / 2;
  const centerWidth = 440;
  const center = k.group(
    { x: 0, y: 0, w: disc, h: disc },
    [
      k.text({ w: centerWidth, h: 'auto' }, '{date|date:weekdayShort} {date|date:short}', { size: 32, weight: 800, upper: true, ls: 3, color: '$fgMuted', align: 'center', shadow: true, minSize: 24 }),
      k.stat({ w: centerWidth, h: 'auto' }, '{watch.steps|int}', { label: tl('label.steps'), size: 170, labelSize: 30, weight: 800, align: 'center', labelPos: 'below', gap: 18, color: '$fg', shadow: true, minSize: 70, when: all(has('watch.steps'), RINGS) }),
      k.stat({ w: centerWidth + 200, h: 'auto' }, '{watch.steps|int}', { label: tl('label.steps'), size: 260, labelSize: 36, weight: 800, align: 'center', labelPos: 'below', gap: 24, color: '$fg', shadow: true, minSize: 90, when: all(has('watch.steps'), not(RINGS)) }),
      k.stat({ w: centerWidth, h: 'auto' }, '{watch.recovery|int}', { unit: '%', label: tl('label.recovery'), size: 170, unitSize: 64, labelSize: 30, weight: 800, align: 'center', labelPos: 'below', gap: 18, color: '$fg', shadow: true, minSize: 70, when: lacks('watch.steps') }),
      k.group(
        { w: centerWidth, h: 'auto' },
        [k.icon({ w: 36, h: 36 }, 'pulse', '$bad'), k.stat({ w: 'auto', h: 'auto' }, '{watch.rhr|int}', { unit: tl('unit.bpm'), size: 52, unitSize: 28, weight: 800, labelPos: 'none', color: '$fg', shadow: true, minSize: 30 })],
        { dir: 'row', gap: 14, align: 'center', justify: 'center', when: has('watch.rhr') },
      ),
    ],
    { dir: 'column', gap: 26, align: 'center', justify: 'center' },
  );
  const face = k.group({ x: 70, y: 0, w: disc, h: disc }, [
    k.shape({ x: 0, y: 0, w: disc, h: disc }, 'ellipse', { fill: '$surfaceStrong', stroke: { color: '$line', width: 6 } }),
    ...concentricRings(k, RING_SPECS, { size: ringsSize, thickness: 48, gap: 14, x: inset, y: inset }),
    center,
  ]);
  return template({
    id: 'watch.rings.sticker',
    name: 'Watch face, rings',
    titleKey: 'stickers:tpl.watch.rings',
    kind: 'watch',
    style: 'ring',
    aspect: 'free',
    height: 1060,
    background: { kind: 'transparent' },
    dark: STICKER.dark,
    light: STICKER.light,
    layers: [face, k.group({ x: 0, y: 980, w: 1080, h: 48 }, [k.brand({ w: 'auto', h: 48 }, 'lockup', { size: 48 })], { dir: 'row', justify: 'center', align: 'center' })],
    meta: { transparent: true, tags: ['rings', 'face'] },
  });
}

interface Tile {
  icon: string;
  color: string;
  label: string;
  value: string;
  unit?: string | { t: string };
  when: Record<string, unknown>;
}

/** `watch.tiles.sticker`: a rounded watch face with 2 x 2 complications; a tile without data leaves and the grid reflows. */
function watchTiles() {
  const k = kit('wt');
  const tile = (t: Tile): LayerJson =>
    k.group(
      { w: 'fill', h: 'auto' },
      [
        k.group(
          { w: 'fill', h: 'auto' },
          [k.icon({ w: 44, h: 44 }, t.icon, t.color), k.text({ w: 'fill' }, tl(t.label), { size: 30, weight: 700, upper: true, ls: 2, color: '$fgMuted', shadow: true, minSize: 24 })],
          { dir: 'row', gap: 14, align: 'center' },
        ),
        k.stat({ w: 'fill', h: 'auto' }, t.value, { unit: t.unit, size: 104, unitSize: 36, weight: 800, labelPos: 'none', color: '$fg', shadow: true, minSize: 44 }),
      ],
      { dir: 'column', gap: 24, align: 'stretch', padding: 30, fill: '$surface', radius: 56, stroke: { color: '$line', width: 3 }, when: t.when },
    );
  const steps: Tile = { icon: 'footsteps', color: '$accent2', label: 'label.steps', value: '{watch.steps|int}', when: has('watch.steps') };
  const rhr: Tile = { icon: 'pulse', color: '$bad', label: 'tpl.watch.text.rhr', value: '{watch.rhr|int}', unit: tl('unit.bpm'), when: has('watch.rhr') };
  const sleep: Tile = { icon: 'moon', color: '$accent', label: 'label.sleep', value: '{watch.sleepSec|durhm}', when: has('watch.sleepSec') };
  const strain: Tile = { icon: 'flame', color: '$accent', label: 'label.strain', value: '{watch.strain|num:1}', unit: '/21', when: has('watch.strain') };
  const rows = [[steps, rhr], [sleep, strain]].map((pair) => k.group({ w: 'fill', h: 'auto' }, pair.map(tile), { dir: 'row', gap: 24, align: 'stretch' }));

  const face = k.group(
    { w: 960, h: 'auto' },
    [
      k.group(
        { w: 'fill', h: 'auto' },
        [
          k.text({ w: 'fill' }, '{date|date:weekday}', { size: 40, weight: 800, upper: true, ls: 3, color: '$fg', shadow: true, minSize: 26 }),
          k.text({ w: 'auto' }, '{date|date:short}', { size: 36, weight: 600, color: '$fgMuted', align: 'right', shadow: true, minSize: 24 }),
        ],
        { dir: 'row', gap: 24, align: 'center' },
      ),
      ...rows,
    ],
    { dir: 'column', gap: 24, align: 'stretch', padding: 40, fill: '$surfaceStrong', radius: 120, stroke: { color: '$line', width: 6 } },
  );
  return template({
    id: 'watch.tiles.sticker',
    name: 'Watch face, tiles',
    titleKey: 'stickers:tpl.watch.tiles',
    kind: 'watch',
    style: 'sticker',
    aspect: 'free',
    height: 720,
    background: { kind: 'transparent' },
    dark: STICKER.dark,
    light: STICKER.light,
    layers: [
      k.group(
        { x: 0, y: 0, w: 1080, h: 720 },
        [face, k.brand({ w: 'auto', h: 48 }, 'lockup', { size: 48 })],
        { dir: 'column', gap: 36, align: 'center', justify: 'center' },
      ),
    ],
    meta: { transparent: true, tags: ['tiles', 'face'] },
  });
}

export const WATCH_TEMPLATES: TemplateInput[] = [watchRings(), watchTiles()];

import type { TemplateInput } from '../core/schema';
import { all, any, has, lacks, not, tl } from './blocks';
import { kit, template, type Kit, type LayerJson } from './dsl';
import { concentricRings, footerRow, type RingSpec } from './fit-shared';
import { INK, STICKER, VOLT } from './palette';

type Canvas = 'story' | 'square';

const word = (role: string, args?: Record<string, string>) => tl(`tpl.ready.text.${role}`, args);
const W = 936;

/** A day has "rings" when at least one of the three ring data exists; steps without a goal draw no ring. */
const RINGS = any(has('ready.recovery'), has('ready.strainPct'), has('ready.stepPct'));
const NO_RINGS = not(RINGS);
/** One lone ring is a gauge with its number in the middle (and out of the legend); two or more share a legend. */
const ONLY_RECOVERY = all(has('ready.recovery'), lacks('ready.strainPct'), lacks('ready.stepPct'));
const ONLY_STRAIN = all(has('ready.strainPct'), lacks('ready.recovery'), lacks('ready.stepPct'));
const ONLY_STEPS = all(has('ready.stepPct'), lacks('ready.recovery'), lacks('ready.strainPct'));
const SEVERAL = all(RINGS, not(any(ONLY_RECOVERY, ONLY_STRAIN, ONLY_STEPS)));
const DAY = '{date|date:weekday}, {date|date:short}';

/** The three rings, outermost first: recovery, strain, steps (which may run past 100% into a second lap). */
const RING_SPECS: RingSpec[] = [
  { present: 'ready.recovery', props: { progress: { bind: 'ready.recovery', div: 100 }, color: '$good', track: '$surfaceStrong' } },
  { present: 'ready.strainPct', props: { progress: { bind: 'ready.strainPct' }, color: '$accent', track: '$surfaceStrong' } },
  { present: 'ready.stepPct', props: { progress: { bind: 'ready.stepPct' }, color: '$accent2', overColor: '$fg', track: '$surfaceStrong' } },
];

const spacer = (k: Kit, when?: Record<string, unknown>) => k.shape({ w: 1, h: 'fill' }, 'rect', {}, { when });

/** Day label on the left, the date on the right: the top line of the rings cards. */
function header(k: Kit, w: number): LayerJson {
  return k.group(
    { w, h: 'auto' },
    [
      k.text({ w: 'fill' }, word('today'), { size: 36, weight: 800, upper: true, ls: 3, color: '$fg', minSize: 26 }),
      k.text({ w: 'auto' }, DAY, { size: 32, weight: 600, color: '$fgMuted', align: 'right', minSize: 24 }),
    ],
    { dir: 'row', gap: 24, align: 'center' },
  );
}

interface Row {
  icon: string;
  color: string;
  label: string | { t: string };
  value: string;
  unit?: string | { t: string; args?: Record<string, string> };
  when: Record<string, unknown>;
}

/** One legend line: glyph in the ring's color, the metric, its number at the right (`stacked`: the number under the metric). */
function legendRow(k: Kit, row: Row, o: { size: number; label: number; icon: number; stacked?: boolean }): LayerJson {
  const unitSize = Math.round(o.size * 0.38);
  const body = o.stacked
    ? k.stat({ w: 'fill', h: 'auto' }, row.value, { unit: row.unit, label: row.label, size: o.size, unitSize, labelSize: o.label, weight: 800, labelPos: 'above', gap: 12, color: '$fg', minSize: 36 })
    : k.stat({ w: 'auto', h: 'auto' }, row.value, { unit: row.unit, size: o.size, unitSize, weight: 800, labelPos: 'none', align: 'right', color: '$fg', minSize: 36 });
  return k.group(
    { w: 'fill', h: 'auto' },
    o.stacked ? [k.icon({ w: o.icon, h: o.icon }, row.icon, row.color), body] : [k.icon({ w: o.icon, h: o.icon }, row.icon, row.color), k.text({ w: 'fill' }, row.label, { size: o.label, weight: 700, color: '$fgSoft', minSize: 24 }), body],
    { dir: 'row', gap: 20, align: 'center', when: row.when },
  );
}

/** Steps hero for a day with nothing to put in a ring: the number alone, not an empty dashboard. */
function stepsHero(k: Kit, w: number, size: number, align: 'left' | 'center'): LayerJson {
  return k.stat({ w, h: 'auto' }, '{ready.steps|int}', { label: tl('label.steps'), size, labelSize: 36, weight: 800, align, labelPos: 'above', gap: 28, color: '$accent2', minSize: 120, when: all(NO_RINGS, has('ready.steps')) });
}

function legendRows(k: Kit, o: { size: number; label: number; icon: number; stacked?: boolean }): LayerJson[] {
  const rows: Row[] = [
    { icon: 'heart', color: '$good', label: tl('label.recovery'), value: '{ready.recovery|int}', unit: '%', when: all(has('ready.recovery'), not(ONLY_RECOVERY)) },
    { icon: 'flame', color: '$accent', label: tl('label.strain'), value: '{ready.strain|num:1}', unit: '/21', when: all(has('ready.strain'), not(ONLY_STRAIN)) },
    { icon: 'footsteps', color: '$accent2', label: tl('label.steps'), value: '{ready.steps|int}', unit: word('ofGoal', { goal: '{ready.stepGoal|int}' }), when: all(has('ready.steps'), RINGS, not(ONLY_STEPS)) },
    { icon: 'moon', color: '$fgMuted', label: tl('label.sleep'), value: '{ready.sleepSec|durhm}', when: has('ready.sleepSec') },
  ];
  return rows.map((row) => legendRow(k, row, o));
}

/** `ready.rings.<canvas>`: three concentric rings for recovery, strain and steps, with the numbers in a legend. */
function readyRings(canvas: Canvas) {
  const story = canvas === 'story';
  const k = kit(story ? 'rrs' : 'rrq');
  const size = story ? 680 : 540;
  const thickness = story ? 56 : 50;
  const rings = k.group({ w: size, h: size }, [
    ...concentricRings(k, RING_SPECS, { size, thickness, gap: 12 }),
    k.group(
      { x: 0, y: 0, w: size, h: size },
      [
        k.text({ w: size * 0.4, h: 'auto' }, '{ready.headline}', { size: story ? 48 : 40, weight: 800, align: 'center', color: '$fg', minSize: 26, when: SEVERAL }),
        k.stat({ w: size * 0.72, h: 'auto' }, '{ready.recovery|int}', { unit: '%', label: '{ready.headline}', size: story ? 190 : 150, unitSize: 64, labelSize: 40, weight: 800, align: 'center', labelPos: 'below', gap: 24, color: '$fg', minSize: 80, when: ONLY_RECOVERY }),
        k.stat({ w: size * 0.72, h: 'auto' }, '{ready.strain|num:1}', { unit: '/21', label: tl('label.strain'), size: story ? 190 : 150, unitSize: 64, labelSize: 40, weight: 800, align: 'center', labelPos: 'below', gap: 24, color: '$fg', minSize: 80, when: ONLY_STRAIN }),
        k.stat({ w: size * 0.72, h: 'auto' }, '{ready.steps|int}', { label: tl('label.steps'), size: story ? 170 : 116, labelSize: 40, weight: 800, align: 'center', labelPos: 'below', gap: 24, color: '$fg', minSize: 70, when: ONLY_STEPS }),
      ],
      { dir: 'column', justify: 'center', align: 'center' },
    ),
  ]);

  let root: LayerJson;
  if (story) {
    const legend = k.group({ w: W, h: 'auto' }, legendRows(k, { size: 76, label: 34, icon: 44 }), { dir: 'column', gap: 36, align: 'stretch' });
    root = k.group(
      { x: 72, y: 250, w: W, h: 1190 },
      [
        header(k, W),
        spacer(k, NO_RINGS),
        k.group({ w: W, h: 'auto' }, [rings], { dir: 'column', align: 'center', when: RINGS }),
        stepsHero(k, W, 380, 'left'),
        legend,
        spacer(k, NO_RINGS),
      ],
      { dir: 'column', gap: 40, align: 'stretch', justify: 'between' },
    );
  } else {
    const legend = () => k.group({ w: 'fill', h: 'auto' }, legendRows(k, { size: 60, label: 28, icon: 44, stacked: true }), { dir: 'column', gap: 30, align: 'stretch' });
    root = k.group(
      { x: 72, y: 72, w: W, h: 840 },
      [
        header(k, W),
        spacer(k, NO_RINGS),
        k.group({ w: W, h: 'auto' }, [rings, legend()], { dir: 'row', gap: 56, align: 'center', when: RINGS }),
        stepsHero(k, W, 300, 'left'),
        k.group({ w: W, h: 'auto' }, [legend()], { dir: 'column', when: NO_RINGS }),
        spacer(k, NO_RINGS),
      ],
      { dir: 'column', gap: 36, align: 'stretch', justify: 'between' },
    );
  }

  return template({
    id: `ready.rings.${canvas}`,
    name: `Today, rings, ${canvas}`,
    titleKey: 'stickers:tpl.ready.rings',
    kind: 'ready',
    style: 'ring',
    aspect: canvas,
    background: { kind: 'gradient', angle: 160, stops: [{ at: 0, color: '$bg' }, { at: 1, color: '$bg2' }], glows: [{ x: 540, y: story ? 700 : 480, r: 620, color: '$accent2', opacity: 0.1 }] },
    dark: INK.dark,
    light: INK.light,
    layers: [root, story ? footerRow(k, 72, 1510, W) : footerRow(k, 72, 952, W)],
    meta: { tags: ['rings'] },
  });
}

/** Steps / sleep / strain, as the bold card prints them: label, number, optional unit. A cell needs its datum, never a dash. */
const BOLD_CELLS: { label: string; value: string; unit?: string | { t: string; args?: Record<string, string> }; when: Record<string, unknown> }[] = [
  { label: 'label.steps', value: '{ready.steps|int}', unit: word('ofGoal', { goal: '{ready.stepGoal|int}' }), when: all(has('ready.steps'), has('ready.recovery')) },
  { label: 'label.sleep', value: '{ready.sleepSec|durhm}', when: has('ready.sleepSec') },
  { label: 'label.strain', value: '{ready.strain|num:1}', unit: '/21', when: has('ready.strain') },
];
const BOLD_ANY = any(...BOLD_CELLS.map((cell) => cell.when));

/** `ready.bold.<canvas>`: recovery as the poster number under its headline word; steps, sleep and strain beneath. */
function readyBold(canvas: Canvas) {
  const story = canvas === 'story';
  const k = kit(story ? 'rbs' : 'rbq');
  const header = k.group(
    { w: W, h: 'auto' },
    [
      k.text({ w: 'fill' }, word('today'), { size: 44, weight: 800, upper: true, ls: 3, color: '$fg', minSize: 30 }),
      k.text({ w: 'auto' }, DAY, { size: 34, weight: 600, color: '$fgMuted', align: 'right', minSize: 24 }),
    ],
    { dir: 'row', gap: 24, align: 'center' },
  );
  const recovery = k.group(
    { w: W, h: 'auto' },
    [
      k.text({ w: W, h: 'auto' }, '{ready.headline|upper}', { size: story ? 64 : 48, weight: 800, ls: 4, color: '$fg', minSize: 30 }),
      k.stat({ w: W, h: 'auto' }, '{ready.recovery|int}', { unit: '%', size: story ? 430 : 330, unitSize: story ? 130 : 100, weight: 800, color: '$accent', labelPos: 'none', minSize: 150 }),
    ],
    { dir: 'column', gap: story ? 44 : 32, align: 'stretch', when: has('ready.recovery') },
  );
  const bar = k.chart(
    { w: W, h: story ? 36 : 28 },
    {
      kind: 'stack',
      barRadius: 18,
      segments: [
        { value: { bind: 'ready.recovery', div: 100, clamp: [0, 1] }, color: '$accent' },
        { value: { bind: 'ready.recovery', div: 100, mul: -1, add: 1, clamp: [0, 1] }, color: '$surfaceStrong' },
      ],
    },
  );
  const stepsHeroBold = k.stat({ w: W, h: 'auto' }, '{ready.steps|int}', { label: tl('label.steps'), size: story ? 400 : 300, labelSize: 40, weight: 800, labelPos: 'above', gap: 32, color: '$accent', minSize: 150, when: lacks('ready.recovery') });

  let body: LayerJson[];
  if (story) {
    const rows = k.group(
      { w: W, h: 'auto' },
      BOLD_CELLS.map((cell) =>
        k.group(
          { w: 'fill', h: 'auto' },
          [
            k.shape({ w: 'fill', h: 3 }, 'rect', { fill: '$line' }),
            k.group(
              { w: 'fill', h: 'auto' },
              [
                k.text({ w: 'fill' }, tl(cell.label), { size: 34, weight: 700, upper: true, ls: 2, color: '$fgSoft', minSize: 24 }),
                k.stat({ w: 'auto', h: 'auto' }, cell.value, { unit: cell.unit, size: 80, unitSize: 32, weight: 800, labelPos: 'none', align: 'right', color: '$fg', minSize: 40 }),
              ],
              { dir: 'row', gap: 24, align: 'center' },
            ),
          ],
          { dir: 'column', gap: 26, align: 'stretch', when: cell.when },
        ),
      ),
      { dir: 'column', gap: 26, align: 'stretch' },
    );
    body = [header, spacer(k), recovery, bar, stepsHeroBold, rows, spacer(k, not(BOLD_ANY))];
  } else {
    const cells = k.group(
      { w: W, h: 'auto' },
      BOLD_CELLS.map((cell) => k.stat({ w: 'fill', h: 'auto' }, cell.value, { unit: cell.unit, label: tl(cell.label), size: 64, unitSize: 28, labelSize: 28, weight: 800, labelPos: 'above', gap: 14, color: '$fg', minSize: 36, when: cell.when })),
      { dir: 'row', gap: 28, align: 'start' },
    );
    body = [header, spacer(k), recovery, bar, stepsHeroBold, cells, spacer(k, not(BOLD_ANY))];
  }
  const root = story
    ? k.group({ x: 72, y: 250, w: W, h: 1170 }, body, { dir: 'column', gap: 40, align: 'stretch', justify: 'between' })
    : k.group({ x: 72, y: 72, w: W, h: 840 }, body, { dir: 'column', gap: 36, align: 'stretch', justify: 'between' });

  return template({
    id: `ready.bold.${canvas}`,
    name: `Today, bold, ${canvas}`,
    titleKey: 'stickers:tpl.ready.bold',
    kind: 'ready',
    style: 'bold',
    aspect: canvas,
    background: { kind: 'color', color: '$bg' },
    dark: VOLT.dark,
    light: VOLT.light,
    layers: [root, story ? footerRow(k, 72, 1510, W) : footerRow(k, 72, 952, W)],
    meta: { tags: ['numbers'] },
  });
}

/** `ready.stats.sticker`: a compact recovery ring with its headline word, steps and sleep beside it. */
function readyStickerTemplate() {
  const k = kit('rst');
  const size = 380;
  const ring = k.group(
    { w: size, h: size },
    [
      k.ring({ x: 0, y: 0, w: size, h: size }, { progress: { bind: 'ready.recovery', div: 100 }, thickness: 46, track: '$line', color: '$good' }),
      k.group(
        { x: 0, y: 0, w: size, h: size },
        [k.stat({ w: 'auto', h: 'auto' }, '{ready.recovery|int}', { unit: '%', label: tl('label.recovery'), size: 140, unitSize: 52, labelSize: 28, weight: 800, labelPos: 'below', gap: 16, align: 'center', color: '$fg', shadow: true, minSize: 70 })],
        { dir: 'column', justify: 'center', align: 'center' },
      ),
    ],
    { when: has('ready.recovery') },
  );
  const column = k.group(
    { w: 'auto', h: 'auto' },
    [
      k.text({ w: 520, h: 'auto' }, '{ready.headline}', { size: 64, weight: 800, color: '$fg', shadow: true, minSize: 34 }),
      k.stat({ w: 520, h: 'auto' }, '{ready.steps|int}', { label: tl('label.steps'), size: 100, labelSize: 28, weight: 800, labelPos: 'above', gap: 14, color: '$fg', shadow: true, minSize: 50, when: has('ready.recovery') }),
      k.stat({ w: 520, h: 'auto' }, '{ready.steps|int}', { label: tl('label.steps'), size: 220, labelSize: 34, weight: 800, labelPos: 'above', gap: 20, color: '$fg', shadow: true, minSize: 80, when: lacks('ready.recovery') }),
      k.stat({ w: 520, h: 'auto' }, '{ready.sleepSec|durhm}', { label: tl('label.sleep'), size: 100, labelSize: 28, weight: 800, labelPos: 'above', gap: 14, color: '$fg', shadow: true, minSize: 50, when: has('ready.recovery') }),
      k.stat({ w: 520, h: 'auto' }, '{ready.sleepSec|durhm}', { label: tl('label.sleep'), size: 130, labelSize: 34, weight: 800, labelPos: 'above', gap: 20, color: '$fg', shadow: true, minSize: 60, when: lacks('ready.recovery') }),
    ],
    { dir: 'column', gap: 30, align: 'stretch' },
  );
  const root = k.group(
    { x: 0, y: 0, w: 1080, h: 560 },
    [k.group({ w: 'auto', h: 'auto' }, [ring, column], { dir: 'row', gap: 56, align: 'center' }), k.brand({ w: 'auto', h: 44 }, 'lockup', { size: 44 })],
    { dir: 'column', gap: 44, align: 'center', justify: 'center' },
  );
  return template({
    id: 'ready.stats.sticker',
    name: 'Today, recovery sticker',
    titleKey: 'stickers:tpl.ready.stats',
    kind: 'ready',
    style: 'sticker',
    aspect: 'free',
    height: 560,
    background: { kind: 'transparent' },
    dark: STICKER.dark,
    light: STICKER.light,
    layers: [root],
    meta: { transparent: true, tags: ['ring'] },
  });
}

export const READY_TEMPLATES: TemplateInput[] = [readyRings('story'), readyRings('square'), readyBold('story'), readyBold('square'), readyStickerTemplate()];

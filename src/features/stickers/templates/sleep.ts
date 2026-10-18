import type { TemplateInput } from '../core/schema';
import { has, lacks, tl } from './blocks';
import { kit, template, type Kit, type LayerJson } from './dsl';
import { footerRow } from './fit-shared';
import { NIGHT, PAPER, STICKER } from './palette';

type Canvas = 'story' | 'square';

/** The app's sleep stage colors (the same hexes `data/sleep.ts` puts in `sleep.hypnoColors`), so legend and bars agree. */
const STAGES = [
  { key: 'deep', color: '#4B57B5' },
  { key: 'rem', color: '#C09CF5' },
  { key: 'light', color: '#8F9BE3' },
  { key: 'awake', color: '#F0A23C' },
] as const;

const word = (role: string, args?: Record<string, string>) => tl(`tpl.sleep.text.${role}`, args);

/** A night is "staged" when the builder emitted stage shares; every conditional below uses this one test. */
const STAGED = 'sleep.deepPct';
const TARGET_SEC = 28_800;
const W = 936;

const nightBackground = (glowX: number, glowY: number, r: number) => ({
  kind: 'gradient',
  angle: 180,
  stops: [
    { at: 0, color: '$bg' },
    { at: 1, color: '$bg2' },
  ],
  glows: [{ x: glowX, y: glowY, r, color: '$accent2', opacity: 0.16 }],
});

/** Free height: the two ends of a column share it, so a hero without its ring sits in the middle. */
const spacer = (k: Kit, when?: Record<string, unknown>) => k.shape({ w: 1, h: 'fill' }, 'rect', {}, { when });

/** Moon in a round chip, the label and the wake day: the top line of the night cards. */
function header(k: Kit, w: number): LayerJson {
  const size = 64;
  return k.group(
    { w, h: size },
    [
      k.group({ w: size, h: size }, [
        k.shape({ x: 0, y: 0, w: size, h: size }, 'ellipse', { fill: '$surfaceStrong' }),
        k.icon({ x: size * 0.25, y: size * 0.25, w: size * 0.5, h: size * 0.5 }, 'moon', '$accent2'),
      ]),
      k.text({ w: 'fill' }, word('night'), { size: 34, weight: 800, upper: true, ls: 3, color: '$fg', minSize: 26 }),
      k.text({ w: 'auto' }, '{sleep.wakeTime|date:weekday}, {sleep.wakeTime|date:short}', { size: 32, weight: 600, color: '$fgMuted', align: 'right', minSize: 24 }),
    ],
    { dir: 'row', gap: 20, align: 'center' },
  );
}

/** One stage chip: swatch, share, stage name. Hidden with the night's stages. */
function stageChip(k: Kit, stage: (typeof STAGES)[number]): LayerJson {
  return k.group(
    { w: 'fill', h: 'auto' },
    [
      k.shape({ w: 22, h: 22 }, 'rect', { fill: stage.color, radius: 7 }),
      k.stat({ w: 'fill', h: 'auto' }, `{sleep.${stage.key}Pct|pct}`, { label: word(stage.key), size: 52, labelSize: 26, weight: 800, labelPos: 'below', gap: 10, minSize: 30, color: '$fg' }),
    ],
    { dir: 'row', gap: 14, align: 'center', padding: 18, fill: '$surface', radius: 20, when: has(`sleep.${stage.key}Pct`) },
  );
}

/** "Bed 11.40 PM, up 6:15 AM" and, when the night had them, the awakenings. */
function metaLine(k: Kit, align: 'start' | 'center', size = 32): LayerJson {
  return k.group(
    { w: 'fill', h: 'auto' },
    [
      k.text({ w: 'auto' }, word('bedWake', { bed: '{sleep.bedtime|time}', wake: '{sleep.wakeTime|time}' }), { size, weight: 600, color: '$fgMuted', minSize: 24 }),
      k.text({ w: 'auto' }, word('awakenings', { count: '{sleep.awakenings|int}' }), { size, weight: 600, color: '$fgMuted', minSize: 24 }),
    ],
    { dir: 'row', gap: 32, justify: align, align: 'center' },
  );
}

/** The 8 h target bar: what an unstaged night shows where the stages would be. */
function targetBar(k: Kit, w: number): LayerJson {
  return k.group(
    { w, h: 'auto' },
    [
      k.chart(
        { w, h: 28 },
        {
          kind: 'stack',
          barRadius: 14,
          segments: [
            { value: { bind: 'sleep.asleepSec', div: TARGET_SEC, clamp: [0, 1] }, color: '$accent2' },
            { value: { bind: 'sleep.asleepSec', div: TARGET_SEC, mul: -1, add: 1, clamp: [0, 1] }, color: '$surfaceStrong' },
          ],
        },
      ),
      k.text({ w, h: 'auto' }, word('target'), { size: 28, weight: 600, color: '$fgMuted', align: 'right', minSize: 24 }),
    ],
    { dir: 'column', gap: 16, when: lacks(STAGED) },
  );
}

/** Score ring with the stage shares as a thin inner ring and the score in the middle. */
function scoreRing(k: Kit, size: number, o: { x?: number; thickness: number; inset: number; inner: number; score: number; label: number }): LayerJson {
  const inside = size - o.inset * 2;
  return k.group(
    { x: o.x ?? 0, y: 0, w: size, h: size },
    [
      k.ring({ x: 0, y: 0, w: size, h: size }, { progress: { bind: 'sleep.score', div: 100 }, thickness: o.thickness, track: '$surfaceStrong', color: '$accent2' }),
      k.ring(
        { x: o.inset, y: o.inset, w: inside, h: inside },
        { segments: STAGES.map((s) => ({ value: { bind: `sleep.${s.key}Pct` }, color: s.color })), thickness: o.inner, track: '$surface', cap: 'butt' },
        { when: has(STAGED) },
      ),
      k.group(
        { x: 0, y: 0, w: size, h: size },
        [k.stat({ w: 'auto', h: 'auto' }, '{sleep.score|int}', { label: word('score'), size: o.score, labelSize: o.label, weight: 800, labelPos: 'below', gap: 20, align: 'center', color: '$fg', minSize: 80 })],
        { dir: 'column', justify: 'center', align: 'center' },
      ),
    ],
    { when: has('sleep.score') },
  );
}

/** `sleep.ring.<canvas>`: the watch's score as a ring, the asleep time and the stage chips under it. */
function sleepRing(canvas: Canvas) {
  const story = canvas === 'story';
  const k = kit(story ? 'srs' : 'srq');

  const heroSolo = k.stat({ w: W, h: 'auto' }, '{sleep.asleepSec|durhm}', {
    label: word('asleep'),
    size: story ? 300 : 250,
    labelSize: 34,
    weight: 800,
    align: story ? 'center' : 'left',
    labelPos: 'above',
    gap: 0,
    trim: false,
    color: '$fg',
    minSize: 120,
    when: lacks('sleep.score'),
  });
  const verdict = () => k.text({ w: 'fill', h: 'auto' }, '{sleep.verdict}', { size: story ? 56 : 48, weight: 800, align: story ? 'center' : 'left', color: '$accent2', minSize: 32 });
  const chips = k.group({ w: 'fill', h: 'auto' }, STAGES.map((stage) => stageChip(k, stage)), { dir: 'row', gap: 14, align: 'stretch' });

  let root: LayerJson;
  if (story) {
    root = k.group(
      { x: 72, y: 250, w: W, h: 1190 },
      [
        header(k, W),
        spacer(k, lacks('sleep.score')),
        k.group({ w: W, h: 'auto' }, [scoreRing(k, 620, { thickness: 56, inset: 84, inner: 22, score: 270, label: 30 })], { dir: 'column', align: 'center', when: has('sleep.score') }),
        k.group(
          { w: W, h: 'auto' },
          [k.stat({ w: W, h: 'auto' }, '{sleep.asleepSec|durhm}', { size: 150, weight: 800, align: 'center', labelPos: 'none', color: '$fg', minSize: 90, trim: false, when: has('sleep.score') }), heroSolo, verdict()],
          { dir: 'column', gap: 8, align: 'stretch' },
        ),
        targetBar(k, W),
        chips,
        metaLine(k, 'center'),
        spacer(k, lacks('sleep.score')),
      ],
      { dir: 'column', gap: 36, align: 'stretch', justify: 'between' },
    );
  } else {
    const info = k.group(
      { w: 'fill', h: 470 },
      [
        k.group(
          { w: 'fill', h: 'auto' },
          [
            k.stat({ w: 'fill', h: 'auto' }, '{sleep.asleepSec|durhm}', { label: word('asleep'), size: 112, labelSize: 30, weight: 800, labelPos: 'above', gap: 0, trim: false, color: '$fg', minSize: 60 }),
            verdict(),
          ],
          { dir: 'column', gap: 8, align: 'stretch' },
        ),
      ],
      { dir: 'column', justify: 'center', align: 'stretch', when: has('sleep.score') },
    );
    root = k.group(
      { x: 72, y: 72, w: W, h: 840 },
      [
        header(k, W),
        spacer(k, lacks('sleep.score')),
        k.group({ w: W, h: 'auto' }, [scoreRing(k, 470, { thickness: 48, inset: 70, inner: 18, score: 190, label: 26 }), info], { dir: 'row', gap: 48, align: 'center' }),
        k.group({ w: W, h: 'auto' }, [heroSolo, k.group({ w: W, h: 'auto' }, [verdict()], { dir: 'column', when: lacks('sleep.score') })], { dir: 'column', gap: 20, align: 'stretch' }),
        targetBar(k, W),
        chips,
        metaLine(k, 'start', 30),
        spacer(k, lacks('sleep.score')),
      ],
      { dir: 'column', gap: 32, align: 'stretch', justify: 'between' },
    );
  }

  return template({
    id: `sleep.ring.${canvas}`,
    name: `Sleep, score ring, ${canvas}`,
    titleKey: 'stickers:tpl.sleep.ring',
    kind: 'sleep',
    style: 'ring',
    aspect: canvas,
    background: nightBackground(900, story ? 520 : 260, story ? 760 : 620),
    dark: NIGHT.dark,
    light: NIGHT.light,
    layers: [root, story ? footerRow(k, 72, 1510, W) : footerRow(k, 72, 952, W)],
    meta: { tags: ['ring', 'score'] },
  });
}

/** `sleep.stages.<canvas>`: the night as a hypnogram, the stage mix as one bar, the time in each stage. */
function sleepStages(canvas: Canvas) {
  const story = canvas === 'story';
  const k = kit(story ? 'sts' : 'stq');

  const hypno = k.chart({ w: W, h: story ? 250 : 150 }, { kind: 'bars', series: { bind: 'sleep.hypno' }, colors: { bind: 'sleep.hypnoColors' }, min: 0, max: 4, barRadius: 8 });
  const axis = k.group(
    { w: W, h: 'auto' },
    [
      k.text({ w: 'fill' }, '{sleep.bedtime|time}', { size: 28, weight: 600, color: '$fgMuted', minSize: 24 }),
      k.text({ w: 'auto' }, '{sleep.wakeTime|time}', { size: 28, weight: 600, color: '$fgMuted', align: 'right', minSize: 24 }),
    ],
    { dir: 'row', gap: 24 },
  );
  const mix = k.chart({ w: W, h: 44 }, { kind: 'stack', barRadius: 14, segments: STAGES.map((s) => ({ value: { bind: `sleep.${s.key}Pct` }, color: s.color })) });
  const stageCell = (stage: (typeof STAGES)[number]) =>
    k.group(
      { w: 'fill', h: 'auto' },
      [
        k.shape({ w: 26, h: 26 }, 'rect', { fill: stage.color, radius: 8 }),
        k.text({ w: 'fill' }, word(stage.key), { size: 34, weight: 700, color: '$fgSoft', minSize: 26 }),
        k.text({ w: 'auto' }, `{sleep.${stage.key}Pct|pct}`, { size: 30, weight: 600, color: '$fgMuted', minSize: 24, align: 'right' }),
        k.text({ w: story ? 200 : 170 }, `{sleep.${stage.key}Sec|durhm}`, { size: story ? 54 : 44, weight: 800, color: '$fg', align: 'right', minSize: 30 }),
      ],
      { dir: 'row', gap: 20, align: 'center', when: has(`sleep.${stage.key}Sec`) },
    );
  const rows = k.group({ w: W, h: 'auto' }, STAGES.map(stageCell), { dir: 'column', gap: story ? 30 : 16, align: 'stretch' });

  const heroStaged = k.stat({ w: 'fill', h: 'auto' }, '{sleep.asleepSec|durhm}', { label: word('asleep'), size: story ? 180 : 120, labelSize: 32, weight: 800, labelPos: 'above', gap: 0, trim: false, color: '$fg', minSize: 90 });
  const heroSolo = k.stat({ w: W, h: 'auto' }, '{sleep.asleepSec|durhm}', { label: word('asleep'), size: story ? 300 : 230, labelSize: 34, weight: 800, align: story ? 'center' : 'left', labelPos: 'above', gap: 0, trim: false, color: '$fg', minSize: 120 });
  const verdict = k.text({ w: W, h: 'auto' }, '{sleep.verdict}', { size: story ? 56 : 46, weight: 800, align: story ? 'center' : 'left', color: '$accent2', minSize: 32 });

  const staged = k.group(
    { w: W, h: 'auto' },
    [
      story
        ? k.group({ w: W, h: 'auto' }, [heroStaged, k.text({ w: W, h: 'auto' }, '{sleep.verdict}', { size: 48, weight: 800, color: '$accent2', minSize: 30 })], { dir: 'column', gap: 6, align: 'stretch' })
        : k.group({ w: W, h: 'auto' }, [heroStaged, k.text({ w: 380, h: 'auto' }, '{sleep.verdict}', { size: 44, weight: 800, color: '$accent2', minSize: 26, align: 'right' })], { dir: 'row', gap: 24, align: 'end' }),
      k.group({ w: W, h: 'auto' }, [hypno, axis], { dir: 'column', gap: 14, align: 'stretch' }),
      k.group({ w: W, h: 'auto' }, [mix, rows], { dir: 'column', gap: story ? 36 : 24, align: 'stretch' }),
    ],
    { dir: 'column', gap: story ? 44 : 28, align: 'stretch', when: has(STAGED) },
  );
  const solo = k.group(
    { w: W, h: 'auto' },
    [heroSolo, verdict, targetBar(k, W), metaLine(k, story ? 'center' : 'start')],
    { dir: 'column', gap: 36, align: 'stretch', when: lacks(STAGED) },
  );

  const root = story
    ? k.group({ x: 72, y: 250, w: W, h: 1190 }, [header(k, W), spacer(k, lacks(STAGED)), staged, solo, spacer(k, lacks(STAGED))], { dir: 'column', gap: 36, align: 'stretch', justify: 'between' })
    : k.group({ x: 72, y: 72, w: W, h: 840 }, [header(k, W), spacer(k, lacks(STAGED)), staged, solo, spacer(k, lacks(STAGED))], { dir: 'column', gap: 28, align: 'stretch', justify: 'between' });

  return template({
    id: `sleep.stages.${canvas}`,
    name: `Sleep, stages, ${canvas}`,
    titleKey: 'stickers:tpl.sleep.stages',
    kind: 'sleep',
    style: 'bold',
    aspect: canvas,
    background: nightBackground(180, story ? 1500 : 900, story ? 820 : 640),
    dark: NIGHT.dark,
    light: NIGHT.light,
    layers: [root, story ? footerRow(k, 72, 1510, W) : footerRow(k, 72, 952, W)],
    meta: { tags: ['stages', 'chart'] },
  });
}

/** `sleep.poster.story`: editorial type. The duration is the poster; the night is a thin strip under it. */
function sleepPoster() {
  const k = kit('sp');
  const rule = () => k.shape({ w: W, h: 3 }, 'rect', { fill: '$fg' });
  const top = k.group(
    { w: W, h: 'auto' },
    [
      rule(),
      k.group(
        { w: W, h: 'auto' },
        [
          k.text({ w: 'fill' }, word('poster'), { size: 32, weight: 800, upper: true, ls: 4, color: '$fg', minSize: 26 }),
          k.text({ w: 'auto' }, '{sleep.wakeTime|date:medium}', { size: 32, weight: 600, color: '$fgMuted', align: 'right', minSize: 24 }),
        ],
        { dir: 'row', gap: 24 },
      ),
    ],
    { dir: 'column', gap: 24 },
  );
  const hero = k.group(
    { w: W, h: 'auto' },
    [
      k.stat({ w: W, h: 'auto' }, '{sleep.asleepSec|durhm}', { label: word('asleep'), size: 380, labelSize: 36, weight: 800, labelPos: 'above', gap: 0, trim: false, color: '$fg', minSize: 150 }),
      k.text({ w: W, h: 'auto' }, '{sleep.verdict|upper}', { size: 120, weight: 800, color: '$accent', minSize: 40, ls: 1 }),
    ],
    { dir: 'column', gap: 8, align: 'stretch' },
  );
  const strip = k.group(
    { w: W, h: 'auto' },
    [
      k.chart({ w: W, h: 150 }, { kind: 'bars', series: { bind: 'sleep.hypno' }, colors: { bind: 'sleep.hypnoColors' }, min: 0, max: 4, barRadius: 4 }),
      k.group(
        { w: W, h: 'auto' },
        [
          k.text({ w: 'fill' }, '{sleep.bedtime|time}', { size: 28, weight: 600, color: '$fgMuted', minSize: 24 }),
          k.text({ w: 'auto' }, '{sleep.wakeTime|time}', { size: 28, weight: 600, color: '$fgMuted', align: 'right', minSize: 24 }),
        ],
        { dir: 'row', gap: 24 },
      ),
    ],
    { dir: 'column', gap: 16, align: 'stretch', when: has('sleep.hypno') },
  );
  const facts = k.group(
    { w: W, h: 'auto' },
    [
      k.stat({ w: 'fill', h: 'auto' }, '{sleep.score|int}', { label: word('score'), size: 84, labelSize: 28, weight: 800, labelPos: 'above', color: '$fg', minSize: 50 }),
      k.stat({ w: 'fill', h: 'auto' }, '{sleep.deepSec|durhm}', { label: word('deep'), size: 84, labelSize: 28, weight: 800, labelPos: 'above', color: '$fg', minSize: 50 }),
      k.stat({ w: 'fill', h: 'auto' }, '{sleep.remSec|durhm}', { label: word('rem'), size: 84, labelSize: 28, weight: 800, labelPos: 'above', color: '$fg', minSize: 50 }),
    ],
    { dir: 'row', gap: 28, align: 'start' },
  );
  const lines = k.group(
    { w: W, h: 'auto' },
    [
      k.text({ w: W, h: 'auto' }, word('bedWake', { bed: '{sleep.bedtime|time}', wake: '{sleep.wakeTime|time}' }), { size: 34, weight: 600, color: '$fgSoft', minSize: 26 }),
      k.text({ w: W, h: 'auto' }, word('vsMore', { time: '{sleep.vsAvgSec|durhm}' }), { size: 34, weight: 600, color: '$fgMuted', minSize: 26, when: { bind: 'sleep.vsAvgSec', gt: 0 } }),
    ],
    { dir: 'column', gap: 12, align: 'stretch' },
  );
  const root = k.group({ x: 72, y: 250, w: W, h: 1190 }, [top, spacer(k), hero, strip, facts, lines], { dir: 'column', gap: 48, align: 'stretch', justify: 'between' });

  return template({
    id: 'sleep.poster.story',
    name: 'Sleep, poster, story',
    titleKey: 'stickers:tpl.sleep.poster',
    kind: 'sleep',
    style: 'poster',
    aspect: 'story',
    background: { kind: 'color', color: '$bg' },
    dark: PAPER.dark,
    light: PAPER.light,
    layers: [root, footerRow(k, 72, 1510, W)],
    meta: { tags: ['typography'] },
  });
}

/** `sleep.stats.sticker`: a small ring, the duration and the verdict, shadowed, on a transparent canvas. */
function sleepSticker() {
  const k = kit('ss');
  const size = 420;
  const ring = k.group({ w: size, h: size }, [
    k.ring({ x: 0, y: 0, w: size, h: size }, { progress: { bind: 'sleep.score', div: 100 }, thickness: 46, track: '$line', color: '$accent2' }, { when: has('sleep.score') }),
    k.ring({ x: 0, y: 0, w: size, h: size }, { progress: { bind: 'sleep.asleepSec', div: TARGET_SEC }, thickness: 46, track: '$line', color: '$accent2' }, { when: lacks('sleep.score') }),
    k.group(
      { x: 0, y: 0, w: size, h: size },
      [k.stat({ w: 'auto', h: 'auto' }, '{sleep.score|int}', { label: word('score'), size: 150, labelSize: 28, weight: 800, labelPos: 'below', gap: 16, align: 'center', color: '$fg', shadow: true, minSize: 70 })],
      { dir: 'column', justify: 'center', align: 'center' },
    ),
    k.group(
      { x: 0, y: 0, w: size, h: size },
      [k.icon({ w: 150, h: 150 }, 'moon', '$fg', { when: lacks('sleep.score') })],
      { dir: 'column', justify: 'center', align: 'center' },
    ),
  ]);
  const info = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.stat({ w: 'fill', h: 'auto' }, '{sleep.asleepSec|durhm}', { label: word('asleep'), size: 130, labelSize: 32, weight: 800, labelPos: 'above', gap: 0, trim: false, color: '$fg', shadow: true, minSize: 60 }),
      k.text({ w: 'fill', h: 'auto' }, '{sleep.verdict}', { size: 54, weight: 800, color: '$accent2', shadow: true, minSize: 30 }),
    ],
    { dir: 'column', gap: 10, align: 'stretch' },
  );
  const root = k.group(
    { x: 0, y: 0, w: 1080, h: 600 },
    [
      k.group({ w: 'auto', h: 'auto' }, [ring, k.group({ w: 520, h: 'auto' }, [info], { dir: 'column' })], { dir: 'row', gap: 52, align: 'center' }),
      k.brand({ w: 'auto', h: 44 }, 'lockup', { size: 44 }),
    ],
    { dir: 'column', gap: 44, align: 'center', justify: 'center' },
  );

  return template({
    id: 'sleep.stats.sticker',
    name: 'Sleep, stats sticker',
    titleKey: 'stickers:tpl.sleep.stats',
    kind: 'sleep',
    style: 'sticker',
    aspect: 'free',
    height: 600,
    background: { kind: 'transparent' },
    dark: STICKER.dark,
    light: STICKER.light,
    layers: [root],
    meta: { transparent: true, tags: ['ring'] },
  });
}

export const SLEEP_TEMPLATES: TemplateInput[] = [sleepRing('story'), sleepRing('square'), sleepStages('story'), sleepStages('square'), sleepPoster(), sleepSticker()];

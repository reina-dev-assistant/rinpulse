import type { TemplateInput } from '../core/schema';
import { has, is, not, tl } from './blocks';
import { kit, template, type Kit, type LayerJson } from './dsl';
import { STICKER, VOLT } from './palette';
import { brandRow, spacer } from './recap-parts';

/** Which glyph tells which kind of milestone; `medal` is the fallback for a kind this list does not know. */
const KIND_ICONS: [string, string][] = [
  ['distance', 'route'],
  ['workouts', 'barbell'],
  ['time', 'timer'],
  ['streak', 'flame'],
  ['pr', 'trophy'],
  ['plan', 'medal'],
];

/** The glyph of `milestone.kind`: one icon layer per kind stacked in one box, exactly one passes its `when`. */
function kindIcon(k: Kit, box: { x?: number; y?: number; w: number }, color: string): LayerJson[] {
  const b = { x: box.x, y: box.y, w: box.w, h: box.w };
  const layers = KIND_ICONS.map(([kind, name]) => k.icon(b, name, color, { when: is('milestone.kind', kind) }));
  layers.push(k.icon(b, 'medal', color, { when: not({ bind: 'milestone.kind', in: KIND_ICONS.map(([kind]) => kind) }) }));
  return layers;
}

/**
 * The milestone number. Distance, workouts, streak and plan carry a raw number and a unit, so the number is big and the unit
 * small beside it; time and PR carry a ready text ("100 jam", "31:32", "102,5 kg x 5") that is shown whole.
 */
function bigValue(k: Kit, w: number, o: { size: number; unitSize: number; color: string; align?: 'left' | 'center' | 'right'; minSize: number; shadow?: boolean }): LayerJson[] {
  const common = { size: o.size, unitSize: o.unitSize, color: o.color, align: o.align, labelPos: 'none' as const, minSize: o.minSize, shadow: o.shadow };
  const split = ['workouts', 'streak', 'plan'];
  return [
    k.stat({ w, h: 'auto' }, '{milestone.value|km:0}', { ...common, unit: '{milestone.unit}', when: is('milestone.kind', 'distance') }),
    k.stat({ w, h: 'auto' }, '{milestone.value|int}', { ...common, unit: '{milestone.unit?}', when: { bind: 'milestone.kind', in: split } }),
    k.stat({ w, h: 'auto' }, '{milestone.valueText}', { ...common, when: not({ bind: 'milestone.kind', in: ['distance', ...split] }) }),
  ];
}

/** A disc with the kind's glyph, the lead of the stickers that are not a medal. */
function iconDisc(k: Kit, size: number, ring: boolean): LayerJson {
  const pad = size * 0.27;
  return k.group({ w: size, h: size }, [
    k.shape({ x: 0, y: 0, w: size, h: size }, 'ellipse', { fill: '$surfaceStrong', stroke: ring ? { color: '$accent', width: 6 } : undefined }),
    ...kindIcon(k, { x: pad, y: pad, w: size - pad * 2 }, '$accent'),
  ]);
}

const HAS_KIND = has('milestone.kind');

// ------------------------------------------------------------------------------------------------ medal sticker

/** Metallic sheen: bright and dark bands over the flat amber, no invented hues. */
const SHEEN = { gradient: { angle: 135, stops: [
  { at: 0, color: '#ffffffb3' },
  { at: 0.22, color: '#ffffff00' },
  { at: 0.45, color: '#ffffff59' },
  { at: 0.62, color: '#00000000' },
  { at: 0.82, color: '#00000040' },
  { at: 1, color: '#00000073' },
] } };

/** `badge.medal.sticker`: a round award. Amber metal rim with engraved ticks, a dark (day: white) face, the glyph and the number. */
function badgeMedalSticker(): TemplateInput {
  const k = kit('bm');
  const D = 1000;
  const x0 = 40;
  const y0 = 24;
  const at = (inset: number, size = D - inset * 2) => ({ x: x0 + inset, y: y0 + inset, w: size, h: size });

  const content = k.group(
    { x: 190, y: 190, w: 700, h: 668 },
    [
      ...kindIcon(k, { w: 120 }, '$accent'),
      ...bigValue(k, 640, { size: 210, unitSize: 76, color: '$fg', align: 'center', minSize: 84 }),
      k.shape({ w: 120, h: 6 }, 'rect', { fill: '$accent', radius: 3 }),
      k.text({ w: 600, h: 'auto' }, '{milestone.title}', { size: 52, weight: 800, align: 'center', fit: 'wrap', maxLines: 2, minSize: 34, lh: 1.1 }),
      k.text({ w: 560, h: 'auto' }, '{milestone.subtitle}', { size: 32, weight: 600, color: '$fgSoft', align: 'center', fit: 'wrap', maxLines: 2, minSize: 26 }),
    ],
    { dir: 'column', gap: 26, align: 'center', justify: 'center' },
  );

  const layers: LayerJson[] = [
    k.shape(at(0), 'ellipse', { fill: '$accent' }, { when: HAS_KIND }),
    k.shape(at(0), 'ellipse', { fill: SHEEN }, { when: HAS_KIND }),
    k.shape(at(30), 'ellipse', { stroke: { color: '#00000052', width: 4 } }, { when: HAS_KIND }),
    k.shape(at(38), 'ellipse', { stroke: { color: '#ffffff66', width: 3 } }, { when: HAS_KIND }),
    k.shape(at(66), 'ellipse', { stroke: { color: '#0000004d', width: 18, dash: [4, 21] } }, { when: HAS_KIND }),
    k.shape(at(108), 'ellipse', { fill: '$bg/84', stroke: { color: '$accent', width: 10 } }, { when: HAS_KIND }),
    k.shape(at(132), 'ellipse', { stroke: { color: '$accent/55', width: 3 } }, { when: HAS_KIND }),
    content,
    k.group({ x: 0, y: 1056, w: 1080, h: 52 }, [k.brand({ w: 'auto', h: 52 }, 'lockup', { size: 52 })], { dir: 'column', align: 'center' }),
  ];

  return template({
    id: 'badge.medal.sticker',
    name: 'Badge, medal, sticker',
    titleKey: 'stickers:tpl.badge.medal',
    kind: 'badge',
    style: 'badge',
    aspect: 'free',
    height: 1140,
    background: { kind: 'transparent' },
    dark: STICKER.dark,
    light: STICKER.light,
    layers,
    requires: ['milestone.kind'],
    meta: { transparent: true, tags: ['award'] },
  });
}

// ------------------------------------------------------------------------------------------------ streak sticker

/** `badge.streak.sticker`: a flame disc, the day count set huge, the unit, and the best streak when there is one. */
function badgeStreakSticker(): TemplateInput {
  const k = kit('bs');
  const best = (when?: Record<string, unknown>) =>
    k.text({ w: 'auto', h: 'auto' }, tl('tpl.badge.text.best', { count: '{streak.best}' }), { size: 40, weight: 700, color: '$fgSoft', shadow: true, when });
  const column = k.group(
    { x: 0, y: 40, w: 1080, h: 'auto' },
    [
      k.group({ w: 300, h: 300 }, [
        k.shape({ x: 0, y: 0, w: 300, h: 300 }, 'ellipse', { fill: '$surfaceStrong', stroke: { color: '$accent', width: 8 } }),
        k.icon({ x: 70, y: 62, w: 160, h: 176 }, 'flame', '$accent'),
      ]),
      k.stat({ w: 900, h: 'auto' }, '{streak.days|int}', { size: 400, unitSize: 80, color: '$fg', align: 'center', labelPos: 'none', minSize: 160, shadow: true }),
      k.text({ w: 900, h: 'auto' }, '{streak.unit}', { size: 56, weight: 800, upper: true, ls: 4, align: 'center', shadow: true, minSize: 34 }),
      best({ all: [has('streak.best'), { bind: 'streak.best', gt: 0 }] }),
    ],
    { dir: 'column', gap: 36, align: 'center' },
  );

  return template({
    id: 'badge.streak.sticker',
    name: 'Badge, streak, sticker',
    titleKey: 'stickers:tpl.badge.streak',
    kind: 'badge',
    style: 'badge',
    aspect: 'free',
    height: 1060,
    background: { kind: 'transparent' },
    dark: STICKER.dark,
    light: STICKER.light,
    layers: [column, k.group({ x: 0, y: 984, w: 1080, h: 48 }, [k.brand({ w: 'auto', h: 48 }, 'lockup', { size: 48 })], { dir: 'column', align: 'center' })],
    requires: ['streak.days'],
    meta: { transparent: true, tags: ['award', 'streak'] },
  });
}

// ------------------------------------------------------------------------------------------------ record sticker

/** `badge.pr.sticker`: a wide strip, trophy disc on the left, the title and the record value on the right. */
function badgePrSticker(): TemplateInput {
  const k = kit('bp');
  const text = k.group(
    { w: 'fill', h: 'auto' },
    [
      k.text({ w: 'fill', h: 'auto' }, tl('tpl.badge.text.record'), { size: 28, weight: 700, upper: true, ls: 4, color: '$accent', minSize: 24, when: is('milestone.kind', 'pr') }),
      k.text({ w: 'fill', h: 'auto' }, '{milestone.title}', { size: 56, weight: 800, fit: 'wrap', maxLines: 2, minSize: 34, lh: 1.08 }),
      ...bigValue(k, 640, { size: 150, unitSize: 60, color: '$accent', minSize: 70 }),
      k.text({ w: 'fill', h: 'auto' }, '{milestone.subtitle}', { size: 30, weight: 600, color: '$fgMuted', fit: 'wrap', maxLines: 2, minSize: 24 }),
    ],
    { dir: 'column', gap: 18, align: 'stretch' },
  );
  const panel = k.group(
    { x: 24, y: 24, w: 1032, h: 'auto' },
    [k.group({ w: 'fill', h: 'auto' }, [iconDisc(k, 240, true), text], { dir: 'row', gap: 40, align: 'center' }), brandRow(k, 44, 26)],
    { dir: 'column', gap: 28, align: 'stretch', padding: 48, fill: '$surfaceStrong', radius: 56 },
  );

  return template({
    id: 'badge.pr.sticker',
    name: 'Badge, record, sticker',
    titleKey: 'stickers:tpl.badge.pr',
    kind: 'badge',
    style: 'badge',
    aspect: 'free',
    height: 560,
    background: { kind: 'transparent' },
    dark: STICKER.dark,
    light: STICKER.light,
    layers: [panel],
    requires: ['milestone.title'],
    meta: { transparent: true, tags: ['award'] },
  });
}

// ------------------------------------------------------------------------------------------------ bold cards

/** The streak line under a non-streak milestone: flame, days, unit. Hidden when there is no streak or the milestone is the streak. */
function streakLine(k: Kit, size: number): LayerJson {
  return k.group(
    { w: 'fill', h: 'auto' },
    [
      k.icon({ w: size, h: size }, 'flame', '$fg'),
      k.text({ w: 'fill', h: 'auto' }, '{streak.days|int} {streak.unit}', { size: size * 0.8, weight: 700, color: '$fgSoft', minSize: 26 }),
    ],
    { dir: 'row', gap: 18, align: 'center', when: { all: [has('streak.days'), not(is('milestone.kind', 'streak'))] } },
  );
}

/** `badge.bold.story`: volt card. The milestone number is the poster, the title and subtitle under it, the glyph in the header. */
function badgeBoldStory(): TemplateInput {
  const k = kit('bb');
  const header = k.group(
    { w: 'fill', h: 168 },
    [
      k.text({ w: 'fill' }, tl('tpl.badge.text.earned'), { size: 44, weight: 800, upper: true, ls: 3, minSize: 30 }),
      k.group({ w: 168, h: 168 }, [k.shape({ x: 0, y: 0, w: 168, h: 168 }, 'ellipse', { fill: '$fg' }), ...kindIcon(k, { x: 40, y: 40, w: 88 }, '$bg')]),
    ],
    { dir: 'row', gap: 24, align: 'start' },
  );
  const hero = k.group(
    { w: 'fill', h: 'auto' },
    [
      ...bigValue(k, 936, { size: 430, unitSize: 110, color: '$accent', minSize: 130 }),
      k.text({ w: 'fill', h: 'auto' }, '{milestone.title}', { size: 76, weight: 800, fit: 'wrap', maxLines: 2, minSize: 44, lh: 1.08 }),
      k.text({ w: 'fill', h: 'auto' }, '{milestone.subtitle}', { size: 42, weight: 600, color: '$fgMuted', fit: 'wrap', maxLines: 2, minSize: 28 }),
    ],
    { dir: 'column', gap: 52, align: 'stretch' },
  );
  const root = k.group({ x: 72, y: 250, w: 936, h: 1190 }, [header, spacer(k), hero, spacer(k), streakLine(k, 56)], { dir: 'column', gap: 36, align: 'stretch' });

  return template({
    id: 'badge.bold.story',
    name: 'Badge, bold, story',
    titleKey: 'stickers:tpl.badge.bold',
    kind: 'badge',
    style: 'bold',
    aspect: 'story',
    background: { kind: 'color', color: '$bg' },
    dark: VOLT.dark,
    light: VOLT.light,
    layers: [root, k.group({ x: 72, y: 1510, w: 936, h: 56 }, [brandRow(k, 56, 30)], { dir: 'column', align: 'stretch' })],
    meta: { tags: ['numbers', 'award'] },
  });
}

/** `badge.bold.square`: the glyph disc on the right edge, number bottom-left. */
function badgeBoldSquare(): TemplateInput {
  const k = kit('bq');
  const header = k.group(
    { w: 'fill', h: 150 },
    [
      k.text({ w: 'fill' }, tl('tpl.badge.text.earned'), { size: 40, weight: 800, upper: true, ls: 3, minSize: 28 }),
      k.group({ w: 150, h: 150 }, [k.shape({ x: 0, y: 0, w: 150, h: 150 }, 'ellipse', { fill: '$fg' }), ...kindIcon(k, { x: 37, y: 37, w: 76 }, '$bg')]),
    ],
    { dir: 'row', gap: 24, align: 'start' },
  );
  const hero = k.group(
    { w: 'fill', h: 'auto' },
    [
      ...bigValue(k, 952, { size: 330, unitSize: 90, color: '$accent', minSize: 110 }),
      k.text({ w: 'fill', h: 'auto' }, '{milestone.title}', { size: 62, weight: 800, fit: 'wrap', maxLines: 2, minSize: 38, lh: 1.08 }),
      k.text({ w: 'fill', h: 'auto' }, '{milestone.subtitle}', { size: 36, weight: 600, color: '$fgMuted', fit: 'wrap', maxLines: 2, minSize: 26 }),
    ],
    { dir: 'column', gap: 40, align: 'stretch' },
  );
  const root = k.group({ x: 64, y: 64, w: 952, h: 952 }, [header, spacer(k), hero, brandRow(k, 48, 26)], { dir: 'column', gap: 44, align: 'stretch' });

  return template({
    id: 'badge.bold.square',
    name: 'Badge, bold, square',
    titleKey: 'stickers:tpl.badge.bold',
    kind: 'badge',
    style: 'bold',
    aspect: 'square',
    background: { kind: 'color', color: '$bg' },
    dark: VOLT.dark,
    light: VOLT.light,
    layers: [root],
    meta: { tags: ['numbers', 'award'] },
  });
}

export const BADGE_TEMPLATES: TemplateInput[] = [badgeMedalSticker(), badgeStreakSticker(), badgePrSticker(), badgeBoldStory(), badgeBoldSquare()];

/**
 * Blocks several templates share: the sport glyph, the watermark footer and the stat cells. They only compose kit layers,
 * so a template that needs something different simply does not call them.
 */
import type { Kit, LayerJson, StatOpts } from './dsl';

/** Condition helpers for `when`. */
export const has = (bind: string) => ({ bind, exists: true });
export const lacks = (bind: string) => ({ bind, exists: false });
export const is = (bind: string, eq: unknown) => ({ bind, eq });
export const all = (...conds: Record<string, unknown>[]) => ({ all: conds });
export const any = (...conds: Record<string, unknown>[]) => ({ any: conds });
export const not = (cond: Record<string, unknown>) => ({ not: cond });

/** `{ t: 'stickers:label.time' }`. */
export const tl = (key: string, args?: Record<string, string>) => ({ t: `stickers:${key}`, ...(args ? { args } : {}) });

/** The glyph of `run.kind`: five icon layers stacked in one box, exactly one passes its `when`. */
export function sportGlyph(k: Kit, x: number, y: number, size: number, color: string, bind = 'run.kind'): LayerJson[] {
  const kinds: [string, string][] = [
    ['run', 'run'],
    ['walk', 'walk'],
    ['ride', 'bike'],
    ['swim', 'swim'],
  ];
  const layers = kinds.map(([kind, icon]) => k.icon({ x, y, w: size, h: size }, icon, color, { when: is(bind, kind) }));
  layers.push(k.icon({ x, y, w: size, h: size }, 'fitness', color, { when: not({ bind, in: kinds.map(([kind]) => kind) }) }));
  return layers;
}

/**
 * The footer of a card: brand lockup left, link right-aligned, in one row. Both are watermark layers, so they vanish when the
 * person turns the watermark off (Pro) and the rest of the card does not move. Returns one layer, placed at `x`, `y`.
 */
export function footer(k: Kit, x: number, y: number, w: number, h = 56): LayerJson[] {
  return [
    k.group({ x, y, w, h }, [k.brand({ w: 'auto', h }, 'lockup', { size: h }), k.shape({ w: 'fill', h: 1 }, 'rect'), k.brand({ w: 'auto', h: 'auto' }, 'link', { size: Math.max(26, Math.round(h * 0.5)) })], {
      dir: 'row',
      gap: 24,
      align: 'center',
    }),
  ];
}

/** A row of equal stat cells; a cell whose value is missing is removed and the others share the width. */
export function statRow(
  k: Kit,
  cells: { value: string; label: string | { t: string }; unit?: string | { t: string }; when?: Record<string, unknown> }[],
  o: { size: number; labelSize: number; color?: string; labelColor?: string; labelPos?: StatOpts['labelPos']; align?: StatOpts['align']; unitSize?: number; weight?: number },
): LayerJson[] {
  return cells.map((cell) =>
    k.stat({ w: 'fill', h: 'auto' }, cell.value, {
      unit: cell.unit,
      label: cell.label,
      size: o.size,
      labelSize: o.labelSize,
      color: o.color,
      labelColor: o.labelColor,
      labelPos: o.labelPos ?? 'above',
      align: o.align,
      unitSize: o.unitSize,
      weight: o.weight,
      minSize: 40,
      when: cell.when,
    }),
  );
}

/**
 * Blocks the sleep, ready and watch templates share. They only compose kit layers (see `blocks.ts` for the general ones).
 */
import { all, any, has, lacks } from './blocks';
import type { Kit, LayerJson } from './dsl';

/** The footer of a card: lockup left, link right on the same baseline. Both marks are watermark layers. */
export function footerRow(k: Kit, x: number, y: number, w: number, h = 56): LayerJson {
  return k.group(
    { x, y, w, h },
    [k.brand({ w: 'auto', h }, 'lockup', { size: h }), k.brand({ w: 'auto', h: 'auto' }, 'link', { size: 28 })],
    { dir: 'row', gap: 24, align: 'center', justify: 'between' },
  );
}

export interface RingSpec {
  /** The path whose presence says the ring exists (the ring's own progress datum). */
  present: string;
  props: Record<string, unknown>;
}

/** Subsets of `items` with exactly `n` members. */
function subsets<T>(items: readonly T[], n: number): T[][] {
  if (n === 0) return [[]];
  if (items.length < n) return [];
  const [head, ...rest] = items as [T, ...T[]];
  return [...subsets(rest, n - 1).map((s) => [head, ...s]), ...subsets(rest, n)];
}

/**
 * Concentric rings, outermost first. A ring whose datum is missing disappears and the rings after it move outward, so two
 * rings are a deliberate pair and one ring is a single big ring, never a ring floating in the middle of empty tracks.
 * Every ring is authored once per slot it can land in, and exactly one variant passes its `when`.
 */
export function concentricRings(k: Kit, specs: readonly RingSpec[], o: { size: number; thickness: number; gap: number; x?: number; y?: number }): LayerJson[] {
  const layers: LayerJson[] = [];
  specs.forEach((spec, index) => {
    const before = specs.slice(0, index).map((s) => s.present);
    for (let slot = 0; slot <= index; slot++) {
      const cases = subsets(before, slot).map((taken) => all(has(spec.present), ...taken.map(has), ...before.filter((p) => !taken.includes(p)).map(lacks)));
      const size = o.size - slot * 2 * (o.thickness + o.gap);
      const inset = (o.size - size) / 2;
      layers.push(k.ring({ x: (o.x ?? 0) + inset, y: (o.y ?? 0) + inset, w: size, h: size }, { thickness: o.thickness, ...spec.props }, { when: cases.length === 1 ? cases[0] : any(...cases) }));
    }
  });
  return layers;
}

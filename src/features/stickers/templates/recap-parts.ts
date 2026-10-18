/**
 * Pieces the weekly families (`week`, `load`) share: the seven day bars with today lit, and a footer row with the link
 * pushed to the right edge. Local to these two families; the shared `blocks.ts` stays untouched.
 */
import { is, lacks } from './blocks';
import type { Box, Dim, Kit, LayerJson } from './dsl';

export interface DayBarsOpts {
  w: Dim;
  h: Dim;
  x?: number;
  y?: number;
  series: string;
  labels: string;
  /** Index of today in the week (0 = Monday); without it the tallest bar is lit instead. */
  today?: string;
  color?: string;
  color2?: string;
  labelSize?: number;
  labelColor?: string;
  barRadius?: number;
  showLabels?: boolean;
  max?: number;
  when?: Record<string, unknown>;
}

/**
 * Seven bars with one lit. `highlight` on a chart is a static index, so one chart layer per weekday is authored and the one
 * whose index equals `today` passes its `when`; the last layer lights the tallest bar when the week has no today.
 */
export function dayBars(k: Kit, o: DayBarsOpts): LayerJson[] {
  const base = {
    kind: 'bars',
    series: { bind: o.series },
    labels: { bind: o.labels },
    color: o.color ?? '$accent',
    color2: o.color2,
    barRadius: o.barRadius ?? 14,
    showLabels: o.showLabels ?? true,
    labelSize: o.labelSize ?? 28,
    labelColor: o.labelColor,
    max: o.max,
  };
  const box: Box = { x: o.x, y: o.y, w: o.w, h: o.h };
  const gate = (extra?: Record<string, unknown>) => {
    const parts = [o.when, extra].filter((c): c is Record<string, unknown> => c !== undefined);
    return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { all: parts };
  };
  const out: LayerJson[] = [];
  if (o.today) {
    for (let i = 0; i < 7; i++) out.push(k.chart(box, { ...base, highlight: i }, { when: gate(is(o.today, i)) }));
    out.push(k.chart(box, { ...base, highlight: 'max' }, { when: gate(lacks(o.today)) }));
  } else {
    out.push(k.chart(box, { ...base, highlight: 'max' }, { when: gate() }));
  }
  return out;
}

/** Flexible empty space inside a stack. `when` makes it appear only for the layouts that need it. */
export function spacer(k: Kit, when?: Record<string, unknown>): LayerJson {
  return k.shape({ w: 'fill', h: 'fill' }, 'rect', {}, when ? { when } : {});
}

/** Brand lockup on the left, link on the right edge. Both are watermark layers: they vanish together. */
export function brandRow(k: Kit, h = 52, linkSize = 28): LayerJson {
  return k.group(
    { w: 'fill', h },
    [k.brand({ w: 'auto', h }, 'lockup', { size: h }), k.shape({ w: 'fill', h: 1 }, 'rect'), k.brand({ w: 'auto', h: 'auto' }, 'link', { size: linkSize })],
    { dir: 'row', align: 'center' },
  );
}

/** A hairline across a column. */
export function rule(k: Kit, color = '$line', width = 3): LayerJson {
  return k.shape({ w: 'fill', h: 3 }, 'line', { stroke: { color, width } });
}

export const RANGE = '{week.rangeStart|date:short} - {week.rangeEnd|date:short}';

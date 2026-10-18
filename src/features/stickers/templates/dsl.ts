/**
 * A thin authoring kit for the built-in templates. It only builds the plain JSON the schema describes (one object per layer);
 * nothing here runs on a phone: `catalog.ts` calls these once at module load and `parseTemplate` validates the result, so a
 * typo is a red unit test (`templates.test.ts`), never a crash. A user template made by the future Studio is the same JSON.
 */
import type { TemplateInput } from '../core/schema';

export type Dim = number | 'auto' | 'fill';
export interface Box {
  x?: number;
  y?: number;
  w?: Dim;
  h?: Dim;
}

/** A layer as authored: validated later by `parseTemplate`, which fills every default. */
export interface LayerJson {
  id: string;
  type: string;
  box: { x: number; y: number; w: Dim; h: Dim };
  [key: string]: unknown;
}

export type Cond = Record<string, unknown>;

export interface Common {
  id?: string;
  when?: Cond;
  opacity?: number;
  rotation?: number;
  role?: 'watermark' | 'attribution';
  onMissing?: 'hide' | 'keep';
  fallback?: string;
}

export interface TextOpts extends Common {
  size?: number;
  weight?: number;
  font?: 'display' | 'body' | 'mono';
  color?: string;
  align?: 'left' | 'center' | 'right';
  ls?: number;
  lh?: number;
  upper?: boolean;
  fit?: 'shrink' | 'ellipsis' | 'wrap';
  minSize?: number;
  maxLines?: number;
  shadow?: boolean;
  valign?: 'top' | 'middle' | 'bottom';
  trim?: boolean;
}

export interface StatOpts extends Common {
  unit?: string | { t: string; args?: Record<string, string> };
  label?: string | { t: string; args?: Record<string, string> };
  size?: number;
  unitSize?: number;
  labelSize?: number;
  weight?: number;
  color?: string;
  labelColor?: string;
  align?: 'left' | 'center' | 'right';
  labelPos?: 'above' | 'below' | 'none';
  gap?: number;
  minSize?: number;
  shadow?: boolean;
  font?: 'display' | 'body' | 'mono';
  trim?: boolean;
}

export interface GroupOpts extends Common {
  dir?: 'row' | 'column';
  gap?: number;
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between';
  padding?: number;
  fill?: unknown;
  stroke?: { color: string; width: number; dash?: [number, number] };
  radius?: number;
  glass?: boolean;
  clip?: boolean;
}

export type Expr = string | { t: string; args?: Record<string, string> };

/** Per-template layer factory: ids are `<prefix><n>`, unique inside the template. */
export interface Kit {
  text(box: Box, value: Expr, o?: TextOpts): LayerJson;
  stat(box: Box, value: Expr, o?: StatOpts): LayerJson;
  group(box: Box, children: LayerJson[], o?: GroupOpts): LayerJson;
  ring(box: Box, props: Record<string, unknown>, o?: Common): LayerJson;
  chart(box: Box, props: Record<string, unknown>, o?: Common): LayerJson;
  /** `points` defaults to the `run.route` binding. */
  route(box: Box, props?: Record<string, unknown>, o?: Common): LayerJson;
  icon(box: Box, name: string, color?: string, o?: Common): LayerJson;
  shape(box: Box, shape: 'rect' | 'ellipse' | 'line' | 'path', props?: Record<string, unknown>, o?: Common): LayerJson;
  /** A brand layer is a `watermark` unless `o.role` says otherwise. */
  brand(box: Box, mark: 'logo' | 'wordmark' | 'lockup' | 'link', props?: { tone?: string; size?: number }, o?: Common): LayerJson;
  image(box: Box, props: Record<string, unknown>, o?: Common): LayerJson;
}

export function kit(prefix = 'l'): Kit {
  let n = 0;
  const idOf = (o: Common | undefined) => o?.id ?? `${prefix}${++n}`;
  const base = (type: string, box: Box, o: Common | undefined) => {
    const layer: LayerJson = {
      id: idOf(o),
      type,
      box: { x: box.x ?? 0, y: box.y ?? 0, w: box.w ?? 'auto', h: box.h ?? 'auto' },
    };
    if (o?.when) layer.when = o.when;
    if (o?.opacity !== undefined) layer.opacity = o.opacity;
    if (o?.rotation !== undefined) layer.rotation = o.rotation;
    if (o?.role) layer.role = o.role;
    if (o?.onMissing) layer.onMissing = o.onMissing;
    if (o?.fallback) layer.fallback = o.fallback;
    return layer;
  };
  const put = (layer: LayerJson, props: Record<string, unknown>): LayerJson => {
    for (const [key, value] of Object.entries(props)) if (value !== undefined) layer[key] = value;
    return layer;
  };

  return {
    text(box: Box, value: Expr, o: TextOpts = {}): LayerJson {
      return put(base('text', box, o), {
        value,
        size: o.size,
        weight: o.weight,
        font: o.font,
        color: o.color,
        align: o.align,
        letterSpacing: o.ls,
        lineHeight: o.lh,
        case: o.upper ? 'upper' : undefined,
        fit: o.fit || o.minSize !== undefined || o.maxLines !== undefined ? { mode: o.fit ?? 'shrink', minSize: o.minSize, maxLines: o.maxLines } : undefined,
        shadow: o.shadow,
        valign: o.valign,
        trim: o.trim ? 'cap' : undefined,
      });
    },
    stat(box: Box, value: Expr, o: StatOpts = {}): LayerJson {
      return put(base('stat', box, o), {
        value,
        unit: o.unit,
        label: o.label,
        valueSize: o.size,
        unitSize: o.unitSize,
        labelSize: o.labelSize,
        valueWeight: o.weight,
        color: o.color,
        labelColor: o.labelColor,
        align: o.align,
        labelPos: o.labelPos,
        gap: o.gap,
        font: o.font,
        fit: o.minSize !== undefined ? { mode: 'shrink', minSize: o.minSize } : undefined,
        shadow: o.shadow,
        trim: o.trim === false ? 'none' : undefined,
      });
    },
    group(box: Box, children: LayerJson[], o: GroupOpts = {}): LayerJson {
      const layout = o.dir
        ? { kind: 'stack', dir: o.dir, gap: o.gap ?? 0, align: o.align ?? 'start', justify: o.justify ?? 'start', padding: o.padding ?? 0 }
        : undefined;
      return put(base('group', box, o), { children, layout, fill: o.fill, stroke: o.stroke, radius: o.radius, glass: o.glass, clip: o.clip });
    },
    ring(box: Box, props: Record<string, unknown>, o: Common = {}): LayerJson {
      return put(base('ring', box, o), props);
    },
    chart(box: Box, props: Record<string, unknown>, o: Common = {}): LayerJson {
      return put(base('chart', box, o), props);
    },
    route(box: Box, props: Record<string, unknown> = {}, o: Common = {}): LayerJson {
      return put(base('route', box, o), { points: { bind: 'run.route' }, ...props });
    },
    icon(box: Box, name: string, color = '$fg', o: Common = {}): LayerJson {
      return put(base('icon', box, o), { name, color });
    },
    shape(box: Box, shape: 'rect' | 'ellipse' | 'line' | 'path', props: Record<string, unknown> = {}, o: Common = {}): LayerJson {
      return put(base('shape', box, o), { shape, ...props });
    },
    brand(box: Box, mark: 'logo' | 'wordmark' | 'lockup' | 'link', props: { tone?: string; size?: number } = {}, o: Common = {}): LayerJson {
      return put(base('brand', box, { role: 'watermark', ...o }), { mark, tone: props.tone, size: props.size });
    },
    image(box: Box, props: Record<string, unknown>, o: Common = {}): LayerJson {
      return put(base('image', box, o), props);
    },
  };
}

export interface ThemeColors {
  bg: string;
  bg2: string;
  fg: string;
  fgSoft: string;
  fgMuted: string;
  accent: string;
  accent2: string;
  surface: string;
  surfaceStrong: string;
  line: string;
  good: string;
  warn: string;
  bad: string;
}

export type Aspect = 'story' | 'square' | 'portrait' | 'wide' | 'free';

export const ASPECT_HEIGHTS: Record<Exclude<Aspect, 'free'>, number> = { story: 1920, square: 1080, portrait: 1350, wide: 608 };

export interface TemplateSpec {
  id: string;
  name: string;
  /** `stickers:tpl.<key>` in the picker; falls back to `name`. */
  titleKey?: string;
  kind: string;
  style: string;
  aspect: Aspect;
  /** Required when `aspect` is `free`. */
  height?: number;
  background: unknown;
  dark: Partial<ThemeColors>;
  light: Partial<ThemeColors>;
  layers: LayerJson[];
  requires?: string[];
  safe?: { top: number; right: number; bottom: number; left: number };
  /** Raise `maxLayers` for a table (the schema allows up to 400); the defaults are 22 px text, 140 characters, 60 layers. */
  constraints?: { minFontSize?: number; maxTextChars?: number; maxLayers?: number };
  meta?: { tags?: string[]; transparent?: boolean; needsPhoto?: boolean; needsRoute?: boolean };
}

/** Story safe area: Instagram's header and reply bar cover the top 250 and bottom 340 px of a 1080 x 1920 Story. */
export const STORY_SAFE = { top: 250, right: 72, bottom: 340, left: 72 } as const;

export function template(spec: TemplateSpec): TemplateInput {
  const height = spec.aspect === 'free' ? spec.height! : ASPECT_HEIGHTS[spec.aspect];
  return {
    schemaVersion: 1,
    id: spec.id,
    name: spec.name,
    titleKey: spec.titleKey,
    kind: spec.kind,
    style: spec.style,
    canvas: { width: 1080, height, aspect: spec.aspect },
    safe: spec.safe ?? (spec.aspect === 'story' ? { ...STORY_SAFE } : undefined),
    background: spec.background,
    themes: { dark: { colors: spec.dark }, light: { colors: spec.light } },
    layers: spec.layers,
    requires: spec.requires,
    constraints: spec.constraints,
    meta: spec.meta,
  } as TemplateInput;
}

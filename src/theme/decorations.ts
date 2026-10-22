/**
 * Header decorations: the vector motifs behind the top-right of the Today screen. Pure geometry, no React Native imports, so the
 * shapes can be tested (and drawn to an SVG file) under bun; `ThemeDecoration` renders them with react-native-svg.
 *
 * Every motif is drawn here from plain geometry (circles, arcs, bezier curves), not traced from an image. All of them fade out
 * toward the left and the bottom of the box: the opacity of each piece falls with its distance from the top-right corner, so the
 * motif dissolves into the canvas instead of ending at an edge.
 *
 * - kawung: the batik kawung, a lattice of circles that overlap in pairs (spacing `d`, radius `d/sqrt(2)`). Each overlap is a
 *   lens (outlined), each of the four-arc gaps between them a seed (filled, with a dot), the whole lattice turned 45 degrees.
 *   A traditional public-domain motif, here in two tones (`a` the seeds, `b` the lens outlines and dots).
 * - petals: cherry blossoms, five notched petals around a center, with a few loose petals drifting down.
 * - leaves: a branch entering from the top-right corner with pointed leaves along it, each with a midrib.
 * - lanes: the bend of a running track, concentric lane lines around the corner and one line across them.
 * - dots: a dot grid, the dot-matrix of a display, in one grey (`a`; `b` is unused, red stays out of the header).
 */
import type { Colors, DecorationId } from './themes';

/** The box of the full-size decoration, in dp: anchored to the top-right corner of the screen. */
export const DECORATION_WIDTH = 232;
export const DECORATION_HEIGHT = 168;

/** Which palette color each tone is drawn in. `a` is the body of the motif, `b` the accent. */
export const DECORATION_COLORS: Record<DecorationId, { a: keyof Colors; b: keyof Colors }> = {
  kawung: { a: 'primary', b: 'heroAccent' },
  petals: { a: 'primary', b: 'workouts' },
  leaves: { a: 'primary', b: 'link' },
  lanes: { a: 'primary', b: 'steps' },
  dots: { a: 'mutedForeground', b: 'primary' },
};

export type DecorationTone = 'a' | 'b';

/** One SVG path of the motif: all the pieces of one tone, kind and opacity step, merged into a single `d`. */
export interface DecorationPath {
  d: string;
  tone: DecorationTone;
  kind: 'fill' | 'stroke';
  /** Stroke width in dp (0 for a fill). */
  strokeWidth: number;
  opacity: number;
}

const round = (value: number) => Math.round(value * 10) / 10;

/** Opacity step: pieces within 0.02 of each other share a path, so a motif is a few dozen paths, not hundreds. */
const OPACITY_STEP = 0.02;

/** Merges pieces into `DecorationPath`s by tone, kind, stroke width and quantized opacity. */
class Collector {
  private readonly paths = new Map<string, DecorationPath>();

  add(tone: DecorationTone, kind: 'fill' | 'stroke', strokeWidth: number, opacity: number, d: string): void {
    const step = Math.round(opacity / OPACITY_STEP);
    if (step < 1) return;
    const width = kind === 'stroke' ? round(strokeWidth) : 0;
    const key = `${tone}|${kind}|${width}|${step}`;
    const known = this.paths.get(key);
    if (known) known.d += d;
    else this.paths.set(key, { d, tone, kind, strokeWidth: width, opacity: step * OPACITY_STEP });
  }

  result(): DecorationPath[] {
    return [...this.paths.values()];
  }
}

/** 1 at the top-right corner, 0 on the left edge and the bottom edge of the box, eased in between. */
function fade(x: number, y: number, width: number, height: number): number {
  const t = Math.hypot((width - x) / width, y / height);
  if (t >= 1) return 0;
  const k = 1 - t;
  return k * k * (3 - 2 * k);
}

function circle(cx: number, cy: number, r: number): string {
  return `M${round(cx - r)} ${round(cy)}A${round(r)} ${round(r)} 0 1 0 ${round(cx + r)} ${round(cy)}A${round(r)} ${round(r)} 0 1 0 ${round(cx - r)} ${round(cy)}Z`;
}

function kawung(box: Collector, width: number, height: number, s: number): void {
  const d = 22 * s;
  const r = d / Math.SQRT2;
  const h = d / 2;
  const cos = Math.SQRT1_2;
  const sin = Math.SQRT1_2;
  // The lattice origin sits half a cell off the corner so that no seed is centered on the screen edge.
  const ox = width - 0.3 * d;
  const oy = 0.2 * d;
  const at = (x: number, y: number): [number, number] => [ox + x * cos - y * sin, oy + x * sin + y * cos];
  const p = (x: number, y: number) => {
    const [px, py] = at(x, y);
    return `${round(px)} ${round(py)}`;
  };
  const arc = (sweep: 0 | 1) => `A${round(r)} ${round(r)} 0 0 ${sweep} `;
  const reach = Math.ceil(Math.hypot(width, height) / d) + 1;
  const dot = 0.09 * d;
  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) {
      const x = i * d;
      const y = j * d;
      // A seed: the concave diamond around a lattice point, its corners on the four neighboring cell centers.
      const [cx, cy] = at(x, y);
      const f = fade(cx, cy, width, height);
      if (f > 0.02) {
        const seed =
          `M${p(x - h, y - h)}${arc(0)}${p(x + h, y - h)}${arc(0)}${p(x + h, y + h)}` +
          `${arc(0)}${p(x - h, y + h)}${arc(0)}${p(x - h, y - h)}Z`;
        box.add('a', 'fill', 0, 0.26 * f, seed);
        box.add('b', 'fill', 0, 0.75 * f, circle(cx, cy, dot));
      }
      // The two lenses at this point's right and lower edges: the overlap of this circle with its right and lower neighbor.
      const [hx, hy] = at(x + h, y);
      const fh = fade(hx, hy, width, height);
      if (fh > 0.02) {
        const lens = `M${p(x + h, y - h)}${arc(1)}${p(x + h, y + h)}${arc(1)}${p(x + h, y - h)}Z`;
        box.add('b', 'fill', 0, 0.12 * fh, lens);
        box.add('b', 'stroke', Math.max(0.6, 1.1 * s), 0.5 * fh, lens);
      }
      const [vx, vy] = at(x, y + h);
      const fv = fade(vx, vy, width, height);
      if (fv > 0.02) {
        const lens = `M${p(x - h, y + h)}${arc(1)}${p(x + h, y + h)}${arc(1)}${p(x - h, y + h)}Z`;
        box.add('b', 'fill', 0, 0.12 * fv, lens);
        box.add('b', 'stroke', Math.max(0.6, 1.1 * s), 0.5 * fv, lens);
      }
    }
  }
}

/** One cherry petal of length `len` from the origin, pointing up, with the small notch at its tip. */
function petalPath(len: number, place: (x: number, y: number) => string): string {
  const L = len;
  return (
    `M${place(0, 0)}C${place(-0.42 * L, -0.12 * L)} ${place(-0.5 * L, -0.74 * L)} ${place(-0.12 * L, -1 * L)}` +
    `L${place(0, -0.88 * L)}L${place(0.12 * L, -1 * L)}` +
    `C${place(0.5 * L, -0.74 * L)} ${place(0.42 * L, -0.12 * L)} ${place(0, 0)}Z`
  );
}

/** Blossoms and loose petals as [x, y, petal length, rotation in degrees], x and y in fractions of the box (x from the right edge). */
const BLOSSOMS: readonly (readonly [number, number, number, number])[] = [
  [0.14, 0.2, 0.1, 12],
  [0.4, 0.07, 0.065, 38],
  [0.08, 0.62, 0.062, -20],
];
const LOOSE_PETALS: readonly (readonly [number, number, number, number])[] = [
  [0.34, 0.4, 0.05, 130],
  [0.2, 0.46, 0.042, -60],
  [0.5, 0.26, 0.04, 75],
  [0.3, 0.7, 0.036, 200],
  [0.62, 0.52, 0.032, 20],
];

function petals(box: Collector, width: number, height: number): void {
  const place = (cx: number, cy: number, angle: number) => (x: number, y: number) => {
    const rad = (angle * Math.PI) / 180;
    const c = Math.cos(rad);
    const sn = Math.sin(rad);
    return `${round(cx + x * c - y * sn)} ${round(cy + x * sn + y * c)}`;
  };
  for (const [fx, fy, size, rotation] of BLOSSOMS) {
    const cx = width - fx * width;
    const cy = fy * height;
    const f = fade(cx, cy, width, height) ** 0.7;
    const L = size * width;
    for (let k = 0; k < 5; k++) {
      box.add('a', 'fill', 0, 0.34 * f, petalPath(L, place(cx, cy, rotation + k * 72)));
    }
    box.add('b', 'fill', 0, 0.8 * f, circle(cx, cy, 0.16 * L));
  }
  for (const [fx, fy, size, rotation] of LOOSE_PETALS) {
    const cx = width - fx * width;
    const cy = fy * height;
    const f = fade(cx, cy, width, height) ** 0.7;
    box.add('a', 'fill', 0, 0.3 * f, petalPath(size * width * 1.3, place(cx, cy, rotation)));
  }
}

/** A pointed leaf of length `len` from the origin along +x, as a closed path, and its midrib. */
function leaf(len: number, place: (x: number, y: number) => string): { body: string; rib: string } {
  const L = len;
  return {
    body:
      `M${place(0, 0)}C${place(0.25 * L, -0.34 * L)} ${place(0.72 * L, -0.34 * L)} ${place(L, 0)}` +
      `C${place(0.72 * L, 0.34 * L)} ${place(0.25 * L, 0.34 * L)} ${place(0, 0)}Z`,
    rib: `M${place(0, 0)}L${place(0.86 * L, 0)}`,
  };
}

function leaves(box: Collector, width: number, height: number, s: number): void {
  // A quadratic branch from just outside the top-right corner, sagging down and to the left.
  const start = [width + 8, -6] as const;
  const control = [width * 0.86, height * 0.62] as const;
  const end = [width * 0.2, height * 0.66] as const;
  const point = (t: number): [number, number] => [
    (1 - t) * (1 - t) * start[0] + 2 * (1 - t) * t * control[0] + t * t * end[0],
    (1 - t) * (1 - t) * start[1] + 2 * (1 - t) * t * control[1] + t * t * end[1],
  ];
  const tangent = (t: number): number =>
    Math.atan2(
      2 * (1 - t) * (control[1] - start[1]) + 2 * t * (end[1] - control[1]),
      2 * (1 - t) * (control[0] - start[0]) + 2 * t * (end[0] - control[0]),
    );
  const steps = 14;
  for (let k = 0; k < steps; k++) {
    const [x0, y0] = point(k / steps);
    const [x1, y1] = point((k + 1) / steps);
    const f = fade((x0 + x1) / 2, (y0 + y1) / 2, width, height);
    box.add('a', 'stroke', Math.max(0.7, 1.5 * s), 0.5 * f, `M${round(x0)} ${round(y0)}L${round(x1)} ${round(y1)}`);
  }
  const count = 9;
  for (let k = 0; k < count; k++) {
    const t = 0.12 + (k / (count - 1)) * 0.84;
    const [px, py] = point(t);
    const side = k % 2 === 0 ? -1 : 1;
    const angle = tangent(t) + side * 0.95;
    const len = (44 - 20 * t) * s;
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    const place = (x: number, y: number) => `${round(px + x * c - y * sn)} ${round(py + x * sn + y * c)}`;
    const shape = leaf(len, place);
    const f = fade(px + c * len * 0.5, py + sn * len * 0.5, width, height) ** 0.6;
    box.add('a', 'fill', 0, 0.36 * f, shape.body);
    box.add('b', 'stroke', Math.max(0.5, 0.9 * s), 0.6 * f, shape.rib);
  }
}

function lanes(box: Collector, width: number, height: number, s: number): void {
  const lanesCount = 7;
  const first = 34 * s;
  const gap = 15 * s;
  const stroke = Math.max(0.7, 1.4 * s);
  const segments = 10;
  for (let k = 0; k < lanesCount; k++) {
    const r = first + k * gap;
    for (let seg = 0; seg < segments; seg++) {
      const a0 = (seg / segments) * (Math.PI / 2);
      const a1 = ((seg + 1) / segments) * (Math.PI / 2);
      // Quarter circle around the corner (width, 0): from straight left of it to straight below it.
      const x0 = width - r * Math.cos(a0);
      const y0 = r * Math.sin(a0);
      const x1 = width - r * Math.cos(a1);
      const y1 = r * Math.sin(a1);
      const f = fade((x0 + x1) / 2, (y0 + y1) / 2, width, height);
      box.add(k % 2 === 0 ? 'a' : 'b', 'stroke', stroke, 0.45 * f, `M${round(x0)} ${round(y0)}A${round(r)} ${round(r)} 0 0 0 ${round(x1)} ${round(y1)}`);
    }
  }
  // One line across the lanes, like the line that marks a start.
  const angle = 0.62;
  const from = first - 7 * s;
  const to = first + (lanesCount - 1) * gap + 7 * s;
  const segs = 6;
  for (let seg = 0; seg < segs; seg++) {
    const r0 = from + ((to - from) * seg) / segs;
    const r1 = from + ((to - from) * (seg + 1)) / segs;
    const x0 = width - r0 * Math.cos(angle);
    const y0 = r0 * Math.sin(angle);
    const x1 = width - r1 * Math.cos(angle);
    const y1 = r1 * Math.sin(angle);
    const f = fade((x0 + x1) / 2, (y0 + y1) / 2, width, height);
    box.add('b', 'stroke', stroke * 1.4, 0.7 * f, `M${round(x0)} ${round(y0)}L${round(x1)} ${round(y1)}`);
  }
}

function dots(box: Collector, width: number, height: number, s: number): void {
  const pitch = 13 * s;
  const radius = 1.25 * s;
  const cols = Math.ceil(width / pitch);
  const rows = Math.ceil(height / pitch);
  for (let col = 0; col <= cols; col++) {
    for (let row = 0; row <= rows; row++) {
      const x = width - col * pitch - pitch / 2;
      const y = row * pitch + pitch / 2;
      const f = fade(x, y, width, height);
      box.add('a', 'fill', 0, 0.5 * f, circle(x, y, radius));
    }
  }
}

const DRAW: Record<DecorationId, (box: Collector, width: number, height: number, scale: number) => void> = {
  kawung,
  petals,
  leaves,
  lanes,
  dots,
};

/**
 * The paths of a decoration in a `width` by `height` box, anchored to the top-right corner. The motif is sized for
 * `DECORATION_WIDTH`; a smaller box (a picker preview) scales every piece with it.
 */
export function decorationPaths(id: DecorationId, width: number, height: number): DecorationPath[] {
  const box = new Collector();
  DRAW[id](box, width, height, width / DECORATION_WIDTH);
  return box.result();
}

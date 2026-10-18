/**
 * The replay camera: a pure function of the timeline position. It follows the rider with a smoothed, slightly leading
 * centre (so corners are anticipated, not chased), then zooms out to the whole route in the outro.
 *
 * The 2.5D look is an oblique squash of the map plane (`squash` < 1 compresses the vertical axis, the horizon fades into the
 * terrain silhouette), not a perspective projection: react-native-svg has none, and a squash is identical in the app, in the
 * view-shot capture and in the headless SVG renderer. It goes from `FOLLOW_SQUASH` while following to 1 (top-down) at the end.
 *
 * Coordinates are normalised Web Mercator (see `map/tileMath`); `zoom` is the MapLibre zoom (512 px tiles).
 */
import { TILE_SIZE } from '@/features/map/tileMath';

import { pointAt, type RoutePath } from './route';
import type { PhasePosition } from './timing';

export interface Viewport {
  w: number;
  h: number;
}

/** The design canvas of the replay: 9:16, always 1080 wide (the export size), independent of the screen. */
export const VIEW: Viewport = { w: 1080, h: 1920 };
export const FOLLOW_SQUASH = 0.72;
/** Where the rider sits on screen while following, as a fraction of the height. */
export const FOLLOW_ANCHOR = 0.55;
/** Where the middle of the route sits on screen in the overview (clear of the counter and the strip). */
export const FIT_ANCHOR = 0.36;
/** Share of the outro spent zooming out; the rest holds the overview behind the summary card. */
export const ZOOM_OUT_SHARE = 0.5;
export const MIN_FOLLOW_ZOOM = 10.5;
export const MAX_FOLLOW_ZOOM = 16.2;
const INTRO_ZOOM_IN = 0.8;
const KEYS = 240;

export interface Camera {
  /** Mercator point at the screen position (`w / 2`, `ay`). */
  cx: number;
  cy: number;
  zoom: number;
  squash: number;
  /** Screen y of (`cx`, `cy`), px. */
  ay: number;
}

export interface CameraPlan {
  path: RoutePath;
  vp: Viewport;
  zoomFollow: number;
  /** Camera centre at `k / KEYS` of the route while following. */
  keyX: Float64Array;
  keyY: Float64Array;
  fit: Camera;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Pixels the whole world spans at `zoom`. */
export const worldPx = (zoom: number) => TILE_SIZE * 2 ** zoom;

/** Zoom at which the viewport is `spanM` metres wide. */
export function zoomForSpan(path: RoutePath, vp: Viewport, spanM: number): number {
  return Math.log2((vp.w * path.mPerUnit) / (TILE_SIZE * spanM));
}

/** The follow zoom a route of this length gets: the screen shows about 14 % of the route, between 0.9 and 9 km wide. */
export function followZoomFor(path: RoutePath, vp: Viewport): number {
  const spanM = Math.min(9000, Math.max(900, path.lengthM * 0.14));
  return Math.min(MAX_FOLLOW_ZOOM, Math.max(MIN_FOLLOW_ZOOM, zoomForSpan(path, vp, spanM)));
}

function boundsOfPath(path: RoutePath) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let k = 0; k < path.mx.length; k++) {
    x0 = Math.min(x0, path.mx[k]!);
    x1 = Math.max(x1, path.mx[k]!);
    y0 = Math.min(y0, path.my[k]!);
    y1 = Math.max(y1, path.my[k]!);
  }
  return { x0, x1, y0, y1 };
}

/** The overview: the whole route in the window between the top of the map and the counter, flat. */
export function fitCamera(path: RoutePath, vp: Viewport, followZoom: number): Camera {
  const b = boundsOfPath(path);
  const dx = Math.max(b.x1 - b.x0, 1e-9);
  const dy = Math.max(b.y1 - b.y0, 1e-9);
  const availW = vp.w * 0.78;
  const availH = vp.h * 0.4;
  const zoom = Math.min(followZoom, Math.log2(Math.min(availW / (TILE_SIZE * dx), availH / (TILE_SIZE * dy))));
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, zoom: Math.max(2, zoom), squash: 1, ay: vp.h * FIT_ANCHOR };
}

/**
 * Camera centres along the route: the rider averaged over a window of `smoothM` (corners are rounded), nudged towards the
 * point `lookM` ahead, then box-filtered over neighbouring keys. Deterministic for a path.
 */
export function planCamera(path: RoutePath, vp: Viewport = VIEW, zoomFollow = followZoomFor(path, vp)): CameraPlan {
  const smoothM = Math.min(600, Math.max(60, path.lengthM * 0.02));
  const lookM = smoothM * 1.5;
  const rawX = new Float64Array(KEYS + 1);
  const rawY = new Float64Array(KEYS + 1);
  for (let k = 0; k <= KEYS; k++) {
    const d = (k / KEYS) * path.lengthM;
    let ax = 0;
    let ay = 0;
    for (let j = -4; j <= 4; j++) {
      const p = pointAt(path, d + (j / 4) * smoothM);
      ax += p.mx;
      ay += p.my;
    }
    ax /= 9;
    ay /= 9;
    const ahead = pointAt(path, d + lookM);
    rawX[k] = lerp(ax, ahead.mx, 0.35);
    rawY[k] = lerp(ay, ahead.my, 0.35);
  }
  const keyX = new Float64Array(KEYS + 1);
  const keyY = new Float64Array(KEYS + 1);
  for (let k = 0; k <= KEYS; k++) {
    let sx = 0;
    let sy = 0;
    let c = 0;
    for (let j = -3; j <= 3; j++) {
      const kk = Math.min(KEYS, Math.max(0, k + j));
      sx += rawX[kk]!;
      sy += rawY[kk]!;
      c++;
    }
    keyX[k] = sx / c;
    keyY[k] = sy / c;
  }
  return { path, vp, zoomFollow, keyX, keyY, fit: fitCamera(path, vp, zoomFollow) };
}

/** The following camera at route progress `p` (0..1). */
export function followCamera(plan: CameraPlan, p: number): Camera {
  const f = clamp01(p) * KEYS;
  const k = Math.min(KEYS - 1, Math.floor(f));
  const t = f - k;
  return {
    cx: lerp(plan.keyX[k]!, plan.keyX[k + 1]!, t),
    cy: lerp(plan.keyY[k]!, plan.keyY[k + 1]!, t),
    zoom: plan.zoomFollow,
    squash: FOLLOW_SQUASH,
    ay: plan.vp.h * FOLLOW_ANCHOR,
  };
}

function mixCamera(a: Camera, b: Camera, t: number): Camera {
  return {
    cx: lerp(a.cx, b.cx, t),
    cy: lerp(a.cy, b.cy, t),
    zoom: lerp(a.zoom, b.zoom, t),
    squash: lerp(a.squash, b.squash, t),
    ay: lerp(a.ay, b.ay, t),
  };
}

export function cameraAt(plan: CameraPlan, pos: PhasePosition): Camera {
  if (pos.phase === 'intro') {
    const cam = followCamera(plan, 0);
    return { ...cam, zoom: cam.zoom + INTRO_ZOOM_IN * (1 - easeInOutCubic(pos.introP)) };
  }
  const run = followCamera(plan, pos.p);
  if (pos.phase === 'run') return run;
  return mixCamera(run, plan.fit, easeInOutCubic(clamp01(pos.outroP / ZOOM_OUT_SHARE)));
}

/** Screen position of a Mercator point. */
export function project(cam: Camera, vp: Viewport, mx: number, my: number): { x: number; y: number } {
  const w = worldPx(cam.zoom);
  return { x: vp.w / 2 + (mx - cam.cx) * w, y: cam.ay + (my - cam.cy) * w * cam.squash };
}

/** Matrix of the map group: local px of zoom `refZoom` around the Mercator origin `(ox, oy)` -> screen. */
export interface MapMatrix {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export function mapMatrix(cam: Camera, vp: Viewport, refZoom: number, ox: number, oy: number): MapMatrix {
  const s = 2 ** (cam.zoom - refZoom);
  const w = worldPx(cam.zoom);
  return { sx: s, sy: s * cam.squash, tx: vp.w / 2 + (ox - cam.cx) * w, ty: cam.ay + (oy - cam.cy) * w * cam.squash };
}

/** Mercator rectangle the screen shows (with `margin` px around it) at the camera, for tile culling. */
export function visibleMerc(cam: Camera, vp: Viewport, margin: number) {
  const w = worldPx(cam.zoom);
  return {
    x0: cam.cx + (-margin - vp.w / 2) / w,
    x1: cam.cx + (vp.w + margin - vp.w / 2) / w,
    y0: cam.cy + (-margin - cam.ay) / (w * cam.squash),
    y1: cam.cy + (vp.h + margin - cam.ay) / (w * cam.squash),
  };
}

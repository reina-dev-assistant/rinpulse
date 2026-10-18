/**
 * The basemap of a replay: which vector tiles the camera will ever see, fetched through the app's own tile pipeline
 * (`features/map`: OpenMapTiles vector tiles decoded to SVG paths, the palette of the in-app map), kept in a store that is not
 * an LRU, so a replay never refetches a tile it already drew.
 *
 * The camera goes from a street-level follow zoom to a whole-route overview, which no single tile zoom serves. The plan holds
 * a few levels of detail (`lods`): the coarse ones are drawn while the camera is zoomed out, the finest one while following,
 * and a finer level fades in over the coarser one as the zoom approaches it. Tiles are only planned where the camera goes
 * (a corridor along the route), so a 60 km ride is ~100 tiles, not the bounding box.
 *
 * Everything the painter needs per frame is a few matrices: tile paths sit in a static group per tile, the camera only moves
 * the root group.
 */
import type { RenderedTile } from '@/features/map/renderTile';
import type { TileSource } from '@/features/map/tileCache';
import { isAbortError } from '@/features/map/tileCache';
import { TILE_SIZE } from '@/features/map/tileMath';

import { cameraAt, followCamera, mapMatrix, planCamera, smoothstep, visibleMerc, type Camera, type CameraPlan, type Viewport } from './camera';
import type { RoutePath } from './route';
import { phaseAt, type Timing } from './timing';

export interface TileRef {
  z: number;
  x: number;
  y: number;
  key: string;
  /** Earliest timeline sample (of `SAMPLES`) that shows the tile: the load order. */
  need: number;
}

export interface Lod {
  z: number;
  tiles: TileRef[];
}

export interface BasemapPlan {
  /** The zoom the root group's local pixels are at (the finest level). */
  refZoom: number;
  /** Mercator origin of the local pixels, subtracted so coordinates stay small enough for float32 renderers. */
  ox: number;
  oy: number;
  /** Coarse to fine. */
  lods: Lod[];
  total: number;
}

const SAMPLES = 200;
/** Tiles drawn past the screen edge, px. */
const MARGIN = 256;
/** A finer level starts fading in this many zoom steps before its own zoom, and is fully in 0.5 later. */
const FADE_START = 0.9;
const FADE_END = 0.4;
/** Most zoom steps one level covers. */
const LOD_GAP = 3;
export const MAX_TILES = 150;
/** Smallest follow zoom the tile budget may push the plan to. */
export const MIN_BUDGET_ZOOM = 10;

export function lodZooms(fine: number, coarse: number): number[] {
  if (coarse >= fine) return [fine];
  const out = [coarse];
  let z = coarse;
  while (fine - z > LOD_GAP) {
    z += LOD_GAP;
    out.push(z);
  }
  out.push(fine);
  return out;
}

/** Alpha of level `i` at camera zoom `zoom`: 1 for the coarsest, a smooth rise for each finer one. */
export function lodAlpha(lods: readonly Lod[], i: number, zoom: number): number {
  if (i === 0) return 1;
  const z = lods[i]!.z;
  return smoothstep(z - FADE_START, z - FADE_END, zoom);
}

function referenced(lods: readonly Lod[], zoom: number): number[] {
  // The finest level that has started fading in, plus the one below it until the finer one is opaque.
  let fine = 0;
  for (let i = 0; i < lods.length; i++) if (zoom >= lods[i]!.z - FADE_START) fine = i;
  return fine > 0 && lodAlpha(lods, fine, zoom) < 1 ? [fine - 1, fine] : [fine];
}

/** Plans the tiles for a camera plan; `null` never: an empty plan is a plan without tiles. */
export function planBasemap(cam: CameraPlan, timing: Timing): BasemapPlan {
  const fine = Math.floor(cam.zoomFollow);
  const coarse = Math.max(0, Math.floor(cam.fit.zoom));
  const lods: Lod[] = lodZooms(fine, coarse).map((z) => ({ z, tiles: [] }));
  const seen = lods.map(() => new Map<string, TileRef>());

  for (let s = 0; s < SAMPLES; s++) {
    const t = (s / (SAMPLES - 1)) * timing.totalSec;
    const camera = cameraAt(cam, phaseAt(timing, t));
    const view = visibleMerc(camera, cam.vp, MARGIN);
    for (const i of referenced(lods, camera.zoom)) {
      const z = lods[i]!.z;
      const n = 2 ** z;
      const x0 = Math.max(0, Math.floor(view.x0 * n));
      const x1 = Math.min(n - 1, Math.floor(view.x1 * n));
      const y0 = Math.max(0, Math.floor(view.y0 * n));
      const y1 = Math.min(n - 1, Math.floor(view.y1 * n));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const key = `${z}/${x}/${y}`;
          if (!seen[i]!.has(key)) seen[i]!.set(key, { z, x, y, key, need: s });
        }
      }
    }
  }
  lods.forEach((lod, i) => {
    lod.tiles = [...seen[i]!.values()];
  });

  const first = followCamera(cam, 0);
  return { refZoom: fine, ox: first.cx, oy: first.cy, lods, total: lods.reduce((n, l) => n + l.tiles.length, 0) };
}

export interface BudgetedPlan {
  camera: CameraPlan;
  basemap: BasemapPlan;
}

/** Lowers the follow zoom in half steps until the tiles fit the budget (long rides are followed from higher up). */
export function planWithinBudget(path: RoutePath, vp: Viewport, timing: Timing, maxTiles = MAX_TILES): BudgetedPlan {
  let camera = planCamera(path, vp);
  let basemap = planBasemap(camera, timing);
  while (basemap.total > maxTiles && camera.zoomFollow - 0.5 >= MIN_BUDGET_ZOOM) {
    camera = planCamera(path, vp, camera.zoomFollow - 0.5);
    basemap = planBasemap(camera, timing);
  }
  return { camera, basemap };
}

/** Rendered tiles by key. A tile that failed to load is absent (drawn as background). */
export class BasemapStore {
  private tiles = new Map<string, RenderedTile>();

  get(key: string): RenderedTile | undefined {
    return this.tiles.get(key);
  }

  set(key: string, tile: RenderedTile): void {
    this.tiles.set(key, tile);
  }

  get size(): number {
    return this.tiles.size;
  }
}

export interface LoadOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  concurrency?: number;
  timeoutMs?: number;
}

export interface LoadResult {
  loaded: number;
  failed: number;
  /** Every request failed: the device is offline (or the tile server is down) and the replay draws the plain card. */
  offline: boolean;
}

/** Tiles in load order: every coarse level first (the overview is what the outro needs), then the finest by when it is needed. */
export function loadOrder(plan: BasemapPlan): TileRef[] {
  return plan.lods.flatMap((lod, i) => (i === plan.lods.length - 1 ? [...lod.tiles].sort((a, b) => a.need - b.need) : lod.tiles));
}

export async function loadBasemap(plan: BasemapPlan, source: Pick<TileSource, 'rendered'>, store: BasemapStore, opts: LoadOptions = {}): Promise<LoadResult> {
  const order = loadOrder(plan).filter((t) => store.get(t.key) === undefined);
  const total = plan.total;
  let done = plan.total - order.length;
  let loaded = 0;
  let failed = 0;
  let next = 0;
  opts.onProgress?.(done, total);

  const worker = async () => {
    while (next < order.length && !opts.signal?.aborted) {
      const ref = order[next++]!;
      const ctl = new AbortController();
      const onAbort = () => ctl.abort();
      opts.signal?.addEventListener('abort', onAbort);
      const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 8000);
      try {
        store.set(ref.key, await source.rendered(ref.z, ref.x, ref.y, ctl.signal));
        loaded++;
      } catch (e) {
        if (isAbortError(e) && opts.signal?.aborted) return;
        failed++;
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
      done++;
      opts.onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, order.length) }, worker));
  const already = plan.total - order.length;
  return { loaded: loaded + already, failed, offline: order.length > 0 && loaded === 0 && already === 0 };
}

export interface TilePlacement {
  tile: TileRef;
  /** Local ref-zoom px of the tile's top-left, and the scale from the tile's own 512 px space. */
  k: number;
  tx: number;
  ty: number;
}

export interface VisibleLod {
  index: number;
  z: number;
  alpha: number;
  tiles: TilePlacement[];
}

/** The levels to draw at this camera with the tiles whose screen box touches the viewport. */
export function visibleLods(plan: BasemapPlan, cam: Camera, vp: Viewport): VisibleLod[] {
  const m = mapMatrix(cam, vp, plan.refZoom, plan.ox, plan.oy);
  const oxPx = plan.ox * TILE_SIZE * 2 ** plan.refZoom;
  const oyPx = plan.oy * TILE_SIZE * 2 ** plan.refZoom;
  const out: VisibleLod[] = [];
  for (const i of referenced(plan.lods, cam.zoom)) {
    const lod = plan.lods[i]!;
    const k = 2 ** (plan.refZoom - lod.z);
    const size = TILE_SIZE * k;
    const tiles: TilePlacement[] = [];
    for (const tile of lod.tiles) {
      const tx = tile.x * size - oxPx;
      const ty = tile.y * size - oyPx;
      const sx0 = m.tx + tx * m.sx;
      const sy0 = m.ty + ty * m.sy;
      if (sx0 > vp.w + MARGIN || sx0 + size * m.sx < -MARGIN || sy0 > vp.h + MARGIN || sy0 + size * m.sy < -MARGIN) continue;
      tiles.push({ tile, k, tx, ty });
    }
    out.push({ index: i, z: lod.z, alpha: lodAlpha(plan.lods, i, cam.zoom), tiles });
  }
  return out;
}

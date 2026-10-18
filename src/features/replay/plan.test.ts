import { describe, expect, it } from 'bun:test';

import { applyLocale, getT } from '@/i18n';
import type { RenderedTile } from '@/features/map/renderTile';
import { FIT_BRAND } from '@/features/stickers/brand';
import { FIT_FONTS } from '@/features/stickers/fonts';
import type { Locale } from '@/features/stickers/core/format';

import {
  BasemapStore,
  MAX_TILES,
  loadBasemap,
  loadOrder,
  lodAlpha,
  lodZooms,
  planBasemap,
  planWithinBudget,
  visibleLods,
} from './basemap';
import { createSceneBuilder, ridgePath, type SceneBuilder } from './build';
import { cameraAt, planCamera, visibleMerc, VIEW } from './camera';
import { replayToSvg } from './emitSvg';
import { frameAt } from './frame';
import { niceKmStep, planReplay, type ReplayPlan } from './plan';
import { syntheticTrack } from './replayFixtures';
import { buildRoutePath } from './route';
import { firstOf, createBytesTileSource } from './tiles';
import { themeFor } from './theme';
import { buildTiming, phaseAt } from './timing';

function plan(over: Parameters<typeof syntheticTrack>[0] = {}, trimM = 200): ReplayPlan {
  const p = planReplay(syntheticTrack(over), { trimM });
  if ('failure' in p) throw new Error(p.failure);
  return p.plan;
}

const TILE: RenderedTile = {
  z: 0,
  layers: [
    { kind: 'fill', id: 'water', d: 'M0 0L200 0L200 200Z' },
    { kind: 'road', id: 'minor', d: 'M0 0L300 300' },
    { kind: 'casing', id: 'minor', d: 'M0 0L300 300' },
  ],
};

describe('planReplay', () => {
  it('fails with a reason when there is nothing to fly', () => {
    expect('failure' in planReplay(syntheticTrack({ n: 12, speed: 1 }), { trimM: 200 })).toBe(true);
    const short = planReplay(syntheticTrack({ n: 12, speed: 1 }), { trimM: 200 });
    expect('failure' in short && short.failure).toBe('too-short');
    expect('plan' in planReplay(syntheticTrack({ n: 12, speed: 1 }), { trimM: 0 })).toBe(true);
  });

  it('puts km marks on whole kilometre steps of the counter, inside the route', () => {
    const p = plan();
    expect(p.marks.length).toBeGreaterThan(0);
    expect(p.marks.length).toBeLessThanOrEqual(5);
    for (const m of p.marks) {
      expect(m.p).toBeGreaterThan(0.02);
      expect(m.p).toBeLessThan(0.98);
    }
    const step = niceKmStep(p.track.totals.distanceM / 1000);
    expect(p.marks.map((m) => m.km)).toEqual(p.marks.map((_, i) => step * (i + 1)));
  });

  it('chart columns carry altitude and a heart-rate line, speed without heart rate', () => {
    expect(plan().chart.lineKind).toBe('hr');
    const noHr = plan({ withHr: false });
    expect(noHr.chart.lineKind).toBe('speed');
    expect(plan({ withAlt: false }).chart.alt).toBeNull();
  });

  it('niceKmStep keeps the marks to five or fewer', () => {
    for (const km of [3, 9, 21, 42, 80, 160, 320, 1000]) expect(km / niceKmStep(km)).toBeLessThanOrEqual(5.001);
  });

  it('routeD is in small local px (float32-safe) and its length matches the path', () => {
    const p = plan();
    const nums = p.routeD.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.max(...nums.map(Math.abs))).toBeLessThan(200_000);
    expect(p.routeLenPx).toBeCloseTo(p.path.lengthM * p.pxPerM, 6);
  });
});

describe('frame state', () => {
  const p = plan({ n: 500 });
  const total = p.timing.totalSec;

  it('is a pure function of time: out of order and repeated calls agree', () => {
    const a = frameAt(p, 9.1);
    frameAt(p, 20);
    frameAt(p, 0);
    expect(frameAt(p, 9.1)).toEqual(a);
  });

  it('the counters run 0 -> workout total, monotonic', () => {
    expect(frameAt(p, 0).distanceM).toBe(0);
    expect(frameAt(p, 0).elapsedSec).toBe(0);
    let last = -1;
    let lastT = -1;
    for (let i = 0; i <= 600; i++) {
      const f = frameAt(p, (i / 600) * total);
      expect(f.distanceM).toBeGreaterThanOrEqual(last - 1e-6);
      expect(f.elapsedSec).toBeGreaterThanOrEqual(lastT - 1e-6);
      last = f.distanceM;
      lastT = f.elapsedSec;
    }
    const end = frameAt(p, total);
    expect(end.distanceM).toBeCloseTo(p.track.totals.distanceM, 0);
    expect(end.elapsedSec).toBeCloseTo(p.track.totals.movingSec, 0);
  });

  it('the drawn route grows from 0 to the whole path', () => {
    expect(frameAt(p, 0).drawnPx).toBe(0);
    expect(frameAt(p, total).drawnPx).toBeCloseTo(p.routeLenPx, 3);
  });

  it('a pin pops when the rider reaches it, its chip fades after a few seconds, and it stays for the overview', () => {
    const def = p.callouts[0]!;
    expect(def).toBeDefined();
    expect(frameAt(p, 0).pins).toHaveLength(0);
    const end = frameAt(p, total);
    expect(end.pins.length).toBe(p.callouts.length);
    expect(end.pins.every((pin) => pin.pop > 0.99 && pin.pop < 1.01)).toBe(true);
    expect(end.pins.every((pin) => pin.chip === 0)).toBe(true);
    // During the run there is a moment with a visible chip.
    let seen = false;
    for (let i = 0; i < 800; i++) {
      const f = frameAt(p, (i / 800) * total);
      if (f.pins.some((pin) => pin.chip > 0.9)) seen = true;
    }
    expect(seen).toBe(true);
  });

  it('shows the counter during the run and the summary card only in the outro', () => {
    const mid = frameAt(p, p.timing.introSec + p.timing.runSec / 2);
    expect(mid.counterAlpha).toBe(1);
    expect(mid.summaryAlpha).toBe(0);
    const end = frameAt(p, total);
    expect(end.counterAlpha).toBe(0);
    expect(end.summaryAlpha).toBe(1);
  });

  it('live readouts follow the rider and the camera keeps the rider on screen', () => {
    for (let i = 0; i <= 100; i++) {
      const f = frameAt(p, p.timing.introSec + (i / 100) * p.timing.runSec);
      expect(f.rider.x).toBeGreaterThan(0);
      expect(f.rider.x).toBeLessThan(VIEW.w);
      expect(f.live.hr === null || f.live.hr > 80).toBe(true);
    }
  });
});

describe('basemap plan', () => {
  const p = plan({ n: 500, speed: 8 });

  it('has coarse to fine levels, the finest at the follow zoom', () => {
    const zs = p.basemap.lods.map((l) => l.z);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
    expect(zs[zs.length - 1]).toBe(Math.floor(p.camera.zoomFollow));
    expect(zs[0]).toBeLessThan(zs[zs.length - 1]!);
    expect(p.basemap.refZoom).toBe(zs[zs.length - 1]!);
  });

  it('stays inside the tile budget', () => {
    expect(p.basemap.total).toBeLessThanOrEqual(MAX_TILES);
    const long = planReplay(syntheticTrack({ n: 700, stepSec: 40, speed: 10 }), { trimM: 200 });
    if ('failure' in long) throw new Error(long.failure);
    expect(long.plan.basemap.total).toBeLessThanOrEqual(MAX_TILES);
  });

  it('a tighter budget lowers the follow zoom', () => {
    const track = syntheticTrack({ n: 600, stepSec: 30, speed: 9 });
    const path = buildRoutePath(track, 200)!;
    const timing = buildTiming(track.totals.elapsedSec);
    const loose = planWithinBudget(path, VIEW, timing, 100000);
    const tight = planWithinBudget(path, VIEW, timing, 40);
    expect(tight.camera.zoomFollow).toBeLessThan(loose.camera.zoomFollow);
    expect(tight.basemap.total).toBeLessThan(loose.basemap.total);
  });

  it('plans every tile the finest level shows while following', () => {
    const fine = p.basemap.lods[p.basemap.lods.length - 1]!;
    const keys = new Set(fine.tiles.map((t) => t.key));
    for (let i = 0; i <= 40; i++) {
      const t = p.timing.introSec + (i / 40) * p.timing.runSec;
      const cam = cameraAt(p.camera, phaseAt(p.timing, t));
      const view = visibleMerc(cam, VIEW, 0);
      const n = 2 ** fine.z;
      // Only tiles that really hit the screen: the planned margin is wider than this.
      for (const [mx, my] of [[view.x0, view.y0], [view.x1, view.y0], [view.x0, view.y1], [view.x1, view.y1], [cam.cx, cam.cy]] as const) {
        expect(keys.has(`${fine.z}/${Math.floor(mx * n)}/${Math.floor(my * n)}`)).toBe(true);
      }
    }
  });

  it('level alpha rises with zoom, 1 for the coarsest', () => {
    const lods = p.basemap.lods;
    expect(lodAlpha(lods, 0, 5)).toBe(1);
    const z = lods[lods.length - 1]!.z;
    expect(lodAlpha(lods, lods.length - 1, z - 2)).toBe(0);
    expect(lodAlpha(lods, lods.length - 1, z)).toBe(1);
    expect(lodAlpha(lods, lods.length - 1, z - 0.65)).toBeGreaterThan(0);
    expect(lodAlpha(lods, lods.length - 1, z - 0.65)).toBeLessThan(1);
  });

  it('level zooms are spaced by at most three', () => {
    expect(lodZooms(14, 9)).toEqual([9, 12, 14]);
    expect(lodZooms(14, 12)).toEqual([12, 14]);
    expect(lodZooms(12, 12)).toEqual([12]);
    expect(lodZooms(10, 12)).toEqual([10]);
  });

  it('visibleLods only returns tiles near the screen and draws the coarse level under a fading fine one', () => {
    const cam = cameraAt(p.camera, phaseAt(p.timing, p.timing.introSec + p.timing.runSec / 2));
    const lods = visibleLods(p.basemap, cam, VIEW);
    expect(lods.length).toBeGreaterThanOrEqual(1);
    const fineTiles = lods[lods.length - 1]!.tiles.length;
    expect(fineTiles).toBeGreaterThan(0);
    expect(fineTiles).toBeLessThan(p.basemap.lods[p.basemap.lods.length - 1]!.tiles.length + 1);
    const outro = cameraAt(p.camera, phaseAt(p.timing, p.timing.totalSec));
    const overview = visibleLods(p.basemap, outro, VIEW);
    expect(overview.map((l) => l.index)).toEqual([0]);
  });

  it('loads coarse levels first and the finest in order of need', () => {
    const order = loadOrder(p.basemap);
    const lodOf = (key: string) => p.basemap.lods.findIndex((l) => l.tiles.some((t) => t.key === key));
    const idx = order.map((t) => lodOf(t.key));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    const fine = order.filter((t) => t.z === p.basemap.lods[p.basemap.lods.length - 1]!.z);
    for (let i = 1; i < fine.length; i++) expect(fine[i]!.need).toBeGreaterThanOrEqual(fine[i - 1]!.need);
  });
});

describe('basemap loading', () => {
  const p = plan({ n: 300 });

  it('fetches every tile once, reports progress, and stores them', async () => {
    const store = new BasemapStore();
    const asked: string[] = [];
    const seen: number[] = [];
    const result = await loadBasemap(p.basemap, { rendered: async (z, x, y) => (asked.push(`${z}/${x}/${y}`), TILE) }, store, { onProgress: (d) => seen.push(d), concurrency: 3 });
    expect(asked).toHaveLength(p.basemap.total);
    expect(new Set(asked).size).toBe(p.basemap.total);
    expect(store.size).toBe(p.basemap.total);
    expect(result).toEqual({ loaded: p.basemap.total, failed: 0, offline: false });
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(p.basemap.total);
  });

  it('a tile that fails is left blank and counted; when every tile fails the device is offline', async () => {
    const store = new BasemapStore();
    const some = await loadBasemap(p.basemap, { rendered: async (_z, x) => (x % 3 === 0 ? Promise.reject(new Error('net')) : TILE) }, store);
    expect(some.failed).toBeGreaterThan(0);
    expect(some.offline).toBe(false);
    expect(store.size).toBe(some.loaded);
    const none = await loadBasemap(p.basemap, { rendered: async () => Promise.reject(new Error('offline')) }, new BasemapStore());
    expect(none).toEqual({ loaded: 0, failed: p.basemap.total, offline: true });
  });

  it('a second load only fetches what is missing', async () => {
    const store = new BasemapStore();
    await loadBasemap(p.basemap, { rendered: async () => TILE }, store);
    let calls = 0;
    const again = await loadBasemap(p.basemap, { rendered: async () => (calls++, TILE) }, store);
    expect(calls).toBe(0);
    expect(again.offline).toBe(false);
  });

  it('stops when aborted', async () => {
    const ctl = new AbortController();
    let calls = 0;
    await loadBasemap(
      p.basemap,
      {
        rendered: async () => {
          if (++calls === 3) ctl.abort();
          return TILE;
        },
      },
      new BasemapStore(),
      { signal: ctl.signal, concurrency: 1 },
    );
    expect(calls).toBeLessThan(p.basemap.total);
  });
});

describe('tile sources', () => {
  it('firstOf falls through failures and empty answers, and reports an all-failure', async () => {
    const empty = { rendered: async () => ({ z: 1, layers: [] }) };
    const boom = { rendered: async () => Promise.reject(new Error('x')) };
    const real = { rendered: async () => TILE };
    expect(await firstOf(boom, empty, real).rendered(1, 0, 0)).toBe(TILE);
    expect((await firstOf(boom, empty).rendered(1, 0, 0)).layers).toEqual([]);
    await expect(firstOf(boom, boom).rendered(1, 0, 0)).rejects.toThrow('x');
  });

  it('a bytes source asks for the zoom-14 ancestor of an overzoomed tile and answers empty for no tile', async () => {
    const asked: string[] = [];
    const src = createBytesTileSource(async (z, x, y) => (asked.push(`${z}/${x}/${y}`), null));
    expect((await src.rendered(16, 4003, 2005)).layers).toEqual([]);
    expect(asked).toEqual(['14/1000/501']);
  });
});

describe('scene builder', () => {
  const store = new BasemapStore();
  const p = plan({ n: 500 });
  for (const lod of p.basemap.lods) for (const tile of lod.tiles) store.set(tile.key, TILE);
  const make = (locale: Locale, mode: 'dark' | 'light', watermark = true, name: string | null = null) =>
    createSceneBuilder({
      plan: p,
      theme: themeFor(mode, 'ride'),
      locale,
      t: (key, a) => String(getT(locale, 'replay')(key as never, a as never)),
      fonts: FIT_FONTS,
      store,
      options: { watermark, name },
      sportLabel: 'Bersepeda',
      brand: { name: FIT_BRAND.name, link: FIT_BRAND.link },
    });

  const svgAt = (build: SceneBuilder, t: number) => replayToSvg(build(frameAt(p, t)), FIT_FONTS);

  it('draws the counter at the start and the finished card at the end', async () => {
    await applyLocale('id');
    const build = make('id', 'dark');
    const start = svgAt(build, 0);
    expect(start).toContain('>0,00<');
    expect(start).toContain('>km<');
    expect(start).toContain('JoyoFit');
    const end = svgAt(build, p.timing.totalSec);
    const km = (p.track.totals.distanceM / 1000).toFixed(2).replace('.', ',');
    expect(end).toContain(`>${km}<`);
    expect(end).toContain('>Jarak<');
    expect(end).toContain('>Kenaikan elevasi<');
    expect(end).toContain('>Waktu<');
    expect(end).toContain('>Bersepeda<');
  });

  it('never emits NaN or undefined, in either theme and language', async () => {
    for (const locale of ['id', 'en'] as const) {
      await applyLocale(locale);
      for (const mode of ['dark', 'light'] as const) {
        const build = make(locale, mode);
        for (const t of [0, 0.5, 3, 12, 25, p.timing.totalSec - 1, p.timing.totalSec]) {
          const svg = svgAt(build, t);
          expect(svg).not.toContain('NaN');
          expect(svg).not.toContain('undefined');
          expect(svg.startsWith('<svg')).toBe(true);
        }
      }
    }
    await applyLocale('id');
  });

  it('English uses its own number format and words', async () => {
    await applyLocale('en');
    const svg = svgAt(make('en', 'dark'), p.timing.totalSec);
    expect(svg).toContain('>Distance<');
    expect(svg).toContain('>Elevation gain<');
    expect(svg).toMatch(/>\d+\.\d\d</);
    await applyLocale('id');
  });

  it('the watermark and the name follow the options', async () => {
    await applyLocale('id');
    expect(svgAt(make('id', 'dark', false), 0)).not.toContain('JoyoFit');
    expect(svgAt(make('id', 'dark', true), 0)).toContain('fit.joyorogo.com');
    expect(svgAt(make('id', 'dark', true, null), p.timing.totalSec)).not.toContain('Dzul');
    expect(svgAt(make('id', 'dark', true, 'Dzul'), p.timing.totalSec)).toContain('Dzul');
  });

  it('shows a chip with the value while a pin is fresh', async () => {
    await applyLocale('id');
    const build = make('id', 'dark');
    let found = '';
    for (let i = 0; i < 400 && !found; i++) {
      const f = frameAt(p, (i / 400) * p.timing.totalSec);
      if (f.pins.some((pin) => pin.chip > 0.95 && pin.def.kind === 'maxHr')) found = replayToSvg(build(f), FIT_FONTS);
    }
    expect(found).toContain('>bpm<');
    expect(found).toContain(`>${Math.max(...(p.track.hr as number[]))}<`);
  });

  it('reuses tile groups between frames (the painter skips them)', () => {
    const build = make('id', 'dark');
    const tilesOf = (t: number) => {
      const scene = build(frameAt(p, t));
      const map = scene.nodes.find((n) => n.k === 'mgroup' && n.id === 'map');
      if (!map || map.k !== 'mgroup') throw new Error('no map');
      return map.children.filter((c) => c.k === 'mgroup').flatMap((lod) => (lod.k === 'mgroup' ? lod.children : []));
    };
    const a = tilesOf(10);
    const b = tilesOf(10.2);
    const shared = a.filter((n) => b.includes(n));
    expect(a.length).toBeGreaterThan(0);
    expect(shared.length).toBeGreaterThan(a.length / 2);
  });

  it('always emits the same number of top-level slots, so a keyed painter never remounts', () => {
    const build = make('id', 'dark');
    const counts = new Set([0, 1, 5, 12, 20, 30, p.timing.totalSec].map((t) => build(frameAt(p, t)).nodes.length));
    expect(counts.size).toBe(1);
  });

  it('works without any tile (the offline card)', () => {
    const empty = createSceneBuilder({
      plan: p,
      theme: themeFor('dark', 'ride'),
      locale: 'id',
      t: (key, a) => String(getT('id', 'replay')(key as never, a as never)),
      fonts: FIT_FONTS,
      store: new BasemapStore(),
      options: { watermark: true, name: null },
      sportLabel: 'Bersepeda',
      brand: { name: FIT_BRAND.name, link: FIT_BRAND.link },
    });
    const svg = replayToSvg(empty(frameAt(p, 14)), FIT_FONTS);
    expect(svg).toContain('stroke-dasharray');
    expect(svg).not.toContain('NaN');
  });

  it('the terrain silhouette is deterministic per seed and different between workouts', () => {
    expect(ridgePath(7, 0, 1080, 300, 100, 500)).toBe(ridgePath(7, 0, 1080, 300, 100, 500));
    expect(ridgePath(7, 0, 1080, 300, 100, 500)).not.toBe(ridgePath(8, 0, 1080, 300, 100, 500));
    expect(ridgePath(7, 0, 1080, 300, 100, 500)).not.toBe(ridgePath(7, 1, 1080, 300, 100, 500));
  });
});

describe('camera plan reuse', () => {
  it('planBasemap is deterministic for a camera plan', () => {
    const track = syntheticTrack({ n: 300 });
    const path = buildRoutePath(track, 200)!;
    const cam = planCamera(path);
    const timing = buildTiming(track.totals.elapsedSec);
    expect(planBasemap(cam, timing)).toEqual(planBasemap(cam, timing));
  });
});

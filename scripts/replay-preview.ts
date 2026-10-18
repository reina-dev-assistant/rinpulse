// Renders a workout replay headless: PNG frames and an MP4 preview from a real FIT file, with the app's own planner, camera,
// tile pipeline and scene builder (only the painter differs: SVG string -> sharp instead of react-native-svg).
//
//   bun scripts/replay-preview.ts --fit FILE [--out DIR] [--frames 5] [--mp4] [--fps 30] [--width 540]
//        [--mode dark|light] [--locale id|en] [--trim 200] [--offline] [--speed 1] [--name OUTPUT_PREFIX]
//
// Needs `node` (sharp's SVG text path hangs under Bun) and, for --mp4, the system `ffmpeg` (previews only: the app encodes
// with its native MediaCodec / AVAssetWriter module). Tiles come from OpenFreeMap through the app's tile source and are cached
// on disk (REPLAY_TILE_CACHE, default $TMPDIR/replay-tiles), so a second run needs no network. --offline draws the plain card.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { createTileSource } from '../src/features/map/tileCache';
import { parseFitActivity } from '../src/features/fitimport/parseFit';
import { applyLocale, getT, type Locale } from '../src/i18n';
import { BasemapStore, loadBasemap } from '../src/features/replay/basemap';
import { createSceneBuilder } from '../src/features/replay/build';
import { replayToSvg } from '../src/features/replay/emitSvg';
import { frameAt } from '../src/features/replay/frame';
import { planReplay } from '../src/features/replay/plan';
import { exportFrameCount, frameTime } from '../src/features/replay/scheduler';
import { themeFor } from '../src/features/replay/theme';
import { timeOfProgress } from '../src/features/replay/timing';
import { trackFromAnalysis } from '../src/features/replay/track';
import { FIT_BRAND } from '../src/features/stickers/brand';
import { rasterize, GOLDEN_FONTS, type RasterJob } from '../src/features/stickers/testing/render';
import { analyzeWorkout } from '../src/features/workouts/analysis/analyze';
import { workoutRow } from '../src/features/workouts/analysis/fixtures';
import { sportLabel } from '../src/features/workouts/sportLabel';

const args = process.argv.slice(2);
const opt = (name: string, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const flag = (name: string) => args.includes(`--${name}`);

const fit = opt('fit');
if (!fit) throw new Error('usage: bun scripts/replay-preview.ts --fit FILE [--out DIR] [--frames N] [--mp4]');
const out = opt('out', '/run/media/dzul/ioswork/replay/out');
const nFrames = Number(opt('frames', '5'));
const fps = Number(opt('fps', '30'));
const width = Number(opt('width', '540'));
const mode = opt('mode', 'dark') as 'dark' | 'light';
const locale = opt('locale', 'id') as Locale;
const trimM = Number(opt('trim', '200'));
const speed = Number(opt('speed', '1'));
const tmp = join(process.env.TMPDIR ?? '/tmp', 'replay-preview');
const cacheDir = process.env.REPLAY_TILE_CACHE ?? join(process.env.TMPDIR ?? '/tmp', 'replay-tiles');
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(cacheDir, { recursive: true });
await applyLocale(locale);

// ---- the workout --------------------------------------------------------------------------------------------------
const activity = parseFitActivity(new Uint8Array(readFileSync(fit)));
if ('ok' in activity) throw new Error(`${fit}: ${activity.message}`);
const analysis = analyzeWorkout(
  {
    workout: workoutRow({
      start: activity.start,
      end: activity.end,
      duration: activity.timerSeconds,
      distance: activity.distance,
      calories: activity.calories,
      sportType: activity.sport.type,
      sportName: activity.name,
    }),
    summary: { kind: activity.sport.kind, laps: activity.laps, elevationGain: activity.ascent ?? undefined, elevationLoss: activity.descent ?? undefined, ascentSource: 'device' },
    points: activity.points.map((p) => ({ ...p, id: 0, workoutId: 1 })) as never,
    maxHr: 185,
    daySamples: [],
    history: { efforts: [], trims: [], trimps: [], similar: [] } as never,
  },
  { includeHr: true, includeRoute: true, includeComparison: false },
);
const track = trackFromAnalysis(analysis);
if (!track) throw new Error('no GPS track in this file');
const planned = planReplay(track, { trimM });
if ('failure' in planned) throw new Error(`cannot replay: ${planned.failure}`);
const { plan } = planned;
console.log(`${activity.name}: ${(track.totals.distanceM / 1000).toFixed(1)} km, ${Math.round(track.totals.elapsedSec / 60)} min -> replay ${plan.timing.totalSec} s, follow zoom ${plan.camera.zoomFollow.toFixed(1)}, ${plan.basemap.total} tiles in ${plan.basemap.lods.length} levels (z ${plan.basemap.lods.map((l) => l.z).join('/')}), pins: ${plan.callouts.map((c) => c.kind).join(', ') || 'none'}`);

// ---- tiles (disk cached) -------------------------------------------------------------------------------------------
const store = new BasemapStore();
if (!flag('offline')) {
  const cachedFetch = (async (input: string, init?: RequestInit) => {
    const file = join(cacheDir, createHash('sha1').update(String(input)).digest('hex'));
    if (existsSync(`${file}.none`)) return new Response(null, { status: Number(readFileSync(`${file}.none`, 'utf8')) });
    if (existsSync(file)) return new Response(new Uint8Array(readFileSync(file)));
    const res = await fetch(input, init);
    const body = new Uint8Array(await res.arrayBuffer());
    if (res.status === 204 || res.status === 404) writeFileSync(`${file}.none`, String(res.status));
    else if (res.ok) writeFileSync(file, body);
    return new Response(res.status === 204 || res.status === 404 ? null : body, { status: res.status });
  }) as typeof fetch;
  const source = createTileSource({ fetchImpl: cachedFetch, renderedCapacity: 4 });
  const result = await loadBasemap(plan.basemap, source, store, {
    onProgress: (done, total) => process.stdout.write(`\r  tiles ${done}/${total}`),
    timeoutMs: 30000,
  });
  process.stdout.write('\n');
  console.log(`  loaded ${result.loaded}, failed ${result.failed}${result.offline ? ' (offline: plain card)' : ''}`);
}

// ---- frames -------------------------------------------------------------------------------------------------------
const build = createSceneBuilder({
  plan,
  theme: themeFor(mode, track.kind),
  locale,
  t: (key, a) => String(getT(locale, 'replay')(key as never, a as never)),
  fonts: GOLDEN_FONTS,
  store,
  options: { watermark: true, name: null },
  sportLabel: sportLabel(activity.name),
  brand: FIT_BRAND,
});

function renderJobs(times: { name: string; t: number }[], dir: string, pxWidth: number): RasterJob[] {
  mkdirSync(dir, { recursive: true });
  return times.map(({ name, t }) => {
    const svg = join(tmp, `${name}.svg`);
    writeFileSync(svg, replayToSvg(build(frameAt(plan, t)), GOLDEN_FONTS));
    return { svg, png: join(dir, `${name}.png`), width: pxWidth };
  });
}

const timing = plan.timing;
// The first frame, the middle ones evenly through the route (10 % to 90 %), then the summary card.
const count = Math.max(2, nFrames);
const stills = Array.from({ length: count }, (_, i) => {
  if (i === 0) return 0;
  if (i === count - 1) return timing.totalSec;
  return timeOfProgress(timing, count <= 3 ? 0.5 : 0.1 + (0.8 * (i - 1)) / (count - 3));
})
  .map((t, i) => ({ name: `frame-${String(i + 1).padStart(2, '0')}`, t }));
const base = opt('name', `${basename(fit, '.fit').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-${mode}-${locale}`);
const stillJobs = renderJobs(stills.map((s) => ({ name: `${base}-${s.name}`, t: s.t })), out, 1080);
await rasterize(tmp, stillJobs);
console.log(`  wrote ${stillJobs.length} stills to ${out}`);

if (flag('mp4')) {
  const dir = join(tmp, 'seq');
  rmSync(dir, { recursive: true, force: true });
  const count = exportFrameCount(timing.totalSec, speed, fps);
  const unique = new Map<number, string>();
  const jobs: RasterJob[] = [];
  const names: string[] = [];
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    const t = frameTime(i, timing.totalSec, speed, fps);
    let name = unique.get(t);
    if (!name) {
      name = `${String(i).padStart(5, '0')}`;
      unique.set(t, name);
      const svg = join(tmp, `seq-${name}.svg`);
      writeFileSync(svg, replayToSvg(build(frameAt(plan, t)), GOLDEN_FONTS));
      jobs.push({ svg, png: join(dir, `${name}.png`), width });
    }
    names.push(name);
  }
  console.log(`  rasterising ${jobs.length} unique frames of ${count} at ${width} px ...`);
  await rasterize(tmp, jobs);
  names.forEach((name, i) => {
    const target = join(dir, `${String(i).padStart(5, '0')}.png`);
    if (name !== String(i).padStart(5, '0')) writeFileSync(target, readFileSync(join(dir, `${name}.png`)));
  });
  const mp4 = join(out, `${base}.mp4`);
  const run = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, '%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
  if (run.status !== 0) throw new Error('ffmpeg failed');
  console.log(`  wrote ${mp4}`);
}

import { describe, expect, it } from 'bun:test';

import {
  FOLLOW_SQUASH,
  MAX_FOLLOW_ZOOM,
  MIN_FOLLOW_ZOOM,
  VIEW,
  cameraAt,
  followZoomFor,
  mapMatrix,
  planCamera,
  project,
  visibleMerc,
  worldPx,
} from './camera';
import { syntheticTrack } from './replayFixtures';
import { buildRoutePath, pointAt } from './route';
import { buildTiming, phaseAt } from './timing';

const track = syntheticTrack({ n: 500, kind: 'ride' });
const path = buildRoutePath(track, 200)!;
const timing = buildTiming(track.totals.elapsedSec);
const plan = planCamera(path);

function sample(fps = 30) {
  const frames = Math.ceil(timing.totalSec * fps);
  return Array.from({ length: frames + 1 }, (_, i) => {
    const t = Math.min(timing.totalSec, i / fps);
    const pos = phaseAt(timing, t);
    return { t, pos, cam: cameraAt(plan, pos) };
  });
}

describe('camera path sampling', () => {
  const frames = sample();

  it('keeps the rider on screen for the whole run', () => {
    for (const { pos, cam } of frames) {
      if (pos.phase !== 'run') continue;
      const at = pointAt(path, pos.p * path.lengthM);
      const s = project(cam, VIEW, at.mx, at.my);
      expect(s.x).toBeGreaterThan(120);
      expect(s.x).toBeLessThan(VIEW.w - 120);
      expect(s.y).toBeGreaterThan(300);
      expect(s.y).toBeLessThan(VIEW.h * 0.75);
    }
  });

  it('moves smoothly: no frame-to-frame jump of the centre bigger than a few dozen px, including at the phase borders', () => {
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1]!.cam;
      const b = frames[i]!.cam;
      const w = worldPx(Math.min(a.zoom, b.zoom));
      const jump = Math.hypot((b.cx - a.cx) * w, (b.cy - a.cy) * w);
      expect(jump).toBeLessThan(90);
      expect(Math.abs(b.zoom - a.zoom)).toBeLessThan(0.12);
    }
  });

  it('follows at a constant zoom and tilt, zooms in during the intro and out in the outro', () => {
    const run = frames.filter((f) => f.pos.phase === 'run');
    expect(new Set(run.map((f) => f.cam.zoom)).size).toBe(1);
    expect(run[0]!.cam.squash).toBe(FOLLOW_SQUASH);
    expect(frames[0]!.cam.zoom).toBeGreaterThan(run[0]!.cam.zoom + 0.5);
    const last = frames[frames.length - 1]!.cam;
    expect(last.zoom).toBeLessThan(run[0]!.cam.zoom - 1);
    expect(last.squash).toBe(1);
  });

  it('ends on a flat overview with the whole route inside the frame', () => {
    const last = frames[frames.length - 1]!.cam;
    for (let k = 0; k < path.mx.length; k += 7) {
      const s = project(last, VIEW, path.mx[k]!, path.my[k]!);
      expect(s.x).toBeGreaterThan(40);
      expect(s.x).toBeLessThan(VIEW.w - 40);
      expect(s.y).toBeGreaterThan(120);
      expect(s.y).toBeLessThan(VIEW.h * 0.62);
    }
  });

  it('is a pure function of the timeline position', () => {
    const pos = phaseAt(timing, 7.3);
    expect(cameraAt(plan, pos)).toEqual(cameraAt(plan, pos));
    expect(cameraAt(planCamera(path), pos)).toEqual(cameraAt(plan, pos));
  });

  it('looks ahead: the centre leads the rider along the direction of travel', () => {
    const mid = phaseAt(timing, timing.introSec + timing.runSec * 0.5);
    const cam = cameraAt(plan, mid);
    const rider = pointAt(path, mid.p * path.lengthM);
    const ahead = pointAt(path, mid.p * path.lengthM + 200);
    const toAhead = [ahead.mx - rider.mx, ahead.my - rider.my];
    const toCentre = [cam.cx - rider.mx, cam.cy - rider.my];
    expect(toAhead[0]! * toCentre[0]! + toAhead[1]! * toCentre[1]!).toBeGreaterThan(0);
  });
});

describe('follow zoom', () => {
  it('stays inside the bounds and is lower for a long ride than for a short one', () => {
    const short = buildRoutePath(syntheticTrack({ n: 120, speed: 3 }), 0)!;
    const long = buildRoutePath(syntheticTrack({ n: 700, stepSec: 30, speed: 9 }), 0)!;
    const zs = followZoomFor(short, VIEW);
    const zl = followZoomFor(long, VIEW);
    expect(zs).toBeGreaterThan(zl);
    for (const z of [zs, zl]) {
      expect(z).toBeGreaterThanOrEqual(MIN_FOLLOW_ZOOM);
      expect(z).toBeLessThanOrEqual(MAX_FOLLOW_ZOOM);
    }
  });
});

describe('projection', () => {
  const cam = { cx: 0.5, cy: 0.5, zoom: 12, squash: 0.7, ay: 1000 };

  it('puts the centre at (w/2, ay)', () => {
    expect(project(cam, VIEW, 0.5, 0.5)).toEqual({ x: VIEW.w / 2, y: 1000 });
  });

  it('squashes the vertical axis only', () => {
    const w = worldPx(12);
    const s = project(cam, VIEW, 0.5 + 100 / w, 0.5 + 100 / w);
    expect(s.x - VIEW.w / 2).toBeCloseTo(100, 6);
    expect(s.y - 1000).toBeCloseTo(70, 6);
  });

  it('the map matrix agrees with project for a local point', () => {
    const refZoom = 14;
    const ox = 0.5003;
    const oy = 0.4998;
    const m = mapMatrix(cam, VIEW, refZoom, ox, oy);
    const px = { x: 123, y: -45 };
    const mx = ox + px.x / worldPx(refZoom);
    const my = oy + px.y / worldPx(refZoom);
    const p = project(cam, VIEW, mx, my);
    expect(m.tx + px.x * m.sx).toBeCloseTo(p.x, 6);
    expect(m.ty + px.y * m.sy).toBeCloseTo(p.y, 6);
  });

  it('visibleMerc brackets the screen corners', () => {
    const v = visibleMerc(cam, VIEW, 0);
    const tl = project(cam, VIEW, v.x0, v.y0);
    const br = project(cam, VIEW, v.x1, v.y1);
    expect(tl.x).toBeCloseTo(0, 6);
    expect(tl.y).toBeCloseTo(0, 6);
    expect(br.x).toBeCloseTo(VIEW.w, 6);
    expect(br.y).toBeCloseTo(VIEW.h, 6);
  });
});

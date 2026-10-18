import { describe, expect, test } from 'bun:test';

import { RouteFollower } from './follower';
import { at, polyline } from './testRoutes';

const route = polyline([[0, 0], [1000, 0], [1000, -1000]], 10);

function fix(ts: number, x: number, y: number, speed: number | null = 5, accuracy: number | null = 5) {
  const p = at(x, y);
  return { ts, lat: p.lat, lon: p.lon, speedMps: speed, accuracy };
}

describe('RouteFollower', () => {
  test('snapshot is null until the first fix; progress and cue', () => {
    const f = new RouteFollower('r1', route);
    expect(f.snapshot()).toBeNull();
    expect(f.routeLengthM).toBeGreaterThan(1990);
    const s = f.update(fix(0, 300, 4), 0);
    expect(f.snapshot()).toBe(s);
    expect(s.routeId).toBe('r1');
    expect(s.distanceDoneM).toBeCloseTo(300, 0);
    expect(s.distanceToFinishM).toBeCloseTo(f.routeLengthM - 300, 0);
    expect(s.offCourse).toBe(false);
    expect(s.offCourseM).toBeCloseTo(4, 0);
    expect(s.nextCue?.cue.kind).toBe('right');
    expect(s.nextCue?.distanceM).toBeGreaterThan(680);
    expect(s.nextCue?.distanceM).toBeLessThan(720);
    expect(s.climb).toBeNull();
  });

  test('a fresh follower works anywhere (restore)', () => {
    const f = new RouteFollower('r1', route);
    const s = f.update(fix(0, 1000, -600), 0);
    expect(s.distanceDoneM).toBeCloseTo(1600, 0);
    expect(s.nextCue?.cue.kind).toBe('finish');
  });

  test('null at the finish', () => {
    const f = new RouteFollower('r1', route);
    const s = f.update(fix(0, 1000, -1000), 0);
    expect(s.distanceToFinishM).toBeLessThan(1);
    expect(s.nextCue).toBeNull();
  });

  test('ETA from the average speed of the last 30 s', () => {
    const f = new RouteFollower('r1', route);
    // slow for 30 s, then fast: only the last 30 s count
    for (let i = 0; i < 30; i++) f.update(fix(i * 1000, 100 + i, 0, 1.5), i * 1000);
    for (let i = 30; i < 70; i++) f.update(fix(i * 1000, 130 + (i - 30) * 8, 0, 8), i * 1000);
    const s = f.snapshot()!;
    expect(s.etaSec).toBeCloseTo(s.distanceToFinishM / 8, 0);
  });

  test('no ETA when standing still; speed derived from fixes without speedMps', () => {
    const f = new RouteFollower('r1', route);
    expect(f.update(fix(0, 100, 0, 0), 0).etaSec).toBeNull();
    const g = new RouteFollower('r1', route);
    g.update(fix(0, 100, 0, null), 0);
    const s = g.update(fix(1000, 106, 0, null), 1000);
    expect(s.etaSec).toBeCloseTo(s.distanceToFinishM / 6, 0);
  });

  test('inaccurate fixes are not matched but time still passes', () => {
    const f = new RouteFollower('r1', route, { offCourseDwellMs: 10_000 });
    f.update(fix(0, 100, 0), 0);
    f.update(fix(1000, 100, 80), 1000); // off by 80 m: starts the dwell
    const s = f.update(fix(12_000, 500, 0, 5, 50), 12_000); // poor fix: ignored, but the dwell has elapsed
    expect(s.distanceDoneM).toBeCloseTo(100, 0);
    expect(s.offCourse).toBe(true);
  });

  test('off course after the dwell, frozen, no cue; clears below 0.6 of the threshold', () => {
    const f = new RouteFollower('r1', route);
    f.update(fix(0, 400, 0), 0);
    let s = f.update(fix(1000, 410, 70), 1000);
    expect(s.offCourse).toBe(false);
    expect(s.nextCue).not.toBeNull();
    s = f.update(fix(5000, 600, 70), 5000);
    expect(s.offCourse).toBe(false);
    s = f.update(fix(11_000, 700, 70), 11_000);
    expect(s.offCourse).toBe(true);
    expect(s.nextCue).toBeNull();
    expect(s.distanceDoneM).toBeCloseTo(400, 0);
    // 40 m: under the 50 m threshold but over 30 m: still off course
    s = f.update(fix(12_000, 700, 40), 12_000);
    expect(s.offCourse).toBe(true);
    expect(s.distanceDoneM).toBeCloseTo(400, 0);
    s = f.update(fix(13_000, 700, 20), 13_000);
    expect(s.offCourse).toBe(false);
    expect(s.distanceDoneM).toBeCloseTo(700, 0);
    expect(s.nextCue).not.toBeNull();
  });

  test('a short excursion resets the dwell', () => {
    const f = new RouteFollower('r1', route);
    f.update(fix(0, 400, 0), 0);
    f.update(fix(1000, 410, 70), 1000);
    f.update(fix(5000, 420, 5), 5000);
    const s = f.update(fix(12_000, 430, 70), 12_000);
    expect(s.offCourse).toBe(false);
  });

  test('threshold can change', () => {
    const f = new RouteFollower('r1', route, { offCourseM: 50, offCourseDwellMs: 0 });
    f.setOffCourseThreshold(200);
    expect(f.update(fix(0, 400, 120), 0).offCourse).toBe(false);
    f.setOffCourseThreshold(100);
    expect(f.update(fix(1000, 400, 120), 1000).offCourse).toBe(true);
  });

  test('climb ahead appears in the snapshot', () => {
    const pts = polyline([[0, 0], [3000, 0]], 10).map((p, i) => ({ ...p, alt: i < 100 ? 100 : 100 + (i - 100) * 0.6 }));
    const f = new RouteFollower('c', pts);
    const s = f.update(fix(0, 200, 0), 0);
    expect(s.climb).not.toBeNull();
    expect(s.climb!.inProgress).toBe(false);
    expect(s.climb!.startsInM).toBeGreaterThan(700);
    expect(f.update(fix(1000, 1500, 0), 1000).climb!.inProgress).toBe(true);
  });

  test('figure-eight route keeps the pass it is on', () => {
    const eight = polyline([[0, 0], [1000, 0], [1000, 500], [500, 500], [500, -500], [0, -500]], 10);
    const f = new RouteFollower('e', eight);
    f.update(fix(0, 480, 0), 0);
    let s = f.update(fix(1000, 500, 0), 1000);
    expect(s.distanceDoneM).toBeCloseTo(500, -1);
    s = f.update(fix(2000, 1000, 100), 2000);
    // ride on to the second pass of the crossing
    for (const [x, y, t] of [[1000, 400, 3000], [700, 500, 4000], [500, 300, 5000], [500, 100, 6000], [500, 0, 7000]] as const) {
      s = f.update(fix(t, x, y), t);
    }
    expect(s.distanceDoneM).toBeGreaterThan(2000);
  });
});

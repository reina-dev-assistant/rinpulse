import { describe, expect, test } from 'bun:test';

import { buildRouteIndex, project } from './routeIndex';
import { at, polyline } from './testRoutes';

describe('buildRouteIndex', () => {
  test('cumulative distances and total', () => {
    const idx = buildRouteIndex(polyline([[0, 0], [1000, 0]], 100));
    expect(idx.cumM[0]).toBe(0);
    expect(idx.totalM).toBeGreaterThan(995);
    expect(idx.totalM).toBeLessThan(1005);
    expect(idx.cumM.length).toBe(11);
  });

  test('empty route throws', () => {
    expect(() => buildRouteIndex([])).toThrow();
  });
});

describe('project', () => {
  const straight = buildRouteIndex(polyline([[0, 0], [2000, 0]], 20));

  test('on the line and beside it', () => {
    const p = at(500, 0);
    const r = project(straight, p.lat, p.lon);
    expect(r.atM).toBeCloseTo(500, 0);
    expect(r.offM).toBeLessThan(0.5);
    const q = at(500, 30);
    const r2 = project(straight, q.lat, q.lon);
    expect(r2.atM).toBeCloseTo(500, 0);
    expect(r2.offM).toBeCloseTo(30, 0);
    expect(r2.lat).toBeCloseTo(at(500, 0).lat, 6);
  });

  test('clamps beyond the ends', () => {
    const p = at(-50, 0);
    const r = project(straight, p.lat, p.lon);
    expect(r.atM).toBe(0);
    expect(r.offM).toBeCloseTo(50, 0);
    const q = at(2100, 0);
    expect(project(straight, q.lat, q.lon).atM).toBeCloseTo(straight.totalM, 0);
  });

  test('far fix searches globally even with a hint', () => {
    const p = at(1800, 20);
    const r = project(straight, p.lat, p.lon, { atM: 100, windowM: 1500 });
    expect(r.atM).toBeCloseTo(1800, 0);
  });

  test('window is forward biased: a fix 80 m behind the hint is still matched there', () => {
    const p = at(420, 5);
    const r = project(straight, p.lat, p.lon, { atM: 500, windowM: 1500 });
    expect(r.atM).toBeCloseTo(420, 0);
  });

  test('figure-eight: the pass nearest to the hint wins at the crossing', () => {
    // Out east, loop north and back west across the start of the loop, then south: crosses itself at (500, 0).
    const route = polyline([[0, 0], [1000, 0], [1000, 500], [500, 500], [500, -500], [0, -500]], 10);
    const idx = buildRouteIndex(route);
    const first = project(idx, at(500, 0).lat, at(500, 0).lon, { atM: 480, windowM: 1500 });
    expect(first.atM).toBeCloseTo(500, -1);
    const second = project(idx, at(500, 0).lat, at(500, 0).lon, { atM: 2480, windowM: 1500 });
    expect(second.atM).toBeGreaterThan(2490);
    expect(second.atM).toBeLessThan(2510);
    // Without a hint either is allowed, but the result is on the route.
    expect(project(idx, at(500, 0).lat, at(500, 0).lon).offM).toBeLessThan(1);
  });

  test('duplicate points do not break the projection', () => {
    const pts = [at(0, 0), at(0, 0), at(0, 0), at(100, 0), at(100, 0), at(200, 0)];
    const idx = buildRouteIndex(pts);
    const q = at(150, 10);
    const r = project(idx, q.lat, q.lon);
    expect(r.atM).toBeCloseTo(150, 0);
    expect(r.offM).toBeCloseTo(10, 0);
    expect(Number.isFinite(r.lat)).toBe(true);
  });

  test('very short routes', () => {
    const one = buildRouteIndex([at(0, 0)]);
    const r = project(one, at(3, 4).lat, at(3, 4).lon);
    expect(r.atM).toBe(0);
    expect(r.offM).toBeCloseTo(5, 0);
    const two = buildRouteIndex([at(0, 0), at(10, 0)]);
    expect(project(two, at(7, 1).lat, at(7, 1).lon).atM).toBeCloseTo(7, 0);
  });

  test('loop with start == end', () => {
    const loop = polyline([[0, 0], [500, 0], [500, 500], [0, 500], [0, 0]], 10);
    const idx = buildRouteIndex(loop);
    const nearStart = at(0, 3);
    // Beginning of the ride, hint at the start: matches the start, not the finish.
    expect(project(idx, nearStart.lat, nearStart.lon, { atM: 0, windowM: 1500 }).atM).toBeLessThan(10);
    expect(project(idx, at(0, -3).lat, at(0, -3).lon, { atM: 5, windowM: 1500 }).atM).toBeLessThan(10);
    // Near the end of the ride the same place is the finish.
    const end = project(idx, at(0, 2).lat, at(0, 2).lon, { atM: idx.totalM - 20, windowM: 1500 });
    expect(end.atM).toBeGreaterThan(idx.totalM - 10);
  });

  test('5000 points project fast', () => {
    const corners: [number, number][] = [];
    for (let i = 0; i < 5000; i++) corners.push([i * 10, Math.sin(i / 50) * 300]);
    const idx = buildRouteIndex(corners.map(([x, y]) => at(x, y)));
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      const q = at((i * 37) % 49000, 20);
      project(idx, q.lat, q.lon);
    }
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

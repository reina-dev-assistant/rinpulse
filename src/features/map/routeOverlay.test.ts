import { describe, expect, test } from 'bun:test';

import { KM_STEPS, MAX_KM_PILLS, pickKmPills, routePath, type FixedBox, type KmCandidate } from './routeOverlay';
import { boundsOf, fitBounds, lonLatToWorld, type LatLon } from './tileMath';

const M_PER_DEG = 111_195;

/**
 * A 12 h ride at 1 Hz: 157 km out along a bending road and back by a slightly different line, 44 100 points, with GPS jitter
 * of about a metre. The ends of the line are 0 km and 157 km; `kmAt` holds the position of each whole kilometre.
 */
function longRide() {
  const points: LatLon[] = [];
  const total = 44_100;
  let seed = 7;
  const noise = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return (seed / 4_294_967_296 - 0.5) * 2;
  };
  for (let i = 0; i < total; i++) {
    const f = i / (total - 1);
    const out = f < 0.5;
    const u = out ? f * 2 : (1 - f) * 2; // 0..1 along the out leg
    const side = out ? 0 : 0.012;
    const lat = -7.3 + u * 0.34 + 0.03 * Math.sin(u * 5) + side;
    const lon = 110.2 + u * 0.52 + 0.04 * Math.sin(u * 7) + side;
    points.push([lat + noise() * 0.000001, lon + noise() * 0.000001]);
  }
  const kmAt: { km: number; pos: LatLon }[] = [];
  let acc = 0;
  let next = 1;
  for (let i = 1; i < points.length; i++) {
    const [la0, lo0] = points[i - 1];
    const [la1, lo1] = points[i];
    acc += Math.hypot((la1 - la0) * M_PER_DEG, (lo1 - lo0) * M_PER_DEG * Math.cos((la1 * Math.PI) / 180));
    while (acc >= next * 1000) {
      kmAt.push({ km: next, pos: points[i] });
      next += 1;
    }
  }
  return { points, kmAt, km: acc / 1000 };
}

const ride = longRide();
const WIDTH = 330;
const HEIGHT = 260;

/** The camera of the workout card: the whole route fitted with the TileMap's padding. */
const fitView = fitBounds(boundsOf([ride.points])!, WIDTH, HEIGHT, 48);

function screenOf(view: { lat: number; lon: number; zoom: number }, p: LatLon) {
  const c = lonLatToWorld(view.lat, view.lon, view.zoom);
  const w = lonLatToWorld(p[0], p[1], view.zoom);
  return { x: w.x - (c.x - WIDTH / 2), y: w.y - (c.y - HEIGHT / 2) };
}

const pill = (km: number, p: { x: number; y: number }): KmCandidate => ({ km, x: p.x, y: p.y, w: 24, h: 18 });

describe('long synthetic ride fixture', () => {
  test('is the ride the screenshot showed: about 157 km in 44k points', () => {
    expect(ride.points.length).toBe(44_100);
    expect(ride.km).toBeGreaterThan(140);
    expect(ride.km).toBeLessThan(175);
    expect(ride.kmAt.length).toBe(Math.floor(ride.km));
  });
});

describe('routePath', () => {
  test('a 44k-point ride becomes a few dozen vertices at the fitted zoom, ends kept', () => {
    const c = lonLatToWorld(fitView.lat, fitView.lon, fitView.zoom);
    const ox = c.x - WIDTH / 2;
    const oy = c.y - HEIGHT / 2;
    const d = routePath(ride.points, fitView.zoom, ox, oy)!;
    const vertices = d.split(/[ML]/).length - 1;
    expect(vertices).toBeGreaterThan(10);
    expect(vertices).toBeLessThan(600);
    const xy = d.match(/-?\d+\.\d/g)!.map(Number);
    const first = lonLatToWorld(ride.points[0][0], ride.points[0][1], fitView.zoom);
    const last = lonLatToWorld(ride.points.at(-1)![0], ride.points.at(-1)![1], fitView.zoom);
    // The last vertex may sit under half a pixel short of the final fix: points closer than that are merged first.
    expect(Math.hypot(xy[0] - (first.x - ox), xy[1] - (first.y - oy))).toBeLessThan(0.5);
    expect(Math.hypot(xy.at(-2)! - (last.x - ox), xy.at(-1)! - (last.y - oy))).toBeLessThan(0.5);
  });

  test('stays inside the card at the fitted zoom, so the line is on screen', () => {
    const c = lonLatToWorld(fitView.lat, fitView.lon, fitView.zoom);
    const d = routePath(ride.points, fitView.zoom, c.x - WIDTH / 2, c.y - HEIGHT / 2)!;
    const xy = d.match(/-?\d+\.\d/g)!.map(Number);
    for (let i = 0; i < xy.length; i += 2) {
      expect(xy[i]).toBeGreaterThanOrEqual(0);
      expect(xy[i]).toBeLessThanOrEqual(WIDTH);
      expect(xy[i + 1]).toBeGreaterThanOrEqual(0);
      expect(xy[i + 1]).toBeLessThanOrEqual(HEIGHT);
    }
  });

  test('a one-point or non-finite segment gives no path', () => {
    expect(routePath([[1, 1]], 10, 0, 0)).toBeNull();
    expect(routePath([[Number.NaN, 1], [2, 2]], 10, 0, 0)).toBeNull();
  });
});

describe('pickKmPills', () => {
  const start: FixedBox = { ...screenOf(fitView, ride.points[0]), w: 16, h: 16 };
  const finish: FixedBox = { ...screenOf(fitView, ride.points.at(-1)!), w: 20, h: 20 };

  test('157 pills (the screenshot) become a handful, none overlapping each other or the start / finish', () => {
    const all = ride.kmAt.map((m) => pill(m.km, screenOf(fitView, m.pos)));
    const kept = pickKmPills(all, [start, finish]);
    expect(kept.length).toBeGreaterThanOrEqual(3);
    expect(kept.length).toBeLessThanOrEqual(MAX_KM_PILLS);
    const boxes = all.filter((c) => kept.includes(c.km));
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b) continue;
        expect(Math.abs(a.x - b.x) >= 24 + 4 || Math.abs(a.y - b.y) >= 18 + 4).toBe(true);
      }
      for (const f of [start, finish]) {
        expect(Math.abs(a.x - f.x) >= (24 + f.w) / 2 || Math.abs(a.y - f.y) >= (18 + f.h) / 2).toBe(true);
      }
    }
  });

  test('a 157 km loop shows 5 to 12 pills at the fitted zoom', () => {
    const loop: LatLon[] = Array.from({ length: 40_000 }, (_, i) => {
      const a = (i / 39_999) * 2 * Math.PI;
      const r = 157 / (2 * Math.PI) / 111.195;
      return [-7 + r * Math.sin(a), 110 + r * Math.cos(a)];
    });
    const view = fitBounds(boundsOf([loop])!, WIDTH, HEIGHT, 48);
    const all = Array.from({ length: 156 }, (_, i) => {
      const a = (((i + 1) / 157) * 2 * Math.PI);
      const r = 157 / (2 * Math.PI) / 111.195;
      return pill(i + 1, screenOf(view, [-7 + r * Math.sin(a), 110 + r * Math.cos(a)]));
    });
    const kept = pickKmPills(all, [{ ...screenOf(view, loop[0]), w: 20, h: 20 }]);
    expect(kept.length).toBeGreaterThanOrEqual(5);
    expect(kept.length).toBeLessThanOrEqual(MAX_KM_PILLS);
  });

  test('the step is a multiple of the 1 / 2 / 5 / 10 / 20 / 50 ladder', () => {
    const all = ride.kmAt.map((m) => pill(m.km, screenOf(fitView, m.pos)));
    const kept = pickKmPills(all, [start, finish]);
    expect(KM_STEPS.some((step) => kept.every((km) => km % step === 0) && step >= 10)).toBe(true);
  });

  test('zoomed in on one stretch every kilometre comes back', () => {
    const mid = ride.kmAt[40];
    const zoomed = { lat: mid.pos[0], lon: mid.pos[1], zoom: 12.5 };
    const onScreen = ride.kmAt
      .map((m) => pill(m.km, screenOf(zoomed, m.pos)))
      .filter((c) => c.x > 0 && c.x < WIDTH && c.y > 0 && c.y < HEIGHT);
    expect(onScreen.length).toBeGreaterThan(1);
    const kept = pickKmPills(onScreen);
    expect(kept.length).toBe(onScreen.length);
    expect(kept).toContain(41);
  });

  test('a short run keeps every kilometre', () => {
    const run = Array.from({ length: 8 }, (_, i) => pill(i + 1, { x: 20 + i * 38, y: 100 }));
    expect(pickKmPills(run)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('more than 12 whole kilometres in view step to every 2 / 5 / 10 / 20 km', () => {
    const at = (n: number) => Array.from({ length: n }, (_, i) => pill(i + 1, { x: 10 + i * 40, y: 100 }));
    expect(pickKmPills(at(12))).toHaveLength(12);
    expect(pickKmPills(at(13))).toEqual([2, 4, 6, 8, 10, 12]);
    expect(pickKmPills(at(30))).toEqual([5, 10, 15, 20, 25, 30]);
    expect(pickKmPills(at(157))).toEqual([20, 40, 60, 80, 100, 120, 140]);
  });

  test('on an out-and-back the return pass loses the pill that lands on the outbound one', () => {
    const out = pill(20, { x: 100, y: 100 });
    const back = pill(140, { x: 104, y: 103 });
    const far = pill(60, { x: 250, y: 100 });
    expect(pickKmPills([out, far, back])).toEqual([20, 60]);
  });

  test('a pill under the start or finish marker is dropped', () => {
    expect(pickKmPills([pill(1, { x: 50, y: 50 })], [{ x: 52, y: 50, w: 20, h: 20 }])).toEqual([]);
  });

  test('nothing on screen, nothing drawn', () => {
    expect(pickKmPills([])).toEqual([]);
  });
});

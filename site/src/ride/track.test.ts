import { describe, expect, test } from "bun:test";

import { ROUTES } from "./routes.ts";
import { PRE_M, Track, makeTrackPoint, pchip, routeStats } from "./track.ts";

describe("pchip", () => {
  const f = pchip([
    [0, 0],
    [10, 10],
    [20, 10],
    [30, 0],
  ]);

  test("passes through its control points", () => {
    expect(f(0)).toBeCloseTo(0);
    expect(f(10)).toBeCloseTo(10);
    expect(f(30)).toBeCloseTo(0);
  });

  test("never overshoots a plateau", () => {
    for (let x = 10; x <= 20; x += 0.5) expect(f(x)).toBeLessThanOrEqual(10 + 1e-9);
  });

  test("holds the end values outside the range", () => {
    expect(f(-50)).toBe(0);
    expect(f(99)).toBe(0);
  });
});

describe("routes", () => {
  test("every route has increasing control points and segments inside its length", () => {
    for (const route of ROUTES) {
      for (const list of [route.elevation, route.heading]) {
        for (let i = 1; i < list.length; i++) expect(list[i]![0]).toBeGreaterThan(list[i - 1]![0]);
        expect(list[list.length - 1]![0]).toBe(route.lengthM);
      }
      for (const seg of route.segments) {
        expect(seg.startM).toBeGreaterThanOrEqual(0);
        expect(seg.endM).toBeLessThanOrEqual(route.lengthM);
        expect(seg.endM).toBeGreaterThan(seg.startM);
      }
    }
  });

  test("there are at least two routes and the hilly one climbs far more than the flat one", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(2);
    const flat = routeStats(ROUTES.find((r) => r.id === "pantai")!);
    const hilly = routeStats(ROUTES.find((r) => r.id === "bukit")!);
    expect(hilly.gainM).toBeGreaterThan(flat.gainM * 5);
    expect(flat.maxGrade).toBeLessThan(4);
  });
});

describe("Track", () => {
  const route = ROUTES.find((r) => r.id === "bukit")!;
  const track = new Track(route);

  test("elevation at the route's control points matches the data", () => {
    expect(track.elevationAt(0)).toBeCloseTo(route.elevation[0]![1], 0);
    expect(track.elevationAt(route.lengthM)).toBeCloseTo(route.elevation[route.elevation.length - 1]![1], 0);
  });

  test("gradient is steep on the climb and negative on the descent", () => {
    expect(track.gradeAt(3000)).toBeGreaterThan(5);
    expect(track.gradeAt(5600)).toBeLessThan(-5);
  });

  test("the road advances about one sample length per step along its heading", () => {
    const a = track.at(1000, makeTrackPoint());
    const b = track.at(1004, makeTrackPoint());
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(4, 1);
    expect(Math.hypot(a.tx, a.tz)).toBeCloseTo(1);
  });

  test("starts facing -Z and the road extends behind the start line", () => {
    const start = track.at(0, makeTrackPoint());
    expect(start.tz).toBeLessThan(0);
    expect(track.at(-PRE_M, makeTrackPoint()).z).toBeGreaterThan(start.z);
  });

  test("a positive heading turns the road to the right", () => {
    const a = track.at(900, makeTrackPoint());
    const b = track.at(1000, makeTrackPoint());
    expect(b.x - a.x).toBeGreaterThan(0);
  });
});

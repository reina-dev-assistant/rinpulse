import { describe, expect, test } from 'bun:test';

import { climbAhead, elevationStrip, routeClimbs } from './climbsAhead';
import { at, polyline, profileRoute } from './testRoutes';

describe('routeClimbs', () => {
  test('2 km at 6 % after a flat', () => {
    const climbs = routeClimbs(profileRoute([[1000, 0], [2000, 6], [500, 0]]));
    expect(climbs).toHaveLength(1);
    const c = climbs[0]!;
    expect(c.startM).toBeGreaterThan(950);
    expect(c.startM).toBeLessThan(1100);
    expect(c.lengthM).toBeGreaterThan(1800);
    expect(c.lengthM).toBeLessThan(2050);
    expect(c.ascentM).toBeGreaterThan(105);
    expect(c.ascentM).toBeLessThan(125);
    expect(c.avgGradePct).toBeGreaterThan(5.5);
    expect(c.maxGradePct).toBeGreaterThanOrEqual(c.avgGradePct);
    // score ~ 2000 * 6 = 12000: category 4
    expect(c.category).toBe(4);
  });

  test('two climbs separated by a descent', () => {
    const climbs = routeClimbs(profileRoute([[500, 0], [1000, 5], [800, -6], [1500, 7], [300, 0]]));
    expect(climbs).toHaveLength(2);
    expect(climbs[0]!.endM).toBeLessThan(climbs[1]!.startM);
    expect(climbs[1]!.avgGradePct).toBeGreaterThan(6);
  });

  test('a short dip inside a climb keeps it one climb', () => {
    const climbs = routeClimbs(profileRoute([[1000, 6], [100, -4], [1000, 6]]));
    expect(climbs).toHaveLength(1);
    expect(climbs[0]!.lengthM).toBeGreaterThan(2000);
  });

  test('too short or too gentle is not a climb', () => {
    expect(routeClimbs(profileRoute([[400, 8]]))).toEqual([]);
    expect(routeClimbs(profileRoute([[3000, 1.5]]))).toEqual([]);
  });

  test('category thresholds follow the score', () => {
    // 5 km at 8 % = 40000: category 2
    expect(routeClimbs(profileRoute([[500, 0], [5000, 8]]))[0]!.category).toBe(2);
    // 800 m at 3.5 % = 2800: uncategorised
    expect(routeClimbs(profileRoute([[500, 0], [800, 3.5]]))[0]!.category).toBeNull();
  });

  test('a route without altitude has no climbs', () => {
    expect(routeClimbs(polyline([[0, 0], [3000, 0]], 10))).toEqual([]);
  });

  test('fewer than 90 % of points with altitude gives none', () => {
    const pts = profileRoute([[500, 0], [2000, 6]]);
    const holes = pts.map((p, i) => (i % 5 === 0 ? { ...p, alt: null } : p));
    expect(routeClimbs(holes)).toEqual([]);
    const few = pts.map((p, i) => (i % 20 === 7 ? { ...p, alt: null } : p));
    expect(routeClimbs(few)).toHaveLength(1);
  });
});

describe('climbAhead', () => {
  const climbs = routeClimbs(profileRoute([[1000, 0], [2000, 6], [500, 0], [1000, -6], [1500, 7]]));

  test('the next climb ahead', () => {
    expect(climbs.length).toBe(2);
    const a = climbAhead(climbs, 200)!;
    expect(a.inProgress).toBe(false);
    expect(a.startsInM).toBe(climbs[0]!.startM - 200);
    expect(a.remainingM).toBe(climbs[0]!.lengthM);
    expect(a.remainingAscentM).toBe(climbs[0]!.ascentM);
  });

  test('in progress', () => {
    const c = climbs[0]!;
    const mid = c.startM + c.lengthM / 2;
    const a = climbAhead(climbs, mid)!;
    expect(a.inProgress).toBe(true);
    expect(a.startsInM).toBe(0);
    expect(a.remainingM).toBeCloseTo(c.endM - mid, 5);
    expect(a.remainingAscentM).toBeCloseTo(c.ascentM / 2, 0);
  });

  test('moves to the second climb and then none', () => {
    expect(climbAhead(climbs, climbs[0]!.endM + 1)!.climb).toBe(climbs[1]!);
    expect(climbAhead(climbs, climbs[1]!.endM)).toBeNull();
    expect(climbAhead([], 0)).toBeNull();
  });
});

describe('elevationStrip', () => {
  const pts = profileRoute([[1000, 0], [1000, 5]]);

  test('evenly spaced and smoothed', () => {
    const strip = elevationStrip(pts, 0, 2000, 21);
    expect(strip).toHaveLength(21);
    expect(strip[0]!.distM).toBe(0);
    expect(strip[20]!.distM).toBeCloseTo(2000, 0);
    expect(strip[10]!.distM).toBeCloseTo(1000, 0);
    expect(strip[20]!.altM).toBeGreaterThan(strip[10]!.altM + 40);
    expect(strip[0]!.altM).toBeCloseTo(100, 0);
  });

  test('clamps to the route and handles one bin', () => {
    const strip = elevationStrip(pts, -500, 9000, 3);
    expect(strip[0]!.distM).toBe(0);
    expect(strip[2]!.distM).toBeCloseTo(2000, 0);
    expect(elevationStrip(pts, 0, 1000, 1)).toHaveLength(1);
  });

  test('empty without altitude', () => {
    expect(elevationStrip(polyline([[0, 0], [1000, 0]]), 0, 1000, 10)).toEqual([]);
    expect(elevationStrip([at(0, 0, 5)], 0, 10, 5)).toEqual([]);
  });
});

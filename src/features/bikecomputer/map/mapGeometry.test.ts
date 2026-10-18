import { describe, expect, test } from 'bun:test';

import {
  FOLLOW_EASE_MS,
  FOLLOW_ZOOM,
  followAfterRegionChange,
  followStop,
  headingWedge,
  initialView,
  normalizeBearing,
  offsetPoint,
  puckCollection,
  routeCollection,
} from './mapGeometry';

const DENPASAR = { lat: -8.65, lon: 115.2167 };

function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
}

describe('routeCollection / puckCollection', () => {
  test('a route of two or more points is one line in lon,lat order', () => {
    const fc = routeCollection([DENPASAR, { lat: -8.7, lon: 115.25 }]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]?.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [115.2167, -8.65],
        [115.25, -8.7],
      ],
    });
  });

  test('no route, or a single point, is empty', () => {
    expect(routeCollection(null).features).toEqual([]);
    expect(routeCollection([DENPASAR]).features).toEqual([]);
    expect(routeCollection([]).features).toEqual([]);
  });

  test('puck: one point, or nothing', () => {
    expect(puckCollection(DENPASAR).features).toHaveLength(1);
    expect(puckCollection(null).features).toEqual([]);
  });
});

describe('offsetPoint', () => {
  test('moves the requested distance in the requested direction', () => {
    for (const bearing of [0, 90, 180, 270, 45]) {
      const moved = offsetPoint(DENPASAR, bearing, 500);
      expect(haversineM(DENPASAR, moved)).toBeCloseTo(500, 0);
    }
    expect(offsetPoint(DENPASAR, 0, 500).lat).toBeGreaterThan(DENPASAR.lat);
    expect(offsetPoint(DENPASAR, 90, 500).lon).toBeGreaterThan(DENPASAR.lon);
    expect(offsetPoint(DENPASAR, 180, 500).lat).toBeLessThan(DENPASAR.lat);
    expect(offsetPoint(DENPASAR, 270, 500).lon).toBeLessThan(DENPASAR.lon);
  });
});

describe('headingWedge', () => {
  test('is a closed triangle from the puck, pointing along the heading', () => {
    const fc = headingWedge({ ...DENPASAR, headingDeg: 90 });
    const geometry = fc.features[0]?.geometry;
    expect(geometry?.type).toBe('Polygon');
    const ring = geometry?.type === 'Polygon' ? geometry.coordinates[0] : undefined;
    expect(ring).toHaveLength(4);
    expect(ring?.[0]).toEqual(ring?.[3]);
    // heading east: both tips are east of the puck, one slightly north and one slightly south
    const [, a, b] = ring ?? [];
    expect(a?.[0]).toBeGreaterThan(DENPASAR.lon);
    expect(b?.[0]).toBeGreaterThan(DENPASAR.lon);
    expect(Math.sign((a?.[1] ?? 0) - DENPASAR.lat)).toBe(-Math.sign((b?.[1] ?? 0) - DENPASAR.lat));
  });

  test('empty without a position or a usable heading', () => {
    expect(headingWedge(null).features).toEqual([]);
    expect(headingWedge({ ...DENPASAR, headingDeg: null }).features).toEqual([]);
    expect(headingWedge({ ...DENPASAR, headingDeg: Number.NaN }).features).toEqual([]);
  });
});

describe('followStop', () => {
  test('north-up keeps bearing 0 whatever the heading', () => {
    const stop = followStop({ ...DENPASAR, headingDeg: 135 }, false);
    expect(stop).toEqual({ center: [DENPASAR.lon, DENPASAR.lat], zoom: FOLLOW_ZOOM, bearing: 0, duration: FOLLOW_EASE_MS });
  });

  test('heading-up rotates to the heading when known, and stays north-up when not', () => {
    expect(followStop({ ...DENPASAR, headingDeg: 135 }, true).bearing).toBe(135);
    expect(followStop({ ...DENPASAR, headingDeg: -90 }, true).bearing).toBe(270);
    expect(followStop({ ...DENPASAR, headingDeg: null }, true).bearing).toBe(0);
  });

  test('an explicit zoom is honoured', () => {
    expect(followStop({ ...DENPASAR, headingDeg: null }, false, 17).zoom).toBe(17);
  });

  test('normalizeBearing wraps into [0, 360)', () => {
    expect(normalizeBearing(360)).toBe(0);
    expect(normalizeBearing(-1)).toBe(359);
    expect(normalizeBearing(725)).toBe(5);
  });
});

describe('initialView', () => {
  const route = [
    { lat: -8.6, lon: 115.1 },
    { lat: -8.7, lon: 115.3 },
  ];

  test('starts on the rider when the position is known', () => {
    expect(initialView(DENPASAR, route)).toEqual({ center: [DENPASAR.lon, DENPASAR.lat], zoom: FOLLOW_ZOOM });
  });

  test('else fits the route', () => {
    const view = initialView(null, route);
    expect('bounds' in view && view.bounds).toEqual([115.1, -8.7, 115.3, -8.6]);
  });

  test('else shows Indonesia', () => {
    const view = initialView(null, null);
    expect('fallback' in view && view.fallback).toBe(true);
    expect(initialView(null, []).hasOwnProperty('fallback')).toBe(true);
  });
});

describe('followAfterRegionChange', () => {
  test('only the rider own gesture ends following', () => {
    expect(followAfterRegionChange(true, true)).toBe(false);
    expect(followAfterRegionChange(true, false)).toBe(true);
    expect(followAfterRegionChange(false, false)).toBe(false);
    expect(followAfterRegionChange(false, true)).toBe(false);
  });
});

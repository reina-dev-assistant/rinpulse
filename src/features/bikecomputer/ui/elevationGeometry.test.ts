import { describe, expect, test } from 'bun:test';

import { altitudeAt, cropProfile, decimate, MAX_POINTS, MIN_SPAN_M, stripGeometry, stripWindow, type ElevationPoint } from './elevationGeometry';

const ramp: ElevationPoint[] = Array.from({ length: 11 }, (_, i) => ({ distM: i * 100, altM: 100 + i * 10 }));

describe('stripGeometry', () => {
  test('maps the ends of the route to the ends of the box', () => {
    const g = stripGeometry(ramp, 300, 100);
    expect(g).not.toBeNull();
    expect(g!.xOf(0)).toBe(0);
    expect(g!.xOf(1000)).toBe(300);
    expect(g!.line.startsWith('M0 ')).toBe(true);
  });

  test('a higher altitude is higher on screen (smaller y) and stays inside the box', () => {
    const g = stripGeometry(ramp, 300, 100)!;
    expect(g.yOf(200)).toBeLessThan(g.yOf(100));
    for (const alt of [100, 150, 200]) {
      expect(g.yOf(alt)).toBeGreaterThanOrEqual(0);
      expect(g.yOf(alt)).toBeLessThanOrEqual(100);
    }
  });

  test('the fill closes down to the baseline', () => {
    const g = stripGeometry(ramp, 300, 100)!;
    expect(g.area.endsWith('L300 100 L0 100 Z')).toBe(true);
  });

  test('a flat road keeps a minimum vertical span, so it stays flat', () => {
    const flat = ramp.map((p) => ({ ...p, altM: 50 + (p.distM / 1000) * 5 }));
    const g = stripGeometry(flat, 300, 100)!;
    const rise = g.yOf(50) - g.yOf(55);
    expect(rise).toBeCloseTo((5 / MIN_SPAN_M) * 80, 5);
  });

  test('null without a usable profile', () => {
    expect(stripGeometry([], 300, 100)).toBeNull();
    expect(stripGeometry([{ distM: 0, altM: 10 }], 300, 100)).toBeNull();
    expect(stripGeometry([{ distM: 5, altM: 10 }, { distM: 5, altM: 20 }], 300, 100)).toBeNull();
    expect(stripGeometry(ramp, 0, 100)).toBeNull();
  });

  test('non-finite points are skipped', () => {
    const g = stripGeometry([{ distM: 0, altM: 10 }, { distM: 50, altM: Number.NaN }, { distM: 100, altM: 20 }], 100, 100);
    expect(g).not.toBeNull();
    expect(g!.line).not.toContain('NaN');
  });

  test('a long route is drawn with at most MAX_POINTS points', () => {
    const long = Array.from({ length: 5000 }, (_, i) => ({ distM: i * 10, altM: Math.sin(i / 50) * 30 }));
    const g = stripGeometry(long, 400, 120)!;
    expect(g.line.split('L').length).toBeLessThanOrEqual(MAX_POINTS);
  });
});

describe('decimate', () => {
  test('keeps the first and the last point and never exceeds max', () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    const out = decimate(items, 50);
    expect(out).toHaveLength(50);
    expect(out[0]).toBe(0);
    expect(out[49]).toBe(999);
  });
  test('a short list is returned whole', () => {
    expect(decimate([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });
});

describe('altitudeAt', () => {
  test('interpolates between points and clamps at the ends', () => {
    expect(altitudeAt(ramp, 150)).toBeCloseTo(115, 10);
    expect(altitudeAt(ramp, -20)).toBe(100);
    expect(altitudeAt(ramp, 5000)).toBe(200);
  });
  test('null for no points', () => {
    expect(altitudeAt([], 10)).toBeNull();
  });
});

describe('stripWindow and cropProfile', () => {
  const total = 27_000;
  test('zooms on the climb with a margin, and includes the rider when still before it', () => {
    expect(stripWindow({ startM: 7800, endM: 9300 }, 8200, total)).toEqual({ fromM: 7300, toM: 9800 });
    expect(stripWindow({ startM: 7800, endM: 9300 }, 5000, total)).toEqual({ fromM: 4500, toM: 9800 });
  });
  test('without a climb it looks ahead from just behind the rider', () => {
    expect(stripWindow(null, 3000, total)).toEqual({ fromM: 2500, toM: 11_000 });
  });
  test('stays inside the route', () => {
    const w = stripWindow(null, 26_000, total);
    expect(w.toM).toBe(total);
    expect(w.fromM).toBeGreaterThanOrEqual(0);
    expect(stripWindow(null, null, total).fromM).toBe(0);
  });
  test('the cropped profile starts and ends exactly on the window, with interpolated altitudes', () => {
    const out = cropProfile(ramp, 150, 450);
    expect(out[0]).toEqual({ distM: 150, altM: 115 });
    expect(out[out.length - 1]).toEqual({ distM: 450, altM: 145 });
    expect(out.map((p) => p.distM)).toEqual([150, 200, 300, 400, 450]);
  });
  test('an empty window or profile gives nothing', () => {
    expect(cropProfile(ramp, 400, 400)).toEqual([]);
    expect(cropProfile([], 0, 100)).toEqual([]);
  });
});

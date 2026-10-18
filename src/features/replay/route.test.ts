import { describe, expect, it } from 'bun:test';

import { EARTH_CIRCUMFERENCE_M, MIN_ROUTE_M, buildRoutePath, distanceOfIndex, pointAt, sampleAt } from './route';
import { syntheticTrack } from './replayFixtures';
import { fillGaps, trackFromAnalysis } from './track';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';

describe('trim and privacy', () => {
  const track = syntheticTrack({ n: 300 });
  const total = track.totals.distanceM;

  it('cuts the requested metres off both ends', () => {
    const full = buildRoutePath(track, 0)!;
    const trimmed = buildRoutePath(track, 200)!;
    // Chaikin keeps the end points, so the lengths differ by the trim up to a little rounding of corners.
    expect(full.lengthM - trimmed.lengthM).toBeGreaterThan(380);
    expect(full.lengthM - trimmed.lengthM).toBeLessThan(420);
    expect(trimmed.trimmedM).toBe(200);
  });

  it('the trimmed path starts and ends away from the real start and end', () => {
    const full = buildRoutePath(track, 0)!;
    const trimmed = buildRoutePath(track, 200)!;
    const metres = (x0: number, y0: number, x1: number, y1: number) => Math.hypot(x1 - x0, y1 - y0) * full.mPerUnit;
    const last = full.mx.length - 1;
    const tl = trimmed.mx.length - 1;
    // Crow-flies distance is at most the path distance (200 m) and clearly more than a few metres on a winding road.
    expect(metres(full.mx[0]!, full.my[0]!, trimmed.mx[0]!, trimmed.my[0]!)).toBeLessThanOrEqual(200.5);
    expect(metres(full.mx[0]!, full.my[0]!, trimmed.mx[0]!, trimmed.my[0]!)).toBeGreaterThan(100);
    expect(metres(full.mx[last]!, full.my[last]!, trimmed.mx[tl]!, trimmed.my[tl]!)).toBeGreaterThan(100);
  });

  it('the sample index range moves in from both ends', () => {
    const trimmed = buildRoutePath(track, 200)!;
    expect(trimmed.idx[0]).toBeGreaterThan(0);
    expect(trimmed.idx[trimmed.idx.length - 1]).toBeLessThan(track.n - 1);
    expect(distanceOfIndex(trimmed, 0)).toBe(0);
    expect(distanceOfIndex(trimmed, track.n)).toBe(trimmed.lengthM);
  });

  it('no trim keeps the whole track', () => {
    const full = buildRoutePath(track, 0)!;
    expect(full.idx[0]).toBe(0);
    expect(full.idx[full.idx.length - 1]).toBeCloseTo(track.n - 1, 6);
    expect(full.lengthM).toBeGreaterThan(total * 0.95);
    expect(full.lengthM).toBeLessThanOrEqual(total * 1.01);
  });

  it('a route shorter than twice the trim plus the minimum collapses to nothing instead of a stub', () => {
    const short = syntheticTrack({ n: 12, speed: 1 });
    expect(short.totals.distanceM).toBeLessThan(400 + MIN_ROUTE_M);
    expect(buildRoutePath(short, 200)).toBeNull();
    expect(buildRoutePath(short, 0)).not.toBeNull();
  });

  it('a track that never moves has no path', () => {
    const still = syntheticTrack({ n: 20, speed: 0 });
    expect(buildRoutePath(still, 0)).toBeNull();
  });

  it('negative trim is treated as zero', () => {
    expect(buildRoutePath(track, -50)!.lengthM).toBeCloseTo(buildRoutePath(track, 0)!.lengthM, 6);
  });
});

describe('path lookups', () => {
  const path = buildRoutePath(syntheticTrack({ n: 200 }), 0)!;

  it('cum is increasing and ends at the length', () => {
    for (let k = 1; k < path.cum.length; k++) expect(path.cum[k]!).toBeGreaterThanOrEqual(path.cum[k - 1]!);
    expect(path.cum[path.cum.length - 1]).toBe(path.lengthM);
  });

  it('pointAt clamps and interpolates', () => {
    expect(pointAt(path, -10).mx).toBe(path.mx[0]!);
    expect(pointAt(path, 1e9).my).toBe(path.my[path.my.length - 1]!);
    const mid = pointAt(path, path.lengthM / 2);
    expect(mid.idx).toBeGreaterThan(0);
    expect(mid.idx).toBeLessThan(199);
  });

  it('distanceOfIndex inverts pointAt', () => {
    const d = path.lengthM * 0.37;
    expect(distanceOfIndex(path, pointAt(path, d).idx)).toBeCloseTo(d, 3);
  });

  it('metres per Mercator unit follows the latitude', () => {
    expect(path.mPerUnit).toBeLessThan(EARTH_CIRCUMFERENCE_M);
    expect(path.mPerUnit).toBeGreaterThan(EARTH_CIRCUMFERENCE_M * 0.98);
  });

  it('sampleAt reads between samples and ignores gaps', () => {
    expect(sampleAt([10, 20, 30], 0.5)).toBe(15);
    expect(sampleAt([10, null, 30], 1)).toBe(30);
    expect(sampleAt([null, null], 0.5)).toBeNull();
    expect(sampleAt([1, 2], 99)).toBe(2);
  });
});

describe('track from analysis', () => {
  it('fills GPS gaps linearly and holds the edges', () => {
    expect(fillGaps([null, 1, null, null, 4, null])).toEqual([1, 1, 2, 3, 4, 4]);
    expect(fillGaps([null, null])).toBeNull();
  });

  const series = (track: ([number, number] | null)[]) =>
    ({
      v: 1,
      sport: { name: 'Ride', kind: 'ride' },
      startedAt: 0,
      elapsedSec: 40,
      movingSec: 40,
      distanceM: 400,
      elevation: null,
      series: { stepSec: 10, n: track.length, dist: [0, 100, 200, 300, 400].slice(0, track.length), hr: null, pace: null, alt: null, cad: null, power: null, track },
      splits: [],
      laps: [],
      hrZones: null,
      paceZones: null,
      bestEfforts: [],
      effort: null,
      load: null,
      calories: null,
      comparison: null,
      stats: { avgHr: null, maxHr: null, minHr: null, avgPaceSecKm: null, bestPaceSecKm: null, avgSpeedMs: null, maxSpeedMs: null, avgCad: null, maxCad: null, avgPower: null, maxPower: null, normalizedPower: null, avgStrideM: null },
    }) as WorkoutAnalysis;

  it('has no track without GPS, or with a single fix', () => {
    expect(trackFromAnalysis(series([null, null, null, null, null]))).toBeNull();
    expect(trackFromAnalysis(series([null, [1, 1], null, null, null]))).toBeNull();
  });

  it('builds a track and fills the gap', () => {
    const t = trackFromAnalysis(series([[1, 1], null, [1.0002, 1.0002], [1.0003, 1.0003], [1.0004, 1.0004]]))!;
    expect(t.lat[1]).toBeCloseTo(1.0001, 9);
    expect(t.n).toBe(5);
    expect(t.totals.distanceM).toBe(400);
  });
});

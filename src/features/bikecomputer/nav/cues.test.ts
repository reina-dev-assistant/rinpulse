import { describe, expect, test } from 'bun:test';

import type { TurnCue } from '../types';
import { generateCues } from './cues';
import { at, polyline, rng } from './testRoutes';

const kinds = (cues: readonly TurnCue[]) => cues.map((c) => c.kind);

describe('generateCues', () => {
  test('square route: right turns between start and finish, none at the closing vertex', () => {
    const closed = generateCues(polyline([[0, 0], [400, 0], [400, -400], [0, -400], [0, 0]], 10));
    expect(kinds(closed)).toEqual(['start', 'right', 'right', 'right', 'finish']);
    expect(closed[1]!.atM).toBeGreaterThan(385);
    expect(closed[1]!.atM).toBeLessThan(415);
    expect(closed[0]!.atM).toBe(0);
    expect(closed[4]!.atM).toBeGreaterThan(1590);
    const lapAndAHalf = generateCues(polyline([[0, 0], [400, 0], [400, -400], [0, -400], [0, 0], [200, 0]], 10));
    expect(kinds(lapAndAHalf)).toEqual(['start', 'right', 'right', 'right', 'right', 'finish']);
  });

  test('counter-clockwise square turns left', () => {
    const cues = generateCues(polyline([[0, 0], [400, 0], [400, 400], [0, 400]], 10));
    expect(kinds(cues)).toEqual(['start', 'left', 'left', 'finish']);
  });

  test('S-bend: right then left', () => {
    const cues = generateCues(polyline([[0, 0], [300, 0], [300, -300], [600, -300]], 10));
    expect(kinds(cues)).toEqual(['start', 'right', 'left', 'finish']);
  });

  test('hairpin is a u-turn', () => {
    const cues = generateCues(polyline([[0, 0], [500, 0], [500, 3], [0, 3]], 10));
    expect(kinds(cues)).toContain('uTurn');
  });

  test('classification by angle', () => {
    const turn = (deg: number) => {
      const r = (deg * Math.PI) / 180;
      return generateCues(polyline([[0, 0], [300, 0], [300 + 300 * Math.cos(r), -300 * Math.sin(r)]], 10)).map((c) => c.kind);
    };
    expect(turn(40)).toEqual(['start', 'slightRight', 'finish']);
    expect(turn(90)).toEqual(['start', 'right', 'finish']);
    expect(turn(140)).toEqual(['start', 'sharpRight', 'finish']);
  });

  test('a straight line with 3 m noise gives no turns', () => {
    for (const seed of [1, 2, 3]) {
      const rand = rng(seed);
      const pts = [];
      for (let x = 0; x <= 3000; x += 2) pts.push(at(x, rand() * 3));
      expect(kinds(generateCues(pts))).toEqual(['start', 'finish']);
    }
  });

  test('a drawn route of two points', () => {
    const cues = generateCues([at(0, 0), at(1000, 0)]);
    expect(kinds(cues)).toEqual(['start', 'finish']);
    expect(cues[1]!.atM).toBeGreaterThan(995);
  });

  test('degenerate routes', () => {
    expect(generateCues([])).toEqual([]);
    expect(kinds(generateCues([at(0, 0)]))).toEqual(['start', 'finish']);
    expect(kinds(generateCues([at(0, 0), at(3, 0)]))).toEqual(['start', 'finish']);
  });

  test('a loop has no cue at the closing vertex unless it turns', () => {
    // Closes with the heading continuing: a long straight there and back along a rectangle loop begun mid-edge.
    const cues = generateCues(polyline([[200, 0], [400, 0], [400, -400], [0, -400], [0, 0], [200, 0]], 10));
    expect(kinds(cues)).toEqual(['start', 'right', 'right', 'right', 'right', 'finish']);
    const last = cues[cues.length - 2]!;
    expect(last.atM).toBeLessThan(cues[cues.length - 1]!.atM - 150);
  });

  test('dense and sparse versions of one route agree', () => {
    const corners: [number, number][] = [[0, 0], [500, 0], [500, -500], [0, -500]];
    const dense = generateCues(polyline(corners, 2));
    const sparse = generateCues(polyline(corners, 250));
    expect(kinds(dense)).toEqual(kinds(sparse));
  });

  test('cues closer than 30 m merge into the larger', () => {
    // Two 60 degree kinks 10 m apart.
    const cues = generateCues(polyline([[0, 0], [300, 0], [305, -9], [315, -9], [615, -9]], 5));
    expect(cues.filter((c) => c.kind !== 'start' && c.kind !== 'finish').length).toBeLessThanOrEqual(1);
  });

  test('5000 points run under 50 ms', () => {
    const pts = [];
    for (let i = 0; i < 5000; i++) pts.push(at(i * 8, Math.sin(i / 40) * 150));
    generateCues(pts);
    const t0 = performance.now();
    const cues = generateCues(pts);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(cues.length).toBeGreaterThanOrEqual(2);
  });
});

import { describe, expect, it } from 'bun:test';

import { EDGE_MARGIN, MAX_CALLOUTS, MIN_PIN_GAP, selectCallouts } from './callouts';
import { syntheticTrack } from './replayFixtures';
import { buildRoutePath } from './route';
import type { ReplayTrack } from './track';

function select(track: ReplayTrack, trim = 0) {
  return selectCallouts(track, buildRoutePath(track, trim)!);
}

const kinds = (list: { kind: string }[]) => list.map((c) => c.kind);

describe('callout selection', () => {
  const track = syntheticTrack({ n: 500 });

  it('pins the heart-rate peak, the top speed and the highest point of a ride', () => {
    const picked = select(track);
    expect(kinds(picked)).toEqual(expect.arrayContaining(['maxHr', 'maxSpeed', 'highest']));
    const hr = picked.find((c) => c.kind === 'maxHr')!;
    expect(hr.value).toBe(Math.max(...(track.hr as number[])));
    expect(hr.p).toBeGreaterThan(0.6);
    expect(hr.p).toBeLessThan(0.8);
    const high = picked.find((c) => c.kind === 'highest')!;
    expect(high.p).toBeGreaterThan(0.38);
    expect(high.p).toBeLessThan(0.52);
    const fast = picked.find((c) => c.kind === 'maxSpeed')!;
    expect(fast.value).toBeCloseTo(6 * 2.2 * 3.6, 0);
    expect(fast.p).toBeGreaterThan(0.25);
    expect(fast.p).toBeLessThan(0.35);
  });

  it('is sorted by progress, at most four, never on top of each other, never at the edges', () => {
    const picked = select(track);
    expect(picked.length).toBeLessThanOrEqual(MAX_CALLOUTS);
    for (let i = 1; i < picked.length; i++) {
      expect(picked[i]!.p).toBeGreaterThan(picked[i - 1]!.p);
      expect(picked[i]!.p - picked[i - 1]!.p).toBeGreaterThanOrEqual(MIN_PIN_GAP);
    }
    for (const c of picked) {
      expect(c.p).toBeGreaterThanOrEqual(EDGE_MARGIN);
      expect(c.p).toBeLessThanOrEqual(1 - EDGE_MARGIN);
    }
  });

  it('a run gets its best pace, a walk no speed pin, a ride its top speed', () => {
    expect(kinds(select(syntheticTrack({ n: 300, kind: 'run', speed: 3 })))).toContain('bestPace');
    expect(kinds(select(syntheticTrack({ n: 300, kind: 'run', speed: 3 })))).not.toContain('maxSpeed');
    const walk = kinds(select(syntheticTrack({ n: 300, kind: 'walk', speed: 1.4 })));
    expect(walk).not.toContain('maxSpeed');
    expect(walk).not.toContain('bestPace');
    expect(kinds(select(track))).toContain('maxSpeed');
  });

  it('a pace pin carries seconds per km', () => {
    const run = select(syntheticTrack({ n: 300, kind: 'run', speed: 3 })).find((c) => c.kind === 'bestPace')!;
    expect(run.value).toBeCloseTo(1000 / (3 * 2.2), 0);
  });

  it('no heart rate, no pin; flat ground, no highest point', () => {
    expect(kinds(select(syntheticTrack({ n: 300, withHr: false })))).not.toContain('maxHr');
    const flat = syntheticTrack({ n: 300 });
    flat.alt = flat.alt.map((v) => (v === null ? null : 100 + (v % 3)));
    expect(kinds(select(flat))).not.toContain('highest');
    expect(kinds(select(syntheticTrack({ n: 300, withAlt: false })))).not.toContain('highest');
  });

  it('a peak inside the privacy trim is not pinned', () => {
    const t = syntheticTrack({ n: 400 });
    // Put the highest heart rate at the second sample: it lies in the first 200 m, which is cut.
    t.hr = t.hr.map((v, i) => (i === 1 ? 199 : v));
    expect(select(t, 0).find((c) => c.kind === 'maxHr')?.value ?? 0).not.toBe(199);
    const trimmed = select(t, 200).find((c) => c.kind === 'maxHr');
    expect(trimmed?.value).not.toBe(199);
  });

  it('a record is pinned only at rank 1, at the end of the effort', () => {
    const t = syntheticTrack({ n: 500 });
    const atM = t.totals.distanceM * 0.5;
    t.bestEfforts = [{ key: '5k', sec: 1260, atM, rank: 1 }];
    const pr = select(t).find((c) => c.kind === 'pr')!;
    expect(pr.value).toBe(1260);
    expect(pr.effort).toBe('5k');
    expect(pr.p).toBeGreaterThan(0.5);
    t.bestEfforts = [{ key: '5k', sec: 1260, atM, rank: 2 }];
    expect(kinds(select(t))).not.toContain('pr');
    t.bestEfforts = [{ key: '5k', sec: 1260, atM, rank: null }];
    expect(kinds(select(t))).not.toContain('pr');
  });

  it('keeps the highest priority when two moments coincide', () => {
    const t = syntheticTrack({ n: 500 });
    // A record that ends exactly where the heart rate peaks: the record wins.
    const peak = t.hr.indexOf(Math.max(...(t.hr as number[])));
    t.bestEfforts = [{ key: '1k', sec: 200, atM: t.dist[peak]! - 1000, rank: 1 }];
    const picked = select(t);
    expect(kinds(picked)).toContain('pr');
    expect(kinds(picked)).not.toContain('maxHr');
  });

  it('pins the biggest climb at its top when it is big enough', () => {
    const t = syntheticTrack({ n: 500 });
    t.climbs = [
      { startM: 1000, endM: 3000, gainM: 30, lengthM: 2000 },
      { startM: t.totals.distanceM * 0.1, endM: t.totals.distanceM * 0.2, gainM: 210, lengthM: 4000 },
    ];
    const climb = select(t).find((c) => c.kind === 'climb')!;
    expect(climb.value).toBe(210);
    expect(climb.p).toBeGreaterThan(0.1);
    expect(climb.p).toBeLessThan(0.3);
  });
});

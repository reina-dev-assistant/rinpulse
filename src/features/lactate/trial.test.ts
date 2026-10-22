import { describe, expect, it } from 'bun:test';

import { analyseTrial, EFFORT_SEC, findEffortStart, MEASURE_SEC, SETTLE_SEC, type TrialPoint } from './trial';

const T0 = 1_760_000_000;

/** A run read once a second: `hr(t)` and `speed(t)` by seconds from the start. */
function run(seconds: number, hr: (t: number) => number | null, speed: (t: number) => number | null = () => 3.3): TrialPoint[] {
  return Array.from({ length: seconds + 1 }, (_, t) => ({ ts: T0 + t, hr: hr(t), speed: speed(t), lat: null, lon: null }));
}

/** 15 min easy, 30 min effort, 10 min easy: the guide's shape. */
const effortHr = (hard: (t: number) => number) => (t: number) => (t < 900 ? 130 : t < 900 + EFFORT_SEC ? hard(t - 900) : 140);

describe('analyseTrial', () => {
  it('takes the mean of the last 20 minutes: the heart rate catching up in the first 10 does not count', () => {
    // Climbs from 130 to 166 over the first 10 minutes, then holds 168.
    const points = run(900 + EFFORT_SEC + 600, effortHr((t) => (t < SETTLE_SEC ? 130 + (36 * t) / SETTLE_SEC : 168)));
    const r = analyseTrial(points, T0 + 900, 190);
    expect(r.lthr).toBe(168);
    expect(r.problems).toEqual([]);
    expect(r.usable).toBe(true);
    expect(r.halves).toEqual([168, 168]);
    expect(r.coverage).toBe(1);
  });

  it('gives the pace of the same 20 minutes: 3.3 m/s is 5:03 per km', () => {
    const points = run(900 + EFFORT_SEC, effortHr(() => 165));
    expect(analyseTrial(points, T0 + 900, 190).paceSecKm).toBe(303);
  });

  it('weights by time, not by reading: a sensor that reports more often does not pull the mean', () => {
    const points: TrialPoint[] = [];
    for (let t = 0; t <= 900 + EFFORT_SEC; t++) {
      const hr = t < 900 ? 130 : t - 900 < 1200 ? 160 : 170;
      points.push({ ts: T0 + t, hr, speed: 3, lat: null, lon: null });
      // twice as many readings in the first measured half
      if (t >= 900 + SETTLE_SEC && t - 900 < 1200) points.push({ ts: T0 + t + 0.5, hr, speed: 3, lat: null, lon: null });
    }
    expect(analyseTrial(points, T0 + 900, 190).lthr).toBe(165);
  });

  it('leaves the pace out without speed (a treadmill) and still gives the heart rate', () => {
    const r = analyseTrial(run(900 + EFFORT_SEC, effortHr(() => 165), () => null), T0 + 900, 190);
    expect(r.lthr).toBe(165);
    expect(r.paceSecKm).toBeNull();
    expect(r.usable).toBe(true);
  });

  it('works out the speed from the fixes when the points carry none', () => {
    const points: TrialPoint[] = Array.from({ length: 900 + EFFORT_SEC + 1 }, (_, t) => ({
      ts: T0 + t,
      hr: 165,
      speed: null,
      lat: -6.2 + (t * 3.0) / 111_320,
      lon: 106.8,
    }));
    expect(Math.abs((analyseTrial(points, T0 + 900, 190).paceSecKm as number) - 333)).toBeLessThanOrEqual(1);
  });

  it('warns about drift: the second half 8 % higher than the first', () => {
    const points = run(900 + EFFORT_SEC, effortHr((t) => (t < SETTLE_SEC + MEASURE_SEC / 2 ? 160 : 173)));
    const r = analyseTrial(points, T0 + 900, 190);
    expect(r.problems).toContain('drift');
    expect(r.usable).toBe(true);
  });

  it('warns when the speed varies from minute to minute', () => {
    const points = run(900 + EFFORT_SEC, effortHr(() => 165), (t) => (Math.floor(t / 60) % 2 === 0 ? 2.6 : 4.0));
    expect(analyseTrial(points, T0 + 900, 190).problems).toContain('paceVaries');
  });

  it('blocks on heart-rate gaps: half of the last 20 minutes has no reading', () => {
    const points = run(900 + EFFORT_SEC, (t) => (t >= 900 + SETTLE_SEC && Math.floor(t / 300) % 2 === 0 ? null : 165));
    const r = analyseTrial(points, T0 + 900, 190);
    expect(r.problems).toContain('hrGaps');
    expect(r.usable).toBe(false);
    expect(r.lthr).toBeNull();
  });

  it('blocks when the workout ends before the 30 minutes do', () => {
    const r = analyseTrial(run(900 + 20 * 60, effortHr(() => 165)), T0 + 900, 190);
    expect(r.problems).toEqual(['tooShort']);
    expect(r.usable).toBe(false);
    expect(analyseTrial([], T0, 190).problems).toEqual(['tooShort']);
  });

  it('says an average under 78 % of the maximum looks like an easy run, and one above the maximum says the maximum is low', () => {
    expect(analyseTrial(run(900 + EFFORT_SEC, effortHr(() => 140)), T0 + 900, 190).problems).toContain('tooEasy');
    expect(analyseTrial(run(900 + EFFORT_SEC, effortHr(() => 186)), T0 + 900, 180).problems).toContain('aboveMax');
  });

  it('ignores implausible heart-rate readings', () => {
    const points = run(900 + EFFORT_SEC, effortHr((t) => (t % 100 === 0 ? 0 : 165)));
    expect(analyseTrial(points, T0 + 900, 190).lthr).toBe(165);
  });
});

describe('findEffortStart', () => {
  it('finds the hardest 30 minutes of a run with a warm-up and a cool-down', () => {
    const points = run(900 + EFFORT_SEC + 600, effortHr(() => 168));
    const start = findEffortStart(points);
    expect(start).not.toBeNull();
    expect(Math.abs((start as number) - (T0 + 900))).toBeLessThanOrEqual(60);
  });

  it('is null for a run shorter than 30 minutes or without heart rate', () => {
    expect(findEffortStart(run(20 * 60, () => 150))).toBeNull();
    expect(findEffortStart(run(60 * 60, () => null))).toBeNull();
    expect(findEffortStart([])).toBeNull();
  });
});

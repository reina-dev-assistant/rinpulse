import { describe, expect, test } from 'bun:test';

import type { WorkoutPointRow, WorkoutRow } from '@/db/queries';
import { buildWatchPost, canShareToRogo, hrSeries, routePairs, shareableAnalysis, thinAnalysis } from '@/features/social/watchPost';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';

const START = 1_760_000_000;
const NO_MOTION = { speed: null, cadence: null, stride: null, power: null };

function workout(over: Partial<WorkoutRow> = {}): WorkoutRow {
  return {
    id: 1,
    workoutNumber: 1,
    start: START,
    end: START + 1800,
    sportType: 1,
    sportName: 'Outdoor run',
    duration: 1750,
    distance: 5012.4,
    calories: 320.6,
    avgHr: 152,
    maxHr: 178,
    steps: 5400,
    complete: true,
    imported: false,
    ...over,
  };
}

/** One heart-rate reading per second, `bpm` constant. */
function hrPoints(seconds: number, bpm = 140): WorkoutPointRow[] {
  return Array.from({ length: seconds }, (_, i) => ({ ts: START + i, lat: null, lon: null, alt: null, hr: bpm, ...NO_MOTION }));
}

function fixes(n: number): WorkoutPointRow[] {
  return Array.from({ length: n }, (_, i) => ({ ts: START + i, lat: -6.2 + i * 1e-5, lon: 106.8 + i * 1e-5, alt: null, hr: null, ...NO_MOTION }));
}

describe('canShareToRogo', () => {
  test('a complete watch workout can be shared', () => {
    expect(canShareToRogo(workout())).toBe(true);
  });

  test('imported rows (Huawei export or FIT file, possibly from Strava) cannot', () => {
    expect(canShareToRogo(workout({ imported: true }))).toBe(false);
  });

  test('a partly downloaded workout, or one that is empty or longer than a day, cannot', () => {
    expect(canShareToRogo(workout({ complete: false }))).toBe(false);
    expect(canShareToRogo(workout({ duration: 0 }))).toBe(false);
    expect(canShareToRogo(workout({ duration: 1440 * 60 }))).toBe(true);
    expect(canShareToRogo(workout({ duration: 1440 * 60 + 1 }))).toBe(false);
  });
});

describe('hrSeries', () => {
  test('keeps one reading per second up to 600 seconds', () => {
    const series = hrSeries(hrPoints(600), START, START + 600);
    expect(series?.intervalSec).toBe(1);
    expect(series?.bpm).toHaveLength(600);
  });

  test('one second more doubles the interval so the series stays within 600 readings', () => {
    const series = hrSeries(hrPoints(601), START, START + 601);
    expect(series?.intervalSec).toBe(2);
    expect(series?.bpm).toHaveLength(301);
  });

  test('a long workout never exceeds 600 readings and the interval fits the server limit', () => {
    const series = hrSeries(hrPoints(86_400 / 8), START, START + 86_400);
    expect(series?.bpm.length).toBeLessThanOrEqual(600);
    expect(series?.intervalSec).toBe(144);
  });

  test('averages the readings of one bucket and leaves a gap null', () => {
    const points: WorkoutPointRow[] = [
      { ts: START, lat: null, lon: null, alt: null, hr: 100, ...NO_MOTION },
      { ts: START + 1, lat: null, lon: null, alt: null, hr: 111, ...NO_MOTION },
      { ts: START + 7, lat: null, lon: null, alt: null, hr: 150, ...NO_MOTION },
    ];
    const expected = Array<number | null>(600).fill(null);
    expected[0] = 106;
    expected[3] = 150;
    expect(hrSeries(points, START, START + 1200)).toEqual({ intervalSec: 2, bpm: expected });
  });

  test('readings outside 20 to 250 are dropped, and a workout with none gives null', () => {
    expect(hrSeries(hrPoints(60, 0), START, START + 60)).toBeNull();
    expect(hrSeries([], START, START + 60)).toBeNull();
  });
});

describe('routePairs', () => {
  test('keeps a short route as it is', () => {
    expect(routePairs(fixes(3))).toHaveLength(3);
  });

  test('downsamples to 1000 pairs keeping the first and the last fix', () => {
    const route = routePairs(fixes(5000));
    expect(route).toHaveLength(1000);
    expect(route?.[0]).toEqual([-6.2, 106.8]);
    expect(route?.[999]?.[0]).toBeCloseTo(-6.2 + 4999 * 1e-5, 9);
  });

  test('drops fixes outside the globe and needs two valid ones', () => {
    const bad: WorkoutPointRow[] = [{ ts: START, lat: 91, lon: 0, alt: null, hr: null, ...NO_MOTION }, ...fixes(1)];
    expect(routePairs(bad)).toBeNull();
    expect(routePairs([])).toBeNull();
  });
});

describe('buildWatchPost', () => {
  const options = { caption: '  Morning run  ', visibility: 'grup' as const, includeHr: true, includeRoute: true, includeComparison: true };

  test('maps the row to the server units and omits nothing it has', () => {
    const post = buildWatchPost(workout(), [...hrPoints(60), ...fixes(10)], options);
    expect(post.workout).toEqual({
      sportName: 'Outdoor run',
      startedAt: START * 1000,
      durationMin: 29,
      kcal: 321,
      distanceM: 5012,
      avgHr: 152,
      maxHr: 178,
    });
    expect(post.caption).toBe('Morning run');
    expect(post.visibility).toBe('grup');
    expect(post.detail?.hr?.bpm.length).toBeGreaterThan(0);
    expect(post.detail?.route).toHaveLength(10);
  });

  test('zero calories and distance and an absurd heart rate become null, a blank caption is left out', () => {
    const post = buildWatchPost(workout({ calories: 0, distance: 0, avgHr: 12, maxHr: null, duration: 20 }), [], {
      ...options,
      caption: '   ',
    });
    expect(post.workout).toMatchObject({ kcal: null, distanceM: null, avgHr: null, maxHr: null, durationMin: 1 });
    expect('caption' in post).toBe(false);
  });

  test('sends no detail when it is switched off or the workout has none', () => {
    expect(buildWatchPost(workout(), [...hrPoints(60), ...fixes(10)], { ...options, includeHr: false, includeRoute: false }).detail).toBeUndefined();
    expect(buildWatchPost(workout(), [], options).detail).toBeUndefined();
  });

  test('the map switch becomes showMap, and the route only travels while it is on', () => {
    const points = [...hrPoints(60), ...fixes(10)];
    const on = buildWatchPost(workout(), points, options);
    expect(on.showMap).toBe(true);
    expect(on.detail?.route).toHaveLength(10);
    const off = buildWatchPost(workout(), points, { ...options, includeRoute: false });
    expect(off.showMap).toBe(false);
    expect(off.detail?.route).toBeNull();
    expect(off.detail?.hr?.bpm.length).toBeGreaterThan(0);
  });

  test('a long sport name is cut to the server limit', () => {
    expect(buildWatchPost(workout({ sportName: 'x'.repeat(80) }), [], options).workout.sportName).toHaveLength(60);
  });
});

/** A full analysis of a 30-minute run on a grid of `n` samples, everything present. */
function analysis(n = 6, over: Partial<WorkoutAnalysis> = {}): WorkoutAnalysis {
  const stepSec = 1800 / (n - 1 || 1);
  const col = <T,>(f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));
  return {
    v: 1,
    sport: { name: 'Outdoor run', kind: 'run' },
    startedAt: START * 1000,
    elapsedSec: 1800,
    movingSec: 1700,
    distanceM: 5000,
    elevation: { gainM: 20, lossM: 18, minM: 10, maxM: 30 },
    series: {
      stepSec,
      n,
      dist: col((i) => i * 10),
      hr: col(() => 150),
      pace: col(() => 330),
      alt: col(() => 12),
      cad: col(() => 170),
      power: null,
      track: col((i) => [-6.2 + i * 1e-5 * 1.234567, 106.8 + i * 1e-5 * 1.234567] as [number, number]),
    },
    splits: [{ n: 1, distM: 1000, sec: 330, paceSecKm: 330, hr: 150, gainM: 3, lossM: 2, cad: 170 }],
    laps: [{ n: 1, startSec: 0, sec: 900, distM: 2500, paceSecKm: 360, avgHr: 150, maxHr: 170, avgCad: 170, gainM: 5 }],
    hrZones: { maxHr: 190, source: 'age', bounds: [95, 114, 133, 152, 171, 190], sec: [0, 100, 900, 600, 100], belowSec: 100 },
    paceZones: null,
    bestEfforts: [],
    effort: { strain: 9.4, trimp: 80, band: 'moderate', addedToDay: 4 },
    load: { trimp: 80, acute: 200, chronicWeekly: 180, ratio: 1.1, watchLoad: null, aerobicEffect: null, anaerobicEffect: null, recoveryHours: null },
    calories: { kcal: 320, fatG: 10, carbG: 30 },
    comparison: { basis: 'distance', items: [{ startedAt: START * 1000 - 86_400_000, distM: 5100, sec: 1800, paceSecKm: 350, avgHr: 148, gainM: 12 }] },
    stats: {
      avgHr: 150, maxHr: 170, minHr: 100, avgPaceSecKm: 330, bestPaceSecKm: 300, avgSpeedMs: 3, maxSpeedMs: 4,
      avgCad: 170, maxCad: 180, avgPower: null, maxPower: null, normalizedPower: null, avgStrideM: 1,
    },
    ...over,
  };
}

const ALL = { includeHr: true, includeRoute: true, includeComparison: true };

describe('shareableAnalysis', () => {
  test('everything on keeps the analysis as it is', () => {
    const full = analysis();
    expect(shareableAnalysis(full, ALL)).toEqual(full);
  });

  test('route off drops only the track', () => {
    const out = shareableAnalysis(analysis(), { ...ALL, includeRoute: false });
    expect(out.series?.track).toBeNull();
    expect(out.series?.hr).not.toBeNull();
    expect(out.series?.dist).not.toBeNull();
  });

  test('heart rate off removes it and everything derived from it', () => {
    const out = shareableAnalysis(analysis(), { ...ALL, includeHr: false });
    expect(out.series?.hr).toBeNull();
    expect(out.hrZones).toBeNull();
    expect(out.effort).toBeNull();
    expect(out.load).toBeNull();
    expect(out.stats).toMatchObject({ avgHr: null, maxHr: null, minHr: null, avgPaceSecKm: 330 });
    expect(out.splits[0]).toMatchObject({ hr: null, paceSecKm: 330 });
    expect(out.laps[0]).toMatchObject({ avgHr: null, maxHr: null, avgCad: 170 });
    expect(out.comparison?.items[0]?.avgHr).toBeNull();
    expect(out.comparison?.items[0]?.paceSecKm).toBe(350);
  });

  test('comparison off drops it', () => {
    expect(shareableAnalysis(analysis(), { ...ALL, includeComparison: false }).comparison).toBeNull();
  });

  test('does not modify its input', () => {
    const full = analysis();
    const copy = JSON.stringify(full);
    shareableAnalysis(full, { includeHr: false, includeRoute: false, includeComparison: false });
    expect(JSON.stringify(full)).toBe(copy);
  });

  test('an analysis without a series passes through', () => {
    expect(shareableAnalysis(analysis(6, { series: null }), ALL).series).toBeNull();
  });

  test('an oversized analysis is thinned under 190 KB and stays consistent', () => {
    const big = analysis(720);
    big.splits = Array.from({ length: 250 }, (_, i) => ({ n: i + 1, distM: 1000, sec: 330 + Math.sin(i), paceSecKm: 330 + Math.sin(i * 2), hr: 150 + Math.sin(i * 3), gainM: 3 + Math.sin(i * 4), lossM: 2 + Math.sin(i * 5), cad: 170 + Math.sin(i * 6) }));
    big.laps = Array.from({ length: 300 }, (_, i) => ({ n: i + 1, startSec: i, sec: 60 + Math.sin(i), distM: 200 + Math.sin(i * 2), paceSecKm: 330 + Math.sin(i * 3), avgHr: 150 + Math.sin(i * 4), maxHr: 170 + Math.sin(i * 5), avgCad: 170 + Math.sin(i * 6), gainM: 5 + Math.sin(i * 7) }));
    // Make the series itself heavy: long floats everywhere.
    const noisy = (i: number) => 100 + Math.sin(i) * 31.123456789012345;
    big.series!.hr = Array.from({ length: 720 }, (_, i) => noisy(i));
    big.series!.pace = Array.from({ length: 720 }, (_, i) => noisy(i) * 3);
    big.series!.alt = Array.from({ length: 720 }, (_, i) => noisy(i) / 3);
    big.series!.cad = Array.from({ length: 720 }, (_, i) => noisy(i) / 2);
    big.series!.power = Array.from({ length: 720 }, (_, i) => noisy(i) * 2);
    big.series!.dist = Array.from({ length: 720 }, (_, i) => i * 7 + Math.abs(Math.sin(i)) / 3);
    big.series!.track = Array.from({ length: 720 }, (_, i) => [-6.123456789012345 + Math.sin(i) * 1e-3, 106.123456789012345 + Math.cos(i) * 1e-3] as [number, number]);
    expect(JSON.stringify(big).length).toBeGreaterThan(190_000);
    const out = shareableAnalysis(big, ALL);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(190_000);
    const s = out.series!;
    expect(s.n).toBeLessThan(720);
    for (const key of ['dist', 'hr', 'pace', 'alt', 'cad', 'power', 'track'] as const) expect(s[key]).toHaveLength(s.n);
    expect(s.stepSec).toBeLessThanOrEqual(600);
  });
});

describe('thinAnalysis', () => {
  test('halves the grid, doubles the step and rounds GPS to 4 decimals', () => {
    const out = thinAnalysis(analysis(7));
    expect(out.series?.n).toBe(4);
    expect(out.series?.stepSec).toBe(600);
    expect(out.series?.hr).toHaveLength(4);
    expect(out.series?.power).toBeNull();
    expect(out.series?.track?.[0]).toEqual([-6.2, 106.8]);
  });

  test('keeps the series length when it cannot be halved', () => {
    const base = analysis(3);
    expect(thinAnalysis(base).series?.n).toBe(3);
  });
});

describe('buildWatchPost with an analysis', () => {
  const options = { caption: '', visibility: 'grup' as const, includeHr: true, includeRoute: true, includeComparison: true };

  test('sends the analysis alone as the detail', () => {
    const post = buildWatchPost(workout(), [...hrPoints(60), ...fixes(10)], options, analysis());
    expect(post.detail?.analysis?.series?.track).not.toBeNull();
    expect(post.detail?.hr).toBeUndefined();
    expect(post.detail?.route).toBeUndefined();
  });

  test('applies the privacy switches to the analysis', () => {
    const post = buildWatchPost(workout(), [], { ...options, includeHr: false, includeRoute: false, includeComparison: false }, analysis());
    expect(post.detail?.analysis).toMatchObject({ hrZones: null, comparison: null, series: { track: null, hr: null } });
  });

  test('the map switch becomes showMap next to the analysis, whose track goes only while it is on', () => {
    const on = buildWatchPost(workout(), [], options, analysis());
    expect(on.showMap).toBe(true);
    expect(on.detail?.analysis?.series?.track).not.toBeNull();
    const off = buildWatchPost(workout(), [], { ...options, includeRoute: false }, analysis());
    expect(off.showMap).toBe(false);
    expect(off.detail?.analysis?.series?.track).toBeNull();
  });

  test('aligns durationMin with the analysis when the server would reject the gap', () => {
    const post = buildWatchPost(workout({ duration: 1200 }), [], options, analysis());
    expect(post.workout.durationMin).toBe(30);
    expect(post.detail?.analysis).toBeDefined();
  });

  test('falls back to the legacy detail when the analysis starts at another time', () => {
    const post = buildWatchPost(workout(), [...hrPoints(60), ...fixes(10)], options, analysis(6, { startedAt: START * 1000 + 5000 }));
    expect(post.detail?.analysis).toBeUndefined();
    expect(post.detail?.hr?.bpm.length).toBeGreaterThan(0);
  });
});

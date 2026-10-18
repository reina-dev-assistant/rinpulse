import { afterEach, describe, expect, test } from 'bun:test';
import type { WorkoutRow } from '@/db/queries';
import { applyLocale } from '@/i18n';
import type { RoutePoint, WorkoutSummary } from '@/features/workouts/summary';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';
import { buildRunSubject, type RunSubjectInput } from './run';

afterEach(() => applyLocale('id'));

const START = 1_760_000_000;

function workout(over: Partial<WorkoutRow> = {}): WorkoutRow {
  return {
    id: 1,
    workoutNumber: 1,
    start: START,
    end: START + 1900,
    sportType: 1,
    sportName: 'Running',
    duration: 1832,
    distance: 5020,
    calories: 320,
    avgHr: 152,
    maxHr: 178,
    steps: 5400,
    complete: true,
    imported: false,
    ...over,
  };
}

function analysis(over: Partial<WorkoutAnalysis> = {}): WorkoutAnalysis {
  const n = 100;
  const ramp = (f: (i: number) => number | null) => Array.from({ length: n }, (_, i) => f(i));
  return {
    v: 1,
    sport: { name: 'Running', kind: 'run' },
    startedAt: START * 1000,
    elapsedSec: 1900,
    movingSec: 1832,
    distanceM: 5020,
    elevation: { gainM: 42.4, lossM: 40, minM: 10, maxM: 60 },
    series: {
      stepSec: 18,
      n,
      dist: null,
      hr: ramp((i) => (i % 10 === 3 ? null : 120 + i)),
      pace: ramp((i) => (i % 7 === 0 ? null : 330 + (i % 5))),
      alt: ramp((i) => 20 + Math.sin(i / 10) * 10),
      cad: null,
      power: null,
      track: null,
    },
    splits: [1, 2, 3, 4, 5].map((k) => ({ n: k, distM: 1000, sec: 360 - k * 5, paceSecKm: 360 - k * 5, hr: 150, gainM: 1, lossM: 1, cad: 170 })),
    laps: [],
    hrZones: { maxHr: 190, source: 'age', bounds: [95, 114, 133, 152, 171, 190], sec: [60, 300, 800, 500, 100], belowSec: 0 },
    paceZones: null,
    bestEfforts: [
      { key: '1k', sec: 330, atM: 0, rank: 1 },
      { key: '5k', sec: 1700, atM: 0, rank: 1 },
      { key: '10k', sec: 3500, atM: 0, rank: 2 },
    ],
    effort: { strain: 11.46, trimp: 90, band: 'moderate', addedToDay: null },
    load: null,
    calories: null,
    comparison: null,
    stats: { avgHr: 152, maxHr: 178, minHr: 90, avgPaceSecKm: 365, bestPaceSecKm: 300, avgSpeedMs: 2.7, maxSpeedMs: 4, avgCad: 168.4, maxCad: 190, avgPower: null, maxPower: null, normalizedPower: null, avgStrideM: null },
    ...over,
  };
}

const route2: RoutePoint[] = [
  { lat: -6.2, lon: 106.8 },
  { lat: -6.21, lon: 106.81 },
];

function input(over: Partial<RunSubjectInput> = {}): RunSubjectInput {
  return { workout: workout(), summary: {}, analysis: analysis(), route: route2, gearLine: 'Nike Pegasus', ...over };
}

interface RunOut {
  [key: string]: unknown;
  sport?: string;
  kind?: string;
  hrZonePct: number[];
  hrSeries: number[];
  paceSeries: number[];
  altSeries: number[];
  gear: string;
  route: number[][];
  splitKmh: number[];
  splitLabels: string[];
}

function runOf(i: RunSubjectInput, locale: 'id' | 'en' = 'id') {
  const s = buildRunSubject(i, locale);
  return { s, run: s.data.run as unknown as RunOut };
}

function allFinite(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(allFinite);
  if (v && typeof v === 'object') return Object.values(v).every(allFinite);
  return true;
}

describe('buildRunSubject', () => {
  test('full run with analysis', () => {
    const { s, run } = runOf(input());
    expect(s.id).toBe(`run:${START}`);
    expect(s.date).toBe(START * 1000);
    expect(s.kinds).toEqual(['run', 'badge']);
    expect(run.kind).toBe('run');
    expect(run.sport).toBe('Lari');
    expect(run.movingSec).toBe(1832);
    expect(run.elapsedSec).toBe(1900);
    expect(run.distanceM).toBe(5020);
    expect(run.paceSecKm).toBe(Math.round(1000 / (5020 / 1832)));
    expect(run.hrAvg).toBe(152);
    expect(run.hrMax).toBe(178);
    expect(run.kcal).toBe(320);
    expect(run.elevGainM).toBe(42);
    expect(run.cadence).toBe(168);
    expect(run.steps).toBe(5400);
    expect(run.route).toEqual([[-6.2, 106.8], [-6.21, 106.81]]);
    expect(run.splitKmh).toHaveLength(5);
    expect(run.splitLabels).toEqual(['1', '2', '3', '4', '5']);
    expect(run.splitFastest).toBe(4);
    expect(run.hrZoneSec).toEqual([60, 300, 800, 500, 100]);
    expect(run.hrZonePct.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(1);
    expect(run.hrZoneLabels).toEqual(['Z1', 'Z2', 'Z3', 'Z4', 'Z5']);
    expect(run.hrZoneColors).toHaveLength(5);
    expect(run.hrZoneTop).toBe(3);
    expect(run.hrSeries.length).toBeLessThanOrEqual(48);
    expect(run.paceSeries.length).toBeLessThanOrEqual(48);
    expect(run.altSeries.length).toBeLessThanOrEqual(48);
    expect(run.strain).toBe(11.5);
    expect(run.strainPct).toBeCloseTo(11.5 / 21);
    expect(run.effortLabel).toBe('Sedang');
    expect(run.prLabel).toBe('10K tercepat'.replace('10K', '5K'));
    expect(run.prTime).toBe(1700);
    expect(run.prCount).toBe(2);
    expect(run.gear).toBe('Nike Pegasus');
    expect(s.data.milestone).toEqual({ kind: 'pr', title: '5K tercepat', subtitle: 'Terbaik dalam 120 hari terakhir', value: 1700, valueText: '28:20' });
    expect(s.heading).toBe('Bagikan latihan');
    expect(s.caption).toContain('JoyoFit');
    expect(allFinite(s.data)).toBe(true);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  test('english labels', () => {
    const { s, run } = runOf(input(), 'en');
    expect(run.prLabel).toBe('Fastest 5K');
    expect(run.effortLabel).toBe('Moderate');
    expect((s.data.milestone as { subtitle: string }).subtitle).toBe('Best in the last 120 days');
    expect(s.heading).toBe('Share workout');
  });

  test('without analysis falls back to summary', () => {
    const summary: WorkoutSummary = {
      avgCadence: 160,
      elevationGain: 12,
      paceBlocks: [
        { type: 0, distance: 1, correction: null, pace: 360 },
        { type: 0, distance: 2, correction: null, pace: 340 },
        { type: 0, distance: 3, correction: 5000, pace: 300 },
      ],
    };
    const { s, run } = runOf(input({ analysis: null, summary }));
    expect(s.kinds).toEqual(['run']);
    expect(s.data.milestone).toBeUndefined();
    expect(run.kind).toBe('run');
    expect(run.splitKmh).toHaveLength(2);
    expect(run.splitFastest).toBe(1);
    expect(run.cadence).toBe(160);
    expect(run.elevGainM).toBe(12);
    for (const k of ['hrZoneSec', 'hrSeries', 'paceSeries', 'altSeries', 'strain', 'effortLabel', 'prLabel', 'prCount']) {
      expect(k in run).toBe(false);
    }
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  test('indoor treadmill has no route and no distance when 0', () => {
    const { run } = runOf(input({ workout: workout({ sportName: 'Indoor Running', distance: 0, steps: 0 }), route: [], analysis: null }));
    expect('route' in run).toBe(false);
    expect('distanceM' in run).toBe(false);
    expect('paceSecKm' in run).toBe(false);
    expect(run.movingSec).toBe(1832);
  });

  test('ride reports speed, not pace', () => {
    const { run } = runOf(input({ workout: workout({ sportName: 'Cycling', distance: 20000, duration: 3000, end: START + 3000 }), analysis: null }));
    expect(run.kind).toBe('ride');
    expect(run.speedKmh).toBe(24);
    expect('paceSecKm' in run).toBe(false);
    expect('pace100Sec' in run).toBe(false);
  });

  test('swim reports pace per 100 m', () => {
    const { run } = runOf(input({ workout: workout({ sportName: 'Swimming', distance: 1000, duration: 1500, end: START + 1500 }), analysis: null }));
    expect(run.kind).toBe('swim');
    expect(run.pace100Sec).toBe(150);
    expect('paceSecKm' in run).toBe(false);
    expect('speedKmh' in run).toBe(false);
  });

  test('workout without heart rate', () => {
    const a = analysis({ hrZones: null, stats: { ...analysis().stats, avgHr: null, maxHr: null } });
    a.series!.hr = null;
    const { run } = runOf(input({ workout: workout({ avgHr: null, maxHr: null }), analysis: a }));
    for (const k of ['hrAvg', 'hrMax', 'hrZoneSec', 'hrZonePct', 'hrSeries']) expect(k in run).toBe(false);
  });

  test('hr series dropped when mostly empty', () => {
    const a = analysis();
    a.series!.hr = a.series!.hr!.map((v, i) => (i < 5 ? v : null));
    expect('hrSeries' in runOf(input({ analysis: a })).run).toBe(false);
  });

  test('flat altitude omitted', () => {
    const a = analysis();
    a.series!.alt = a.series!.alt!.map(() => 30);
    expect('altSeries' in runOf(input({ analysis: a })).run).toBe(false);
  });

  test('route with one point is omitted', () => {
    expect('route' in runOf(input({ route: [{ lat: 1, lon: 2 }] })).run).toBe(false);
  });

  test('5000 point route is downsampled keeping ends', () => {
    const route = Array.from({ length: 5000 }, (_, i) => ({ lat: i / 1000, lon: i / 500 }));
    const r = runOf(input({ route })).run.route;
    expect(r.length).toBeLessThanOrEqual(500);
    expect(r[0]).toEqual([0, 0]);
    expect(r[r.length - 1]).toEqual([4.999, 9.998]);
  });

  test('splits are capped at 60 keeping first and last', () => {
    const splits = Array.from({ length: 100 }, (_, i) => ({ n: i + 1, distM: 1000, sec: 300, paceSecKm: 300 + i, hr: null, gainM: null, lossM: null, cad: null }));
    const { run } = runOf(input({ analysis: analysis({ splits }) }));
    expect(run.splitKmh).toHaveLength(60);
    expect(run.splitLabels).toHaveLength(60);
    expect(run.splitLabels[0]).toBe('1');
    expect(run.splitLabels[59]).toBe('100');
    expect(run.splitFastest).toBe(0);
  });

  test('a short last split is not a whole-km split', () => {
    const splits = [
      { n: 1, distM: 1000, sec: 300, paceSecKm: 300, hr: null, gainM: null, lossM: null, cad: null },
      { n: 2, distM: 1000, sec: 300, paceSecKm: 310, hr: null, gainM: null, lossM: null, cad: null },
      { n: 3, distM: 20, sec: 6, paceSecKm: 300, hr: null, gainM: null, lossM: null, cad: null },
    ];
    expect(runOf(input({ analysis: analysis({ splits }) })).run.splitKmh).toHaveLength(2);
  });

  test('NaN and Infinity inputs never leak', () => {
    const a = analysis({
      effort: { strain: Number.NaN, trimp: 0, band: 'hard', addedToDay: null },
      elevation: { gainM: Number.POSITIVE_INFINITY, lossM: 0, minM: 0, maxM: 0 },
    });
    a.series!.hr = a.series!.hr!.map((v, i) => (i === 50 ? Number.NaN : v));
    a.bestEfforts = [{ key: '5k', sec: Number.POSITIVE_INFINITY, atM: 0, rank: 1 }];
    const i = input({
      analysis: a,
      summary: { elevationGain: Number.NaN, avgSpeed: Number.NaN },
      workout: workout({ calories: Number.NaN, avgHr: Number.NaN }),
      route: [{ lat: Number.NaN, lon: 1 }, ...route2],
    });
    const { s, run } = runOf(i);
    expect(allFinite(s.data)).toBe(true);
    expect('strain' in run).toBe(false);
    expect(s.kinds).toEqual(['run']);
    expect(run.route).toHaveLength(2);
    expect(run.hrAvg).toBe(152);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  test('long and emoji text', () => {
    const { run } = runOf(input({ gearLine: `  ${'x'.repeat(100)}  ` }));
    expect(run.gear).toHaveLength(60);
    expect(run.gear.endsWith('...')).toBe(true);
    expect(runOf(input({ gearLine: 'Shoes 👟' })).run.gear).toBe('Shoes 👟');
    expect('gear' in runOf(input({ gearLine: '   ' })).run).toBe(false);
    expect(runOf(input({ workout: workout({ sportName: 'Zumba 💃' }) })).run.sport).toBe('Zumba 💃');
  });

  test('elapsed shown only when a pause of a minute or more', () => {
    const { run } = runOf(input({ workout: workout({ end: START + 2000, duration: 1800 }) }));
    expect(run.movingSec).toBe(1800);
    expect(run.elapsedSec).toBe(2000);
  });
});

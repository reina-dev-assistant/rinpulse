import { describe, expect, it } from 'bun:test';

import { applyLocale, getT } from '@/i18n';

import type { AnalysisSeries, AnalysisSplit } from '../types';
import {
  availableMetrics,
  axisMaxOf,
  axisTicks,
  buildPaths,
  chartGeometry,
  comparisonAverage,
  difference,
  distanceParts,
  fastestIndex,
  formatAxisTick,
  formatYTick,
  hrGradientStops,
  indexFromX,
  kcalPerHour,
  loadBarFractions,
  loadVerdict,
  metricDomain,
  metricValues,
  niceTicks,
  paceBarFractions,
  percentile,
  rankBadge,
  readoutAt,
  shares,
  signedDuration,
  signedNumber,
  splitAtIndex,
  splitEndIndices,
  splitLabel,
  strainFraction,
  xFromIndex,
  yPosition,
} from './chartMath';
import { createScrubStore } from './scrub';
import { makeAnalysisT } from './text';

/** 11 samples, 5 s apart, 10 m per sample, so distance 0..100 m. */
function series(over: Partial<AnalysisSeries> = {}): AnalysisSeries {
  const n = 11;
  const ramp = (f: (i: number) => number | null) => Array.from({ length: n }, (_, i) => f(i));
  return {
    stepSec: 5,
    n,
    dist: ramp((i) => i * 10),
    hr: ramp((i) => 120 + i * 4),
    pace: ramp((i) => 300 + i * 2),
    alt: ramp((i) => 20 + Math.sin(i) * 5),
    cad: null,
    power: null,
    track: null,
    ...over,
  };
}

describe('percentile', () => {
  it('interpolates between sorted values', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([0, 10], 0.25)).toBe(2.5);
    expect(percentile([7], 0.9)).toBe(7);
    expect(percentile([1, 2, 3], 0)).toBe(1);
    expect(percentile([1, 2, 3], 1)).toBe(3);
    expect(percentile([], 0.5)).toBeNaN();
  });
});

describe('metricValues and availableMetrics', () => {
  it('derives speed in km/h from pace', () => {
    const s = series({ pace: [360, null, 300, 300, 300, 300, 300, 300, 300, 300, 300] });
    const speed = metricValues(s, 'speed')!;
    expect(speed[0]).toBeCloseTo(10, 6);
    expect(speed[1]).toBeNull();
    expect(speed[2]).toBeCloseTo(12, 6);
  });

  it('offers pace for runs, speed for rides, only series that exist', () => {
    const s = series({ cad: Array.from({ length: 11 }, () => 170), power: null });
    // Step length rides along on foot: pace and cadence give it. A ride has cadence in rpm, never a step length.
    expect(availableMetrics(s, 'run')).toEqual(['pace', 'hr', 'alt', 'cad', 'stride']);
    expect(availableMetrics(s, 'ride')).toEqual(['speed', 'hr', 'alt', 'cad']);
    expect(availableMetrics(s, 'swim')).toEqual(['hr', 'alt', 'cad']);
    expect(availableMetrics(series({ pace: null, hr: null, alt: null }), 'run')).toEqual([]);
    expect(availableMetrics(series({ n: 1 }), 'run')).toEqual([]);
  });
});

describe('step length metric', () => {
  it('is speed over steps per second per sample, a gap where either is missing', () => {
    // 300 s/km is 3.33 m/s; at 170 steps per minute a step is 1.176 m.
    const s = series({ cad: Array.from({ length: 11 }, (_, i) => (i === 4 ? null : 170)), pace: Array.from({ length: 11 }, () => 300) });
    const v = metricValues(s, 'stride')!;
    expect(v[0]).toBeCloseTo(1.176, 3);
    expect(v[4]).toBeNull();
    expect(readoutAt(s, 2).stride).toBeCloseTo(1.176, 3);
    expect(readoutAt(s, 4).stride).toBeNull();
  });

  it('prefers the measured series and hides the chip without cadence or pace', () => {
    const measured = series({ stride: Array.from({ length: 11 }, () => 0.9), cad: Array.from({ length: 11 }, () => 170) });
    expect(metricValues(measured, 'stride')!.every((x) => x === 0.9)).toBe(true);
    expect(availableMetrics(series({ cad: null }), 'run')).not.toContain('stride');
    expect(availableMetrics(series({ cad: Array.from({ length: 11 }, () => 170), pace: null }), 'run')).not.toContain('stride');
    expect(availableMetrics(series({ cad: Array.from({ length: 11 }, () => 80) }), 'ride')).not.toContain('stride');
  });
});

describe('metricDomain', () => {
  it('clips pace to p5 to p95 and inverts so fast is on top', () => {
    const values = [...Array.from({ length: 98 }, () => 300), 120, 900];
    const d = metricDomain('pace', values)!;
    expect(d.invert).toBe(true);
    // The two outliers fall outside p5..p95 and do not stretch the axis.
    expect(d.min).toBeGreaterThan(200);
    expect(d.max).toBeLessThan(400);
    expect(d.min).toBeLessThan(300);
    expect(d.max).toBeGreaterThan(300);
  });

  it('keeps a flat series at a minimum span and never below zero', () => {
    const d = metricDomain('hr', [150, 150, 150])!;
    expect(d.max - d.min).toBeGreaterThanOrEqual(20);
    const low = metricDomain('power', [0, 0, 5])!;
    expect(low.min).toBeGreaterThanOrEqual(0);
  });

  it('lets elevation go negative and returns null without data', () => {
    expect(metricDomain('alt', [-10, -5, -8])!.min).toBeLessThan(-10);
    expect(metricDomain('hr', [null, null])).toBeNull();
  });
});

describe('yPosition', () => {
  const plain = { min: 100, max: 200, invert: false };
  it('puts high values on top and clamps outliers to the edge', () => {
    expect(yPosition(200, plain, 10, 100)).toBe(10);
    expect(yPosition(100, plain, 10, 100)).toBe(110);
    expect(yPosition(150, plain, 10, 100)).toBe(60);
    expect(yPosition(900, plain, 10, 100)).toBe(10);
    expect(yPosition(0, plain, 10, 100)).toBe(110);
  });
  it('puts the smallest value on top when inverted (pace)', () => {
    const inv = { min: 240, max: 360, invert: true };
    expect(yPosition(240, inv, 0, 120)).toBe(0);
    expect(yPosition(360, inv, 0, 120)).toBe(120);
  });
});

describe('ticks', () => {
  it('picks 1-2-5 steps inside the range', () => {
    expect(niceTicks(0, 100, 3)).toEqual([0, 50, 100]);
    expect(niceTicks(112, 188, 3)).toEqual([120, 140, 160, 180]);
    expect(niceTicks(3, 37, 3)).toEqual([10, 20, 30]);
  });
  it('steps pace in seconds on round values', () => {
    expect(niceTicks(272, 358, 3, [5, 10, 15, 20, 30, 60])).toEqual([300, 330]);
    expect(niceTicks(250, 262, 3, [5, 10, 15, 20, 30, 60])).toEqual([250, 255, 260]);
    expect(formatYTick('pace', 300)).toBe('5:00');
    expect(formatYTick('hr', 151.6)).toBe('152');
  });
  it('degenerate ranges give no ticks', () => {
    expect(niceTicks(5, 5, 3)).toEqual([]);
    expect(niceTicks(9, 3, 3)).toEqual([]);
  });
  it('axis ticks stay within the axis and the cap', () => {
    const d = axisTicks(8352, true, 5);
    expect(d.length).toBeLessThanOrEqual(5);
    expect(d.every((v) => v > 0 && v <= 8352)).toBe(true);
    expect(d[0]).toBe(2000);
    const time = axisTicks(2761, false, 5);
    expect(time.length).toBeLessThanOrEqual(5);
    expect(time[0]).toBe(600);
    expect(axisTicks(0, true, 5)).toEqual([]);
  });
  it('formats axis ticks', () => {
    expect(formatAxisTick(2500, true)).toBe('2,5 km');
    expect(formatAxisTick(2000, true)).toBe('2 km');
    expect(formatAxisTick(600, false)).toBe('10:00');
  });
});

describe('axis and scrub index', () => {
  const s = series();
  it('maps index to pixels and back', () => {
    expect(axisMaxOf(s)).toBe(100);
    expect(xFromIndex(s, 0, 6, 200)).toBe(6);
    expect(xFromIndex(s, 10, 6, 200)).toBe(206);
    expect(xFromIndex(s, 5, 6, 200)).toBe(106);
    expect(indexFromX(s, 106, 6, 200)).toBe(5);
    expect(indexFromX(s, -50, 6, 200)).toBe(0);
    expect(indexFromX(s, 999, 6, 200)).toBe(10);
  });
  it('uses time when there is no distance', () => {
    const t = series({ dist: null });
    expect(axisMaxOf(t)).toBe(50);
    expect(indexFromX(t, 106, 6, 200)).toBe(5);
  });
});

describe('buildPaths', () => {
  it('splits runs at gaps and closes the area to the baseline', () => {
    const { line, area } = buildPaths([0, 1, 2, 3, 4], [10, 20, null, 30, 40], 50);
    expect(line).toBe('M0 10L1 20M3 30L4 40');
    expect(area).toBe('M0 10L1 20L1 50L0 50ZM3 30L4 40L4 50L3 50Z');
  });
  it('drops single isolated points', () => {
    expect(buildPaths([0, 1, 2], [null, 5, null], 9)).toEqual({ line: '', area: '' });
  });
});

describe('chartGeometry', () => {
  it('lays out samples across the plot and keeps pace fast-on-top', () => {
    const g = chartGeometry(series(), 'pace', { width: 320, height: 176, padX: 6, padTop: 12, padBottom: 22 })!;
    expect(g.plot).toEqual({ left: 6, top: 12, width: 308, height: 142 });
    expect(g.xs[0]).toBe(6);
    expect(g.xs[10]).toBe(314);
    // Pace rises (slower) along the series, so y grows (moves down) too.
    expect(g.ys[10]!).toBeGreaterThan(g.ys[0]!);
    expect(g.isDistance).toBe(true);
    expect(g.yTicks.length).toBeGreaterThan(0);
    expect(g.line.startsWith('M6')).toBe(true);
  });
  it('skips ticks for the compact strip and returns null for a missing metric', () => {
    const g = chartGeometry(series(), 'alt', { width: 200, height: 52, padX: 6, padTop: 4, padBottom: 4, compact: true })!;
    expect(g.yTicks).toEqual([]);
    expect(g.xTicks).toEqual([]);
    expect(chartGeometry(series(), 'power', { width: 200, height: 52, padX: 6, padTop: 4, padBottom: 4 })).toBeNull();
  });
});

describe('hrGradientStops', () => {
  it('paints hard zone edges from the top (zone 5) to the bottom (zone 1)', () => {
    const colors = ['z1', 'z2', 'z3', 'z4', 'z5'];
    const stops = hrGradientStops([100, 120, 140, 160, 180, 200], colors, { min: 100, max: 200, invert: false });
    expect(stops).toHaveLength(10);
    expect(stops[0]).toEqual({ offset: 0, color: 'z5' });
    expect(stops[1]).toEqual({ offset: 0.2, color: 'z5' });
    expect(stops[2]).toEqual({ offset: 0.2, color: 'z4' });
    expect(stops[9]).toEqual({ offset: 1, color: 'z1' });
    const offsets = stops.map((s) => s.offset);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });
});

describe('hrGradientStops with six zones (reserve method)', () => {
  it('paints every zone, Z6 at the top', () => {
    const colors = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6'];
    const stops = hrGradientStops([100, 120, 140, 160, 180, 190, 200], colors, { min: 100, max: 200, invert: false });
    expect(stops).toHaveLength(12);
    expect(stops[0]).toEqual({ offset: 0, color: 'z6' });
    expect(stops[1]).toEqual({ offset: 0.1, color: 'z6' });
    expect(stops[11]).toEqual({ offset: 1, color: 'z1' });
  });
});

describe('readoutAt', () => {
  it('collects every metric at an index and clamps it', () => {
    const s = series({ cad: Array.from({ length: 11 }, () => 168), power: null });
    const r = readoutAt(s, 4);
    expect(r.distM).toBe(40);
    expect(r.sec).toBe(20);
    expect(r.pace).toBe(308);
    expect(r.speedKmh).toBeCloseTo(3600 / 308, 6);
    expect(r.hr).toBe(136);
    expect(r.cad).toBe(168);
    expect(r.power).toBeNull();
    expect(readoutAt(s, 99).index).toBe(10);
    expect(readoutAt(s, -3).index).toBe(0);
  });
  it('reports null for gaps and a missing distance', () => {
    const s = series({ dist: null, pace: [null, ...Array.from({ length: 10 }, () => 300)] });
    const r = readoutAt(s, 0);
    expect(r.pace).toBeNull();
    expect(r.speedKmh).toBeNull();
    expect(r.distM).toBeNull();
  });
});

describe('bars', () => {
  it('shares sum to one and handle an empty total', () => {
    expect(shares([30, 60, 10])).toEqual([0.3, 0.6, 0.1]);
    expect(shares([0, 0])).toEqual([0, 0]);
  });

  it('scales pace bars between the fastest (full) and the slowest (30 percent)', () => {
    const f = paceBarFractions([300, 330, 360, null]);
    expect(f[0]).toBe(1);
    expect(f[2]).toBeCloseTo(0.3, 6);
    expect(f[1]).toBeCloseTo(0.65, 6);
    expect(f[3]).toBe(0);
    expect(paceBarFractions([300, 300])).toEqual([1, 1]);
    expect(paceBarFractions([null])).toEqual([0]);
    expect(fastestIndex([310, 295, null, 320])).toBe(1);
    expect(fastestIndex([null])).toBe(-1);
  });

  it('judges load by the acute to chronic ratio', () => {
    expect(loadVerdict(0.79)).toBe('under');
    expect(loadVerdict(0.8)).toBe('steady');
    expect(loadVerdict(1.3)).toBe('steady');
    expect(loadVerdict(1.31)).toBe('high');
    expect(loadVerdict(1.5)).toBe('high');
    expect(loadVerdict(1.52)).toBe('spike');
    expect(loadBarFractions(686.6, 450.4).acute).toBe(1);
    expect(loadBarFractions(200, 400)).toEqual({ acute: 0.5, chronic: 1 });
    expect(loadBarFractions(0, 0)).toEqual({ acute: 0, chronic: 0 });
  });

  it('badges the top three efforts', () => {
    expect([1, 2, 3, 4, null].map(rankBadge)).toEqual(['pr', '2nd', '3rd', null, null]);
  });

  it('fills the strain ring out of 21', () => {
    expect(strainFraction(10.5)).toBe(0.5);
    expect(strainFraction(30)).toBe(1);
    expect(strainFraction(-1)).toBe(0);
  });
});

describe('splits', () => {
  const splits: AnalysisSplit[] = [
    { n: 1, distM: 1000, sec: 300, paceSecKm: 300, hr: null, gainM: null, lossM: null, cad: null },
    { n: 2, distM: 1000, sec: 300, paceSecKm: 300, hr: null, gainM: null, lossM: null, cad: null },
    { n: 3, distM: 420, sec: 130, paceSecKm: 309, hr: null, gainM: null, lossM: null, cad: null },
  ];
  // 2420 m over 242 samples at 10 m each
  const s: AnalysisSeries = {
    stepSec: 5,
    n: 243,
    dist: Array.from({ length: 243 }, (_, i) => i * 10),
    hr: null,
    pace: null,
    alt: null,
    cad: null,
    power: null,
    track: null,
  };

  it('labels full splits by number and the partial one by its distance', () => {
    expect(splitLabel(splits[0]!)).toBe('1');
    expect(splitLabel(splits[2]!)).toBe('0,42 km');
  });

  it('ends each split at the sample nearest its cumulative distance, the last at the final sample', () => {
    expect(splitEndIndices(s, splits)).toEqual([100, 200, 242]);
    expect(splitEndIndices({ ...s, dist: null }, splits)).toEqual([]);
  });

  it('finds the split under a scrub index', () => {
    const ends = [100, 200, 242];
    expect(splitAtIndex(ends, null)).toBe(-1);
    expect(splitAtIndex(ends, 0)).toBe(0);
    expect(splitAtIndex(ends, 100)).toBe(0);
    expect(splitAtIndex(ends, 101)).toBe(1);
    expect(splitAtIndex(ends, 242)).toBe(2);
    expect(splitAtIndex([], 5)).toBe(-1);
  });
});

describe('formatting helpers', () => {
  it('splits a distance into value and unit', () => {
    expect(distanceParts(8352)).toEqual({ value: '8,35', unit: 'km' });
    expect(distanceParts(640.4)).toEqual({ value: '640', unit: 'm' });
  });
  it('computes kcal per hour', () => {
    expect(kcalPerHour(612, 2761)).toBe(798);
    expect(kcalPerHour(100, 0)).toBeNull();
  });
  it('signs durations and numbers', () => {
    expect(signedDuration(17)).toBe('+0:17');
    expect(signedDuration(-65)).toBe('-1:05');
    expect(signedDuration(0.2)).toBe('0:00');
    expect(signedNumber(0.25, 2)).toBe('+0,25');
    expect(signedNumber(-3, 0)).toBe('-3');
    expect(signedNumber(0.001, 2)).toBe('0,00');
  });
  it('averages comparison items ignoring missing values', () => {
    const avg = comparisonAverage([
      { startedAt: 1, distM: 8000, sec: 2700, paceSecKm: 340, avgHr: 150, gainM: null },
      { startedAt: 2, distM: null, sec: 2900, paceSecKm: null, avgHr: 154, gainM: null },
    ])!;
    expect(avg.distM).toBe(8000);
    expect(avg.sec).toBe(2800);
    expect(avg.paceSecKm).toBe(340);
    expect(avg.avgHr).toBe(152);
    expect(comparisonAverage([])).toBeNull();
    expect(difference(5, 3)).toBe(2);
    expect(difference(null, 3)).toBeNull();
  });
});

describe('scrub store', () => {
  it('notifies only on change and unsubscribes', () => {
    const store = createScrubStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.set(3);
    store.set(3);
    store.set(null);
    expect(calls).toBe(2);
    expect(store.get()).toBeNull();
    off();
    store.set(9);
    expect(calls).toBe(2);
  });
});

describe('Analysis text', () => {
  it('interpolates placeholders in the default language (Indonesian)', () => {
    const t = makeAnalysisT(getT('id'));
    expect(t('zones.maxHrAge', { value: 188 })).toBe('HR maks 188 bpm (dari usiamu)');
    expect(t('effort.addedToDay', { value: '10,8' })).toBe('+10,8 ke hari ini');
    expect(t('chart.hint')).toBe('Sentuh dan geser grafik untuk melihat detail latihan');
  });
  it('renders English and Indonesian from the same keys', async () => {
    await applyLocale('en');
    try {
      const t = makeAnalysisT(getT('en'));
      expect(t('zones.maxHrAge', { value: 188 })).toBe('Max HR 188 bpm (from your age)');
      expect(t('zones.maxHrSetting', { value: 188 })).toBe('Max HR 188 bpm (your setting)');
      expect(t('effort.addedToDay', { value: '10.8' })).toBe('+10.8 to the day');
      expect(t('chart.hint')).toBe('Touch and drag the chart to inspect the workout');
      expect(formatAxisTick(2500, true)).toBe('2.5 km');
      expect(signedNumber(0.25, 2)).toBe('+0.25');
    } finally {
      await applyLocale('id');
    }
  });
  it('picks the plural form of the comparison basis', () => {
    const en = makeAnalysisT(getT('en'));
    expect(en('compare.basisDistance', { count: 1 })).toBe('Compared with your last workout of similar distance (within 20%).');
    expect(en('compare.basisDuration', { count: 4 })).toBe('Compared with your last 4 workouts of similar duration (within 25%).');
    const id = makeAnalysisT(getT('id'));
    expect(id('compare.basisDistance', { count: 1 })).toBe('Dibandingkan dengan 1 latihan terakhirmu dengan jarak serupa (selisih maks 20%).');
    expect(id('compare.basisDuration', { count: 4 })).toBe('Dibandingkan dengan 4 latihan terakhirmu dengan durasi serupa (selisih maks 25%).');
  });
});

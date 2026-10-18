import { describe, expect, test } from 'bun:test';

import { KEY_DURATIONS } from '../power';
import {
  balanceSplit,
  barWidth,
  cadenceBandLabel,
  climbCategoryKey,
  climbCategoryTone,
  curveDomain,
  curvePath,
  curveTicks,
  curveX,
  curveY,
  decouplingVerdict,
  durationParts,
  fastestSpeedIndex,
  ftpSuggestionDiffers,
  indexAtDistance,
  keyEffortRows,
  logFraction,
  pedallingShare,
  scrubIndexAt,
  speedBarFractions,
  splitEndKm,
  splitEnds,
  wattTicks,
  zoneRangeKind,
  zoneShares,
} from './format';

describe('climbs', () => {
  test('category label keys', () => {
    expect(climbCategoryKey('hc')).toBe('climbs.category.hc');
    expect(climbCategoryKey('3')).toBe('climbs.category.3');
    expect(climbCategoryKey('none')).toBe('climbs.category.none');
  });

  test('harder categories take hotter tones', () => {
    expect(climbCategoryTone('hc')).toBe(4);
    expect(climbCategoryTone('1')).toBe(4);
    expect(climbCategoryTone('2')).toBe(3);
    expect(climbCategoryTone('3')).toBe(2);
    expect(climbCategoryTone('4')).toBe(1);
    expect(climbCategoryTone('none')).toBe(0);
  });
});

describe('scrub index', () => {
  test('a climb start second maps to the nearest grid sample, kept inside the grid', () => {
    expect(scrubIndexAt(1234, 6, 600)).toBe(206);
    expect(scrubIndexAt(1237, 6, 600)).toBe(206);
    expect(scrubIndexAt(1240, 6, 600)).toBe(207);
    expect(scrubIndexAt(-5, 6, 600)).toBe(0);
    expect(scrubIndexAt(99999, 6, 600)).toBe(599);
    expect(scrubIndexAt(10, 6, 0)).toBe(0);
  });

  test('distance to sample index finds the first sample at or past it', () => {
    const dist = [0, 10, 20, 30, 40];
    expect(indexAtDistance(dist, 0)).toBe(0);
    expect(indexAtDistance(dist, 20)).toBe(2);
    expect(indexAtDistance(dist, 21)).toBe(3);
    expect(indexAtDistance(dist, 999)).toBe(4);
    expect(indexAtDistance([], 5)).toBe(0);
  });

  test('split ends follow the cumulative distance and the last split ends at the last sample', () => {
    const dist = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000];
    const splits = [{ distM: 2500 }, { distM: 2500 }, { distM: 1500 }];
    expect(splitEnds(dist, splits)).toEqual([3, 5, 7]);
    expect(splitEnds(null, splits)).toEqual([]);
    expect(splitEndKm(splits)).toEqual([2.5, 5, 6.5]);
  });
});

describe('speed bars', () => {
  test('relative to the fastest, nulls are empty', () => {
    expect(speedBarFractions([20, 10, null])).toEqual([1, 0.5, 0]);
    expect(speedBarFractions([null])).toEqual([0]);
    expect(fastestSpeedIndex([20, 31, null, 25])).toBe(1);
    expect(fastestSpeedIndex([null, null])).toBe(-1);
  });
});

describe('power zones', () => {
  test('shares of the time and bar widths', () => {
    const shares = zoneShares([{ sec: 600 }, { sec: 300 }, { sec: 100 }, { sec: 0 }]);
    expect(shares[0]).toBeCloseTo(0.6, 5);
    expect(shares[3]).toBe(0);
    expect(zoneShares([{ sec: 0 }, { sec: 0 }])).toEqual([0, 0]);
    expect(barWidth(0.456)).toBe('46%');
    expect(barWidth(2)).toBe('100%');
    expect(barWidth(-1)).toBe('0%');
    expect(barWidth(Number.NaN)).toBe('0%');
  });

  test('how a zone range reads', () => {
    expect(zoneRangeKind({ fromW: 0, toW: 173 })).toBe('to');
    expect(zoneRangeKind({ fromW: 173, toW: 236 })).toBe('range');
    expect(zoneRangeKind({ fromW: 473, toW: null })).toBe('from');
  });
});

describe('power curve axis', () => {
  test('duration parts use the largest whole unit', () => {
    expect(durationParts(5)).toEqual({ value: 5, unit: 'sec' });
    expect(durationParts(60)).toEqual({ value: 1, unit: 'min' });
    expect(durationParts(1200)).toEqual({ value: 20, unit: 'min' });
    expect(durationParts(90)).toEqual({ value: 90, unit: 'sec' });
    expect(durationParts(3600)).toEqual({ value: 1, unit: 'hour' });
    expect(durationParts(5400)).toEqual({ value: 90, unit: 'min' });
  });

  test('the log scale puts the ends at 0 and 1 and equal ratios an equal distance apart', () => {
    expect(logFraction(1, 1, 3600)).toBe(0);
    expect(logFraction(3600, 1, 3600)).toBe(1);
    expect(logFraction(60, 1, 3600)).toBeCloseTo(0.5, 10);
    expect(logFraction(10, 1, 100)).toBeCloseTo(0.5, 10);
    expect(logFraction(0.1, 1, 100)).toBe(0);
    expect(logFraction(5, 10, 10)).toBe(0);
  });

  test('ticks stay inside the range', () => {
    expect(curveTicks(5, 3600)).toEqual([5, 15, 60, 300, 1200, 3600]);
    expect(curveTicks(1, 60)).toEqual([1, 5, 15, 60]);
  });

  const points = [
    { sec: 5, watts: 800 },
    { sec: 60, watts: 500 },
    { sec: 1200, watts: 300 },
  ];

  test('the domain covers every line and rounds the top up to 50 W', () => {
    expect(curveDomain(points, [{ sec: 1, watts: 120 }, { sec: 3600, watts: 270 }])).toEqual({ minSec: 1, maxSec: 3600, maxWatts: 800 });
    expect(curveDomain([{ sec: 5, watts: 801 }, { sec: 60, watts: 10 }])).toEqual({ minSec: 5, maxSec: 60, maxWatts: 850 });
    expect(curveDomain([])).toBeNull();
    expect(curveDomain([{ sec: 5, watts: 100 }])).toBeNull();
  });

  test('x runs left to right on the log axis and y falls as watts rise', () => {
    const domain = curveDomain(points)!;
    const box = { left: 30, top: 10, width: 200, height: 100 };
    expect(curveX(5, domain, box)).toBe(30);
    expect(curveX(1200, domain, box)).toBe(230);
    expect(curveX(60, domain, box)).toBeGreaterThan(30);
    expect(curveX(60, domain, box)).toBeLessThan(230);
    expect(curveY(0, domain, box)).toBe(110);
    expect(curveY(domain.maxWatts, domain, box)).toBe(10);
    expect(curveY(500, domain, box)).toBeLessThan(curveY(300, domain, box));
    expect(curveY(9999, domain, box)).toBe(10);
  });

  test('the path is a polyline through the points', () => {
    const domain = curveDomain(points)!;
    const box = { left: 0, top: 0, width: 100, height: 100 };
    const path = curvePath(points, domain, box);
    expect(path.startsWith('M0.0 0.0 L')).toBe(true);
    expect(path.split('L')).toHaveLength(3);
    expect(curvePath([points[0]!], domain, box)).toBe('');
  });

  test('watt ticks start at zero and stop at the top', () => {
    expect(wattTicks(400)).toEqual([0, 100, 200, 300, 400]);
    expect(wattTicks(800)).toEqual([0, 200, 400, 600, 800]);
    expect(wattTicks(100)).toEqual([0, 50, 100]);
    expect(wattTicks(0)).toEqual([0]);
  });
});

describe('key efforts', () => {
  const curve = [
    { sec: 5, watts: 900, atSec: 100 },
    { sec: 60, watts: 450, atSec: 200 },
    { sec: 300, watts: 360, atSec: 300 },
    { sec: 1200, watts: 300, atSec: 400 },
  ];

  test('only durations the ride is long enough for, with W/kg and the record flag', () => {
    const rows = keyEffortRows(curve, KEY_DURATIONS, 75, [60, 1200], [
      { sec: 5, watts: 1000 },
      { sec: 60, watts: 450 },
      { sec: 1200, watts: 300 },
    ]);
    expect(rows.map((r) => r.sec)).toEqual([5, 60, 300, 1200]);
    expect(rows[0]).toEqual({ sec: 5, watts: 900, wkg: 12, record: false, bestWatts: 1000 });
    expect(rows[1]!.record).toBe(true);
    expect(rows[1]!.bestWatts).toBeNull();
    expect(rows[2]!.bestWatts).toBeNull();
    expect(rows[3]!.record).toBe(true);
  });

  test('without a weight there is no W/kg', () => {
    expect(keyEffortRows(curve, [5], null, [], [])[0]!.wkg).toBeNull();
    expect(keyEffortRows(curve, [5], 0, [], [])[0]!.wkg).toBeNull();
  });
});

describe('ftp suggestion', () => {
  test('shown with no FTP, and when it differs by 3 percent or more', () => {
    expect(ftpSuggestionDiffers(300, null)).toBe(true);
    expect(ftpSuggestionDiffers(309, 300)).toBe(true);
    expect(ftpSuggestionDiffers(291, 300)).toBe(true);
    expect(ftpSuggestionDiffers(308, 300)).toBe(false);
    expect(ftpSuggestionDiffers(300, 300)).toBe(false);
    expect(ftpSuggestionDiffers(292, 300)).toBe(false);
  });
});

describe('cadence', () => {
  test('band labels', () => {
    expect(cadenceBandLabel({ fromRpm: 0, toRpm: 1 })).toEqual({ kind: 'coasting' });
    expect(cadenceBandLabel({ fromRpm: 1, toRpm: 60 })).toEqual({ kind: 'range', from: 1, to: 59 });
    expect(cadenceBandLabel({ fromRpm: 90, toRpm: 100 })).toEqual({ kind: 'range', from: 90, to: 99 });
    expect(cadenceBandLabel({ fromRpm: 110, toRpm: null })).toEqual({ kind: 'open', from: 110 });
  });

  test('pedalling share', () => {
    expect(pedallingShare(750, 250)).toBe(0.75);
    expect(pedallingShare(0, 0)).toBeNull();
  });
});

describe('decoupling and balance', () => {
  test('under 5 percent is good, 5 or more is drift, a 5 percent fall is a better second half', () => {
    expect(decouplingVerdict(2.4)).toBe('good');
    expect(decouplingVerdict(4.99)).toBe('good');
    expect(decouplingVerdict(5)).toBe('drift');
    expect(decouplingVerdict(11)).toBe('drift');
    expect(decouplingVerdict(-3)).toBe('good');
    expect(decouplingVerdict(-6)).toBe('better');
  });

  test('left and right add up to 100', () => {
    expect(balanceSplit(49.6)).toEqual({ left: 50, right: 50 });
    expect(balanceSplit(48.2)).toEqual({ left: 48, right: 52 });
    expect(balanceSplit(120)).toEqual({ left: 100, right: 0 });
  });
});

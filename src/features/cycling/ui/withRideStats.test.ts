import { describe, expect, test } from 'bun:test';

import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';

import type { RideAnalysis, RidePower } from '../types';
import { withRideStats } from './withRideStats';

const analysis: WorkoutAnalysis = {
  v: 1,
  sport: { name: 'Cycling', kind: 'ride' },
  startedAt: 1_760_000_000_000,
  elapsedSec: 3600,
  movingSec: 3500,
  distanceM: 30000,
  elevation: null,
  series: null,
  splits: [],
  laps: [],
  hrZones: null,
  paceZones: null,
  bestEfforts: [],
  effort: null,
  load: null,
  calories: null,
  comparison: null,
  stats: {
    avgHr: 140,
    maxHr: 170,
    minHr: 90,
    avgPaceSecKm: null,
    bestPaceSecKm: null,
    avgSpeedMs: 7.5,
    maxSpeedMs: 11,
    avgCad: 85,
    maxCad: 120,
    avgPower: 180,
    maxPower: 600,
    normalizedPower: 200,
    avgStrideM: null,
  },
};

const power: RidePower = {
  avg: 187,
  max: 640,
  normalized: 214,
  variabilityIndex: 1.14,
  intensityFactor: null,
  tss: null,
  workKj: 673,
  avgWkg: null,
  normalizedWkg: null,
  zeroSec: 0,
  balanceLeftPct: null,
  ftp: null,
  zones: null,
  curve: [],
  basisSec: 3500,
};

function ride(over: Partial<RideAnalysis>): RideAnalysis {
  return {
    rev: 1,
    indoor: false,
    times: { elapsedSec: 3600, timerSec: 3600, movingSec: 3500, stoppedSec: 100 },
    distanceM: 30000,
    speed: { avgMs: 8, avgMovingMs: 8.6, avgOverallMs: 8.3, maxMs: 12.4, source: 'gps' },
    elevation: null,
    splits: [],
    laps: [],
    climbs: [],
    cadence: null,
    power,
    ftpSuggestion: null,
    hr: { avg: null, max: null, decoupling: null },
    calories: null,
    load: { trimp: null, tssTrimp: null, trimpUsed: null, basis: null },
    ...over,
  };
}

describe('withRideStats', () => {
  test('takes power and speed from the ride, the moving average speed', () => {
    const out = withRideStats(analysis, ride({}));
    expect(out.stats.normalizedPower).toBe(214);
    expect(out.stats.avgPower).toBe(187);
    expect(out.stats.avgSpeedMs).toBe(8.6);
    expect(out.stats.maxSpeedMs).toBe(12.4);
  });

  test('keeps every other figure and does not change the input', () => {
    const out = withRideStats(analysis, ride({}));
    expect(out.stats.avgHr).toBe(140);
    expect(out.stats.maxPower).toBe(600);
    expect(out.stats.avgCad).toBe(85);
    expect(out.elapsedSec).toBe(3600);
    expect(analysis.stats.normalizedPower).toBe(200);
    expect(analysis.stats.avgSpeedMs).toBe(7.5);
    expect(out).not.toBe(analysis);
  });

  test('a ride without a power meter or speed keeps the generic figures', () => {
    const out = withRideStats(analysis, ride({ power: null, speed: { avgMs: null, avgMovingMs: null, avgOverallMs: null, maxMs: null, source: 'none' } }));
    expect(out.stats.normalizedPower).toBe(200);
    expect(out.stats.avgPower).toBe(180);
    expect(out.stats.avgSpeedMs).toBe(7.5);
    expect(out.stats.maxSpeedMs).toBe(11);
  });

  test('a power meter without a normalized figure keeps the generic one', () => {
    const out = withRideStats(analysis, ride({ power: { ...power, normalized: null } }));
    expect(out.stats.normalizedPower).toBe(200);
    expect(out.stats.avgPower).toBe(187);
  });
});

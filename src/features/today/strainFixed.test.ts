import { describe, expect, it } from 'bun:test';

import { openMemoryDb } from '@/cloud/syncTestKit';
import { listDayStrainLoad } from '@/db/queries';
import { intensityMinutes, mondayOf } from '@/features/fitness/intensityMinutes';
import { DEFAULT_HR_ZONE_SETTINGS, resolveHrZones, type HrZoneSettings } from '@/features/hrzones/zones';
import { analyzeWorkout, type AnalysisHistory } from '@/features/workouts/analysis/analyze';
import { straightRun, T0, workoutRow } from '@/features/workouts/analysis/fixtures';

import { dailyStrain, edwardsZone, strainAddedToDay, strainFromLoads, strainFromTrimp, workoutStrain, zoneThresholds } from './strain';

/**
 * Strain, the strain-based load and the intensity minutes are Edwards' fixed percent-of-maximum zones, whatever method the person picked for
 * their heart-rate zones. The runner here is the tester's profile: maximum about 190, resting about 55.
 */
const MAX = 190;
const REST = 55;
const settings = (over: Partial<HrZoneSettings>): HrZoneSettings => ({ ...DEFAULT_HR_ZONE_SETTINGS, maxHr: MAX, restingHr: REST, ...over });
const SETTINGS: Record<string, HrZoneSettings> = {
  max: settings({ method: 'max' }),
  hrr: settings({ method: 'hrr' }),
  lthr: settings({ method: 'lthr', lthr: 168 }),
  lthrEstimate: settings({ method: 'lthr' }),
  handEdited: settings({ method: 'max', limits: [100, 120, 140, 160, 180] }),
};
const ZONES = Object.fromEntries(Object.entries(SETTINGS).map(([name, s]) => [name, resolveHrZones(s, 35)]));

/** The rule the app used before zones were editable: 50, 60, 70, 80, 90 percent of the maximum heart rate. */
function legacyZone(heartRate: number, maxHr: number): number {
  const pct = (100 * heartRate) / maxHr;
  if (pct < 50) return 0;
  return Math.min(5, Math.floor((pct - 50) / 10) + 1);
}

const DAY = 1_760_000_000 - (1_760_000_000 % 86400);
/** An hour of easy walking, 40 minutes of running with a ramp, a hard finish, then rest. */
const RATES = [...Array(60).fill(95), ...Array.from({ length: 40 }, (_, i) => 130 + i), ...Array(10).fill(182), ...Array(30).fill(70)] as number[];
const samples = RATES.map((heartRate, i) => ({ timestamp: DAY + i * 60, heartRate }));
const points = RATES.map((hr, i) => ({ ts: DAY + i * 60, hr }));

describe('the fixed definition is the one the app used before zones were editable', () => {
  it('edwardsZone is 50-60-70-80-90 percent of the maximum, bpm by bpm', () => {
    for (const max of [150, 171, 185, 190, 205]) for (let hr = 30; hr <= 230; hr++) expect(edwardsZone(hr, max)).toBe(legacyZone(hr, max));
  });

  it('zoneThresholds of 190 are the lowest bpm of Edwards zones 1 to 5', () => {
    expect(zoneThresholds(MAX)).toEqual([95, 114, 133, 152, 171]);
    expect(zoneThresholds(185)).toEqual([93, 111, 130, 148, 167]);
  });

  it('an hour at 140 bpm (74 percent, zone 3) is TRIMP 180 and strain 21 x (1 - e^(-180/250))', () => {
    const hour = Array.from({ length: 61 }, (_, i) => ({ ts: DAY + i * 60, hr: 140 }));
    const w = workoutStrain(hour, MAX)!;
    expect(w.zoneMinutes).toEqual([0, 0, 60, 0, 0]);
    expect(w.trimp).toBeCloseTo(180, 9);
    expect(w.strain).toBeCloseTo(strainFromTrimp(180), 9);
    expect(w.strain).toBeCloseTo(21 * (1 - Math.exp(-180 / 250)), 9);
  });
});

describe('changing the zone method leaves strain and intensity minutes unchanged', () => {
  it('every setting of the runner keeps the maximum, so the same maximum is all strain is given', () => {
    for (const zones of Object.values(ZONES)) expect(zones.maxHr).toBe(MAX);
  });

  it('while the zones themselves differ a lot (the tester: the reserve warm-up starts at 123 bpm, the LTHR first zone sits above Edwards zone 2)', () => {
    expect(ZONES.max!.bounds[0]).toBe(95);
    expect(ZONES.hrr!.bounds[0]).toBe(123);
    expect(ZONES.lthr!.bounds[0]).toBe(113);
    expect(ZONES.hrr!.bounds[0]).toBeGreaterThan(ZONES.max!.bounds[1]!);
  });

  it('workout strain is the same under the maximum, reserve, LTHR and hand-edited zones', () => {
    const results = Object.values(ZONES).map((zones) => workoutStrain(points, zones.maxHr));
    expect(results[0]).not.toBeNull();
    for (const r of results) expect(r).toEqual(results[0]!);
  });

  it('daily strain is the same under every setting', () => {
    const results = Object.values(ZONES).map((zones) => dailyStrain(samples, zones.maxHr));
    for (const r of results) expect(r).toEqual(results[0]!);
    expect(results[0]![0]!.strain).toBeGreaterThan(0);
  });

  it('the SQL day load strain reads is the same under every setting and equals the JS day strain', async () => {
    const { raw, db } = openMemoryDb();
    for (const s of samples) raw.query('INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate) VALUES (?, 0, 0, 0, ?)').run(s.timestamp, s.heartRate);
    const js = dailyStrain(samples, MAX);
    for (const zones of Object.values(ZONES)) {
      const sql = strainFromLoads(await listDayStrainLoad(db, [DAY, DAY + 86400], zones.maxHr));
      expect(sql[0]?.zoneMinutes).toEqual(js[0]?.zoneMinutes as never);
      expect(sql[0]?.trimp).toBe(js[0]?.trimp as number);
      expect(sql[0]?.strain).toBe(js[0]?.strain as number);
    }
  });

  it('what a workout adds to its day is the same under every setting', () => {
    const results = Object.values(ZONES).map((zones) => strainAddedToDay(samples as never, { start: DAY + 60 * 60, end: DAY + 100 * 60 }, 90, zones.maxHr));
    for (const r of results) expect(r).toEqual(results[0]!);
  });

  it('intensity minutes of the week are the same under every setting, from the same strain days', () => {
    const week = mondayOf(DAY);
    const results = Object.values(ZONES).map((zones) => {
      const days = dailyStrain(samples, zones.maxHr);
      return intensityMinutes(days, week);
    });
    for (const r of results) expect(r).toEqual(results[0]!);
    // 40 ramp minutes (130 to 169 bpm: 68-89 percent) and 10 minutes at 182 (96 percent): the figure is not zero.
    const total = results[0]!.days.reduce((a, d) => a + d.total, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('a full workout analysis keeps strain, effort and load while the zone-time bars follow the method', () => {
    const run = straightRun({ legs: [{ sec: 1800, speed: 1000 / 300 }], hr: (t) => 130 + (40 * t) / 1800, alt: () => 20 });
    const history: AnalysisHistory = { efforts: [], trimps: [{ start: T0 - 86400, trimp: 120 }], similar: [] };
    const analyses = Object.entries(ZONES).map(([name, zones]) => ({
      name,
      analysis: analyzeWorkout(
        { workout: workoutRow({ end: T0 + run.elapsed, duration: run.elapsed, distance: Math.round(run.distance) }), summary: {}, points: run.points, zones, daySamples: [], history },
        { includeHr: true, includeRoute: false, includeComparison: false },
      ),
    }));
    const [first] = analyses;
    expect(first!.analysis.effort).not.toBeNull();
    for (const { analysis } of analyses) {
      expect(analysis.effort).toEqual(first!.analysis.effort);
      expect(analysis.load).toEqual(first!.analysis.load);
    }
    const bars = (name: string) => analyses.find((a) => a.name === name)!.analysis.hrZones!;
    expect(bars('hrr').sec).toHaveLength(6);
    expect(bars('max').sec).toHaveLength(5);
    expect(bars('hrr').sec).not.toEqual(bars('max').sec);
    expect(bars('hrr').method).toBe('hrr');
    // Same covered time whatever the zones: the bars and strain read the same stretches of heart rate.
    const covered = (name: string) => bars(name).sec.reduce((a, b) => a + b, 0) + bars(name).belowSec;
    for (const name of Object.keys(ZONES)) expect(covered(name)).toBe(covered('max'));
  });
});

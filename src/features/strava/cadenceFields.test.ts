import { describe, expect, it } from 'bun:test';

import type { WorkoutRow } from '@/db/queries';
import { hrZonesForMax } from '@/features/hrzones/zones';
import { analyzeWorkout, type AnalyzeInput } from '@/features/workouts/analysis/analyze';
import { straightRun, T0, workoutRow } from '@/features/workouts/analysis/fixtures';
import type { AnalysisPoint } from '@/features/workouts/analysis/series';
import type { WorkoutSummary } from '@/features/workouts/summary';

import { stravaCadenceFields } from './cadenceFields';

/** 5:00 per km. */
const FIVE_MIN_KM = 1000 / 300;

interface Case {
  workout: WorkoutRow;
  summary: WorkoutSummary;
  points: AnalysisPoint[];
}

function input(over: { cadence?: (t: number) => number | null; summary?: WorkoutSummary; steps?: number; sportName?: string } = {}): Case {
  const synth = straightRun({ legs: [{ sec: 1510, speed: FIVE_MIN_KM }], hr: () => 150, alt: () => 20, ...(over.cadence ? { cadence: over.cadence } : {}) });
  const workout = workoutRow({
    end: T0 + synth.elapsed,
    sportName: over.sportName ?? 'Outdoor Run',
    duration: synth.elapsed,
    distance: Math.round(synth.distance),
    steps: over.steps ?? 0,
  });
  return { workout, summary: over.summary ?? {}, points: synth.points };
}

/** What the workout screen shows for the same workout. */
function shown(c: Case) {
  const analyzed: AnalyzeInput = { ...c, zones: hrZonesForMax(190), daySamples: [], history: { efforts: [], trimps: [], similar: [] } };
  return analyzeWorkout(analyzed, { includeHr: true, includeRoute: true, includeComparison: false }).stats;
}

const rounded = (v: number | null | undefined, decimals: number) => (v == null ? null : Math.round(v * 10 ** decimals) / 10 ** decimals);

describe('stravaCadenceFields', () => {
  it('gives the file the same cadence and step length as the workout screen, source by source', () => {
    const cases = [
      input({ cadence: () => 170 }),
      input({ summary: { avgCadence: 85, maxCadence: 112, avgStepLengthM: 1.05, importedFrom: 'Garmin' } }),
      input({ summary: { samples: { avgCadence: 158, avgStepLength: 78 } } }),
      input({ summary: { sections: [{ distance: 1000, cadence: 160, stepLength: 70 }, { distance: 1000, cadence: 170, stepLength: 80 }] } }),
      input({ steps: 4000 }),
      input({}),
    ];
    for (const c of cases) {
      const stats = shown(c);
      const fields = stravaCadenceFields(c.workout, c.summary, c.points);
      expect(rounded(fields.avgCadence, 0)).toBe(stats.avgCad);
      expect(rounded(fields.maxCadence, 0)).toBe(stats.maxCad);
      expect(rounded(fields.avgStepLengthM, 2)).toBe(stats.avgStrideM);
    }
  });

  it('reads a FIT run\'s per-leg session figures as steps per minute and a bike\'s as rpm', () => {
    const summary: WorkoutSummary = { avgCadence: 85, maxCadence: 112, importedFrom: 'Garmin' };
    const run = input({ summary });
    expect(stravaCadenceFields(run.workout, summary, run.points)).toMatchObject({ avgCadence: 170, maxCadence: 224 });
    const ride = input({ summary, sportName: 'Biking' });
    expect(stravaCadenceFields(ride.workout, summary, ride.points)).toMatchObject({ avgCadence: 85, maxCadence: 112, avgStepLengthM: null });
  });

  it('derives the step length of a watch run that has a cadence and a speed', () => {
    const i = input({ cadence: () => 170 });
    const fields = stravaCadenceFields(i.workout, i.summary, i.points);
    expect(fields.avgCadence).toBe(170);
    expect(fields.avgStepLengthM).toBeCloseTo(1.18, 1);
  });

  it('has nothing to say about a workout with no source', () => {
    const i = input({});
    expect(stravaCadenceFields(i.workout, i.summary, i.points)).toEqual({ avgCadence: null, maxCadence: null, avgStepLengthM: null });
  });
});

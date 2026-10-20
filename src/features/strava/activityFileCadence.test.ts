import { describe, expect, it } from 'bun:test';

import { buildFit, type StravaLap, type StravaPoint, type StravaWorkout } from './activityFile';
import { decodeFit } from './testDecode';

const START = 1_792_058_016;

/** A 10 minute run (Huawei sport 1) with GPS-less samples every second. */
const run: StravaWorkout = {
  start: START,
  end: START + 600,
  sportType: 1,
  sportName: 'Outdoor Run',
  duration: 600,
  distance: 1800,
  calories: 100,
  avgHr: 140,
  maxHr: 170,
};

const points = (over: (i: number) => Partial<StravaPoint> = () => ({})): StravaPoint[] =>
  Array.from({ length: 601 }, (_, i) => ({ ts: START + i, lat: null, lon: null, alt: null, hr: 140, speed: 3, ...over(i) }));

function decode(workout: StravaWorkout, pts: readonly StravaPoint[], laps?: readonly StravaLap[]) {
  const built = buildFit(workout, pts, { utcOffsetSeconds: 0, ...(laps ? { laps } : {}) });
  const decoded = decodeFit(built.bytes);
  expect(decoded.errors).toEqual([]);
  expect(decoded.integrity).toBe(true);
  return {
    records: decoded.messages.recordMesgs ?? [],
    session: decoded.messages.sessionMesgs?.[0],
    laps: decoded.messages.lapMesgs ?? [],
  };
}

describe('cadence in the Strava FIT file', () => {
  it('writes a foot sport per leg with the fractional part, so an odd steps per minute survives', () => {
    const { records } = decode(run, points(() => ({ cadence: 171 })));
    // 171 steps per minute = 85.5 strides: 85 and 64/128.
    expect(records[10]!.cadence).toBe(85);
    expect(records[10]!.fractionalCadence).toBeCloseTo(0.5, 6);
    const even = decode(run, points(() => ({ cadence: 170 }))).records[10]!;
    expect(even.cadence).toBe(85);
    expect(even.fractionalCadence).toBe(0);
  });

  it('writes a bike in rpm and no fractional field', () => {
    const { records } = decode({ ...run, sportType: 3 }, points(() => ({ cadence: 87 })));
    expect(records[10]!.cadence).toBe(87);
    expect(records[10]!.fractionalCadence).toBeUndefined();
  });

  it('puts the cadence the caller resolved on the session and the single lap, with the fraction, ahead of the step count', () => {
    const { session, laps } = decode({ ...run, steps: 1000, avgCadence: 171, maxCadence: 183 }, points());
    expect(session?.avgCadence).toBe(85);
    expect(session?.avgFractionalCadence).toBeCloseTo(0.5, 6);
    expect(session?.maxCadence).toBe(91);
    expect(session?.maxFractionalCadence).toBeCloseTo(0.5, 6);
    expect(laps[0]?.avgCadence).toBe(85);
    expect(laps[0]?.avgFractionalCadence).toBeCloseTo(0.5, 6);
    expect(laps[0]?.maxCadence).toBe(91);
  });

  it('falls back to the step count over the active time when the caller has no cadence', () => {
    // 1200 steps = 600 strides in 10 minutes = 60 per minute.
    const { session } = decode({ ...run, steps: 1200 }, points());
    expect(session?.avgCadence).toBe(60);
    expect(session?.totalCycles).toBe(600);
    expect(decode(run, points()).session?.avgCadence).toBeUndefined();
  });
});

describe('step length in the Strava FIT file', () => {
  it('writes the record step length only where the point has one, and drops a value that is not a step', () => {
    const { records } = decode(run, points((i) => ({ cadence: 170, stride: i === 10 ? 1.05 : i === 20 ? 4 : null })));
    expect(records[10]!.stepLength).toBeCloseTo(1050, 0);
    expect(records[11]!.stepLength).toBeUndefined();
    expect(records[20]!.stepLength).toBeUndefined();
  });

  it('writes no record step length when no point has one', () => {
    const { records } = decode(run, points(() => ({ cadence: 170 })));
    expect(records.every((r) => r.stepLength === undefined)).toBe(true);
  });

  it('puts the average on the session and the single lap', () => {
    const { session, laps } = decode({ ...run, avgStepLengthM: 0.78 }, points());
    expect(session?.avgStepLength).toBeCloseTo(780, 0);
    expect(laps[0]?.avgStepLength).toBeCloseTo(780, 0);
    const none = decode({ ...run, avgStepLengthM: 3.2 }, points());
    expect(none.session?.avgStepLength).toBeUndefined();
  });
});

describe('cadence of the laps of a recording', () => {
  const laps: StravaLap[] = [
    { startTs: START, endTs: START + 300, distanceM: 900, avgHr: null, maxHr: null, avgCadence: 160 },
    { startTs: START + 300, endTs: START + 600, distanceM: 900, avgHr: null, maxHr: null, avgCadence: null },
  ];
  const pts = points((i) => ({ cadence: i < 300 ? 150 : i < 450 ? 170 : 180, stride: i > 300 ? 0.9 : null }));

  it('keeps a lap\'s own cadence, else the mean and peak of the samples inside it', () => {
    const out = decode(run, pts, laps).laps;
    expect(out[0]?.avgCadence).toBe(80);
    // The sample at the boundary (second 300, 170 steps per minute) belongs to both laps.
    expect(out[0]?.maxCadence).toBe(85);
    // 150 samples of 170 and 151 of 180: 175 steps per minute is 87.5 per leg.
    expect(out[1]?.avgCadence).toBe(87);
    expect(out[1]?.avgFractionalCadence).toBeCloseTo(0.5, 6);
    expect(out[1]?.maxCadence).toBe(90);
  });

  it('gives a lap the step length of its own samples only', () => {
    const out = decode(run, pts, laps).laps;
    expect(out[0]?.avgStepLength).toBeUndefined();
    expect(out[1]?.avgStepLength).toBeCloseTo(900, 0);
  });
});

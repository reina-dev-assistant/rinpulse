import { describe, expect, it } from 'bun:test';

import { buildFit, type StravaLap, type StravaPoint, type StravaWorkout } from './activityFile';
import { decodeFit } from './testDecode';

const START = 1_792_058_016;

const ride: StravaWorkout = {
  start: START,
  end: START + 600,
  sportType: 7,
  sportName: 'Indoor ride',
  duration: 600,
  distance: 6000,
  calories: 150,
  avgHr: 140,
  maxHr: 170,
  avgPower: 200,
  maxPower: 420,
  normalizedPower: 215,
  avgCadence: 85,
  maxCadence: 110,
};

/** A trainer ride: no GPS, a sample every second with heart rate, cadence, power and speed that speeds up. */
const samples = (n: number): StravaPoint[] =>
  Array.from({ length: n + 1 }, (_, i) => ({
    ts: START + i,
    lat: null,
    lon: null,
    alt: null,
    hr: 120 + (i % 50),
    cadence: 80 + (i % 10),
    power: 150 + (i % 100),
    speed: i < n / 2 ? 5 : 15,
  }));

function decode(workout: StravaWorkout, points: readonly StravaPoint[], laps?: readonly StravaLap[]) {
  const built = buildFit(workout, points, { utcOffsetSeconds: 0, ...(laps ? { laps } : {}) });
  const decoded = decodeFit(built.bytes);
  expect(decoded.errors).toEqual([]);
  expect(decoded.integrity).toBe(true);
  return {
    records: decoded.messages.recordMesgs ?? [],
    session: decoded.messages.sessionMesgs?.[0],
    laps: decoded.messages.lapMesgs ?? [],
  };
}

describe('sensor channels in the FIT file', () => {
  it('writes heart rate, cadence, power and speed on every record', () => {
    const { records } = decode(ride, samples(600));
    expect(records).toHaveLength(601);
    const r = records[100]!;
    expect(r.heartRate).toBe(120 + (100 % 50));
    expect(r.cadence).toBe(80);
    expect(r.power).toBe(150 + (100 % 100));
    expect(r.speed).toBeCloseTo(5, 3);
    expect(r.enhancedSpeed).toBeCloseTo(5, 3);
  });

  it('puts power and cadence figures on the session and the single lap', () => {
    const { session, laps } = decode(ride, samples(600));
    expect(session).toMatchObject({ avgPower: 200, maxPower: 420, normalizedPower: 215, avgCadence: 85, maxCadence: 110, numLaps: 1 });
    expect(laps).toHaveLength(1);
    expect(laps[0]).toMatchObject({ avgPower: 200, maxPower: 420, avgCadence: 85, maxCadence: 110 });
  });

  it('with no GPS the distance follows the speed samples, not a straight line', () => {
    const { records } = decode(ride, samples(600));
    const at = (i: number) => (records[i]!.distance as number) ?? 0;
    expect(at(0)).toBe(0);
    // first half 5 m/s, second half 15 m/s: 1500 m of 6000 by the half time
    expect(at(300)).toBeGreaterThan(1450);
    expect(at(300)).toBeLessThan(1550);
    expect(at(600)).toBeCloseTo(6000, 0);
  });

  it('a foot sport halves steps per minute into FIT strides per minute', () => {
    const run: StravaWorkout = { ...ride, sportType: 5, sportName: 'Treadmill run', avgPower: undefined, maxPower: undefined, normalizedPower: undefined, avgCadence: 170, maxCadence: 184 };
    const pts = samples(600).map((p) => ({ ...p, cadence: 170, power: null }));
    const { records, session } = decode(run, pts);
    expect(records[10]!.cadence).toBe(85);
    expect(session).toMatchObject({ avgCadence: 85, maxCadence: 92 });
    expect(records[10]!.power).toBeUndefined();
  });

  it('a coasting rider writes cadence 0 and power 0, not a gap', () => {
    const pts = samples(60).map((p, i) => (i === 30 ? { ...p, cadence: 0, power: 0 } : p));
    const { records } = decode({ ...ride, end: START + 60, duration: 60, distance: 600 }, pts);
    expect(records[30]!.cadence).toBe(0);
    expect(records[30]!.power).toBe(0);
  });
});

describe('several laps', () => {
  const laps: StravaLap[] = [
    { startTs: START, endTs: START + 200, distanceM: 1000, avgHr: 130, maxHr: 150, avgCadence: 82 },
    { startTs: START + 200, endTs: START + 450, distanceM: 2000, avgHr: 150, maxHr: 170, avgCadence: 90 },
    { startTs: START + 450, endTs: START + 600, distanceM: 3000, avgHr: 145, maxHr: 160, avgCadence: 88 },
  ];

  it('writes one lap message per lap, in order, the last one ending the session', () => {
    const { laps: written, session } = decode(ride, samples(600), laps);
    expect(written).toHaveLength(3);
    expect(written.map((l) => l.messageIndex)).toEqual([0, 1, 2]);
    expect(written[0]).toMatchObject({ totalDistance: 1000, avgHeartRate: 130, maxHeartRate: 150, avgCadence: 82 });
    expect(written[1]!.totalElapsedTime).toBe(250);
    expect(written[2]!.lapTrigger).toBe(7);
    expect(written[0]!.lapTrigger).toBe(0);
    expect(session!.numLaps).toBe(3);
    // a lap's power comes from its own samples
    expect(written[1]!.avgPower).toBeGreaterThan(100);
  });

  it('a single lap is the whole workout, as before', () => {
    const { laps: written } = decode(ride, samples(600), [laps[0]!]);
    expect(written).toHaveLength(1);
    expect(written[0]!.totalElapsedTime).toBe(600);
  });
});

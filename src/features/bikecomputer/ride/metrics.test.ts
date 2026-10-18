import { describe, expect, it } from 'bun:test';

import { RIDE_ELEVATION_HYSTERESIS_M, RIDE_ELEVATION_SMOOTH_SEC } from '@/features/cycling/analyzeRide';
import { virtualSpeedMs } from '@/features/cycling/series';
import { normalizedPower, type RecordedSample } from '@/features/record/recorder';
import { elevationProfile } from '@/features/workouts/analysis/elevation';

import { BikeMetrics, estimatePowerW } from './metrics';

const T0 = 1_700_000_000;
const CFG = { weightKg: 75 };

function sample(i: number, over: Partial<RecordedSample> = {}): RecordedSample {
  return { ts: T0 + i, lat: null, lon: null, alt: null, hr: null, speed: null, cadence: null, stride: null, power: null, ...over };
}

function feed(m: BikeMetrics, n: number, make: (i: number) => Partial<RecordedSample>, from = 0): void {
  for (let i = from; i < from + n; i++) m.ingest(sample(i, make(i)));
}

describe('speed figures', () => {
  it('averages distance over the moving seconds only', () => {
    const m = new BikeMetrics(CFG);
    feed(m, 10, () => ({ speed: 5 }));
    feed(m, 5, () => ({ speed: 0.5 }), 10);
    // 10 s x 5 m/s over 10 moving seconds; the five slow seconds add neither distance nor time.
    expect(m.snapshot().avgSpeedMps).toBe(5);
  });

  it('is null before any moving second', () => {
    const m = new BikeMetrics(CFG);
    feed(m, 4, () => ({ speed: 0.2 }));
    const s = m.snapshot();
    expect(s.avgSpeedMps).toBeNull();
    expect(s.lapAvgSpeedMps).toBeNull();
  });

  it('max speed is the fastest 3 s mean, so one spike does not count', () => {
    const m = new BikeMetrics(CFG);
    const speeds = [2, 2, 12, 2, 2, 8, 8, 8, 2];
    speeds.forEach((v, i) => m.ingest(sample(i, { speed: v })));
    // Windows: (2,12,2)=5.33, (12,2,2)=5.33, (2,2,8)=4, (2,8,8)=6, (8,8,8)=8, (8,8,2)=6.
    expect(m.snapshot().maxSpeedMps).toBe(8);
  });

  it('max speed needs three consecutive seconds', () => {
    const m = new BikeMetrics(CFG);
    feed(m, 2, () => ({ speed: 10 }));
    expect(m.snapshot().maxSpeedMps).toBeNull();
    m.ingest(sample(2, { speed: null }));
    m.ingest(sample(3, { speed: 10 }));
    m.ingest(sample(4, { speed: 10 }));
    // The missing second broke the run.
    expect(m.snapshot().maxSpeedMps).toBeNull();
    m.ingest(sample(5, { speed: 10 }));
    expect(m.snapshot().maxSpeedMps).toBe(10);
  });

  it('lap restarts the lap average speed and keeps the ride average', () => {
    const m = new BikeMetrics(CFG);
    feed(m, 10, () => ({ speed: 4 }));
    m.lap(T0 + 10);
    expect(m.snapshot().lapAvgSpeedMps).toBeNull();
    expect(m.lapStart).toBe(T0 + 10);
    feed(m, 10, () => ({ speed: 8 }), 10);
    const s = m.snapshot();
    expect(s.lapAvgSpeedMps).toBe(8);
    expect(s.avgSpeedMps).toBe(6);
  });

  it('drops a sample that is not newer than the last one', () => {
    const m = new BikeMetrics(CFG);
    feed(m, 5, () => ({ speed: 5 }));
    m.ingest(sample(4, { speed: 30 }));
    m.ingest(sample(2, { speed: 30 }));
    expect(m.snapshot().avgSpeedMps).toBe(5);
  });

  it('counts a long gap as one second, not as the gap', () => {
    const m = new BikeMetrics(CFG);
    m.ingest(sample(0, { speed: 6 }));
    m.ingest(sample(60, { speed: 6 }));
    // 2 moving seconds of 6 m/s. A 60 s dt would give the same mean, so check through lap distance share.
    m.lap(T0 + 60);
    m.ingest(sample(61, { speed: 3 }));
    expect(m.snapshot().avgSpeedMps).toBe(5);
  });
});

describe('heart rate and cadence', () => {
  it('averages heart rate and tracks the max', () => {
    const m = new BikeMetrics(CFG);
    [120, 140, 160, null, 130].forEach((hr, i) => m.ingest(sample(i, { hr })));
    const s = m.snapshot();
    expect(s.avgHr).toBe(137.5);
    expect(s.maxHr).toBe(160);
  });

  it('ignores a heart rate no strap reports', () => {
    const m = new BikeMetrics(CFG);
    m.ingest(sample(0, { hr: 0 }));
    m.ingest(sample(1, { hr: 300 }));
    expect(m.snapshot().avgHr).toBeNull();
    expect(m.snapshot().maxHr).toBeNull();
  });

  it('averages cadence over the pedalling seconds only', () => {
    const m = new BikeMetrics(CFG);
    [80, 0, 100, 0, null].forEach((c, i) => m.ingest(sample(i, { cadence: c })));
    expect(m.snapshot().avgCadence).toBe(90);
  });
});

describe('power figures', () => {
  it('average power keeps the zeros of coasting', () => {
    const m = new BikeMetrics(CFG);
    [200, 0, 100, 0].forEach((w, i) => m.ingest(sample(i, { power: w })));
    expect(m.snapshot().avgPower).toBe(75);
  });

  it('has no power figures without a meter', () => {
    const m = new BikeMetrics(CFG);
    feed(m, 40, () => ({ speed: 5 }));
    const s = m.snapshot();
    expect(s.avgPower).toBeNull();
    expect(s.power3s).toBeNull();
    expect(s.power10s).toBeNull();
    expect(s.normPower).toBeNull();
  });

  it('3 s and 10 s power are the means of the samples inside the window', () => {
    const m = new BikeMetrics(CFG);
    for (let i = 1; i <= 12; i++) m.ingest(sample(i, { power: i * 10 }));
    const s = m.snapshot();
    // Newest is second 12: the 3 s window holds 10, 11, 12; the 10 s window holds 3 to 12.
    expect(s.power3s).toBe(110);
    expect(s.power10s).toBe(75);
  });

  it('a sample with no reading leaves the window to the ones that exist, and an empty window is null', () => {
    const m = new BikeMetrics(CFG);
    m.ingest(sample(0, { power: 300 }));
    m.ingest(sample(1, { power: 100 }));
    m.ingest(sample(2, { power: null }));
    expect(m.snapshot().power3s).toBe(200);
    m.ingest(sample(3, { power: null }));
    m.ingest(sample(4, { power: null }));
    // Second 1 left the 3 s window (needs ts > 4 - 3), second 4 has no reading.
    expect(m.snapshot().power3s).toBeNull();
    expect(m.snapshot().power10s).toBe(200);
    for (let i = 5; i <= 12; i++) m.ingest(sample(i, { power: null }));
    expect(m.snapshot().power10s).toBeNull();
  });

  it('normalised power is null under 30 samples and the plain level for a steady effort', () => {
    const m = new BikeMetrics(CFG);
    feed(m, 29, () => ({ power: 200 }));
    expect(m.snapshot().normPower).toBeNull();
    feed(m, 31, () => ({ power: 200 }), 29);
    expect(m.snapshot().normPower).toBeCloseTo(200, 6);
  });

  it('normalised power matches the recorder summary on a variable ride', () => {
    const watts: number[] = [];
    let seed = 7;
    for (let i = 0; i < 400; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const base = i % 120 < 60 ? 150 : 320;
      watts.push(Math.round(base + ((seed % 200) - 100)));
    }
    const m = BikeMetrics.from(
      watts.map((w, i) => sample(i, { power: w })),
      CFG,
    );
    // The recorder rounds to whole watts.
    expect(Math.abs((m.snapshot().normPower as number) - normalizedPower(watts))).toBeLessThanOrEqual(0.5);
  });

  it('normalised power is above the average for a hard-easy ride', () => {
    const m = new BikeMetrics(CFG);
    feed(m, 240, (i) => ({ power: i % 60 < 30 ? 400 : 0 }));
    const s = m.snapshot();
    expect(s.avgPower).toBe(200);
    expect(s.normPower as number).toBeGreaterThan(200);
  });
});

describe('estimatePowerW', () => {
  it('is null below 1 m/s and without a speed', () => {
    expect(estimatePowerW(null, 0, 75)).toBeNull();
    expect(estimatePowerW(0.99, 0, 75)).toBeNull();
    expect(estimatePowerW(0, 5, 75)).toBeNull();
  });

  it('matches the flat-road model by hand', () => {
    // 84 kg total at 8 m/s: aero 0.5 x 1.2 x 0.35 x 512 = 107.52 W, rolling 0.004 x 84 x 9.81 x 8 = 26.37 W; / 0.976 = 137.18 W.
    expect(estimatePowerW(8, 0, 75) as number).toBeCloseTo(137.18, 1);
  });

  it('is the inverse of virtualSpeedMs on the flat', () => {
    for (const v of [3, 6, 9, 12]) {
      const w = estimatePowerW(v, 0, 70) as number;
      expect(virtualSpeedMs(w, 70)).toBeCloseTo(v, 3);
    }
  });

  it('an unknown grade is flat', () => {
    expect(estimatePowerW(6, null, 75)).toBe(estimatePowerW(6, 0, 75));
  });

  it('adds the climbing term m g sin(atan(grade))', () => {
    const flat = estimatePowerW(4, 0, 75) as number;
    const climb = estimatePowerW(4, 8, 75) as number;
    // 84 kg x 9.81 x sin(atan(0.08)) x 4 m/s / 0.976 = 84 x 9.81 x 0.079745 x 4 / 0.976.
    const term = (84 * 9.81 * Math.sin(Math.atan(0.08)) * 4) / 0.976;
    expect(climb - flat).toBeCloseTo(term, 6);
  });

  it('is never negative on a steep descent and a heavier bike costs more', () => {
    expect(estimatePowerW(5, -20, 75)).toBe(0);
    expect(estimatePowerW(5, 3, 75, 15) as number).toBeGreaterThan(estimatePowerW(5, 3, 75, 9) as number);
  });
});

describe('altitude, ascent, grade', () => {
  it('smooths the altitude over 5 s', () => {
    const m = new BikeMetrics(CFG);
    [100, 100, 100, 100, 110].forEach((a, i) => m.ingest(sample(i, { alt: a })));
    expect(m.snapshot().altitudeM).toBe(102);
    expect(new BikeMetrics(CFG).snapshot().altitudeM).toBeNull();
  });

  it('keeps the last altitude through a stretch without one', () => {
    const m = new BikeMetrics(CFG);
    m.ingest(sample(0, { alt: 50 }));
    feed(m, 10, () => ({ alt: null }), 1);
    expect(m.snapshot().altitudeM).toBe(50);
  });

  it('equals the batch elevation profile of the samples so far, at every second', () => {
    expect(RIDE_ELEVATION_SMOOTH_SEC).toBe(15);
    expect(RIDE_ELEVATION_HYSTERESIS_M).toBe(2.5);
    const alt: (number | null)[] = [];
    let seed = 99;
    let level = 200;
    for (let i = 0; i < 400; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const noise = ((seed % 100) - 50) / 25;
      level += i < 150 ? 0.4 : i < 250 ? -0.3 : 0.1;
      alt.push(i >= 60 && i < 66 ? null : level + noise);
    }
    const m = new BikeMetrics(CFG);
    for (let i = 0; i < alt.length; i++) {
      m.ingest(sample(i, { alt: alt[i] ?? null }));
      const batch = elevationProfile(alt.slice(0, i + 1), 1, RIDE_ELEVATION_SMOOTH_SEC, RIDE_ELEVATION_HYSTERESIS_M);
      const s = m.snapshot();
      expect(s.ascentM).toBeCloseTo(batch.gain, 9);
      expect(s.descentM).toBeCloseTo(batch.loss, 9);
    }
    expect(m.snapshot().ascentM).toBeGreaterThan(30);
    expect(m.snapshot().descentM).toBeGreaterThan(20);
  });

  it('does not count flat GPS jitter as climbing', () => {
    const m = new BikeMetrics(CFG);
    feed(m, 300, (i) => ({ alt: 100 + (i % 2 === 0 ? 1 : -1) }));
    const s = m.snapshot();
    expect(s.ascentM).toBe(0);
    expect(s.descentM).toBe(0);
  });

  it('grade is the rise over the last 150 m', () => {
    const m = new BikeMetrics(CFG);
    // 5 m/s, altitude +0.25 m per second: 5 %.
    feed(m, 120, (i) => ({ speed: 5, alt: 100 + i * 0.25 }));
    expect(m.snapshot().gradePct as number).toBeCloseTo(5, 6);
  });

  it('grade follows a switch to a descent', () => {
    const m = new BikeMetrics(CFG);
    feed(m, 60, (i) => ({ speed: 5, alt: 100 + i * 0.25 }));
    for (let i = 60; i < 200; i++) m.ingest(sample(i, { speed: 5, alt: 100 + 59 * 0.25 - (i - 59) * 0.2 }));
    expect(m.snapshot().gradePct as number).toBeCloseTo(-4, 6);
  });

  it('grade is null under 5 km/h, without altitude, or before 50 m of run', () => {
    const slow = new BikeMetrics(CFG);
    feed(slow, 200, (i) => ({ speed: 1.3, alt: 100 + i * 0.05 }));
    expect(slow.snapshot().gradePct).toBeNull();

    const flatNoAlt = new BikeMetrics(CFG);
    feed(flatNoAlt, 100, () => ({ speed: 6 }));
    expect(flatNoAlt.snapshot().gradePct).toBeNull();

    const early = new BikeMetrics(CFG);
    feed(early, 5, (i) => ({ speed: 5, alt: 100 + i }));
    expect(early.snapshot().gradePct).toBeNull();
  });

  it('grade is clamped to 30 %', () => {
    const m = new BikeMetrics(CFG);
    feed(m, 100, (i) => ({ speed: 5, alt: 100 + i * 5 }));
    expect(m.snapshot().gradePct).toBe(30);
    const down = new BikeMetrics(CFG);
    feed(down, 100, (i) => ({ speed: 5, alt: 1000 - i * 5 }));
    expect(down.snapshot().gradePct).toBe(-30);
  });

  it('grade stays finite and bounded when the rider stops for a long time', () => {
    const m = new BikeMetrics(CFG);
    feed(m, 100, (i) => ({ speed: 5, alt: 100 + i * 0.25 }));
    feed(m, 5000, () => ({ speed: 0, alt: 124.75 }), 100);
    const s = m.snapshot();
    expect(s.gradePct).toBeNull();
    feed(m, 60, (i) => ({ speed: 5, alt: 124.75 + i * 0.25 }), 5100);
    expect(m.snapshot().gradePct as number).toBeCloseTo(5, 0);
  });
});

describe('estimated power in the snapshot', () => {
  it('uses the recent speed and the grade', () => {
    const m = new BikeMetrics(CFG);
    feed(m, 120, (i) => ({ speed: 5, alt: 100 + i * 0.25 }));
    const s = m.snapshot();
    expect(s.estPowerW).toBeCloseTo(estimatePowerW(5, s.gradePct, 75) as number, 9);
    expect(s.estPowerW as number).toBeGreaterThan(estimatePowerW(5, 0, 75) as number);
  });

  it('is null when standing still', () => {
    const m = new BikeMetrics(CFG);
    feed(m, 10, () => ({ speed: 0 }));
    expect(m.snapshot().estPowerW).toBeNull();
  });

  it('is flat-road power when there is speed but no altitude', () => {
    const m = new BikeMetrics(CFG);
    feed(m, 10, () => ({ speed: 7 }));
    expect(m.snapshot().estPowerW).toBeCloseTo(estimatePowerW(7, 0, 75) as number, 9);
  });
});

describe('restoring', () => {
  it('replaying the samples gives the same snapshot as feeding them live', () => {
    const samples: RecordedSample[] = [];
    for (let i = 0; i < 500; i++) {
      samples.push(
        sample(i, {
          speed: i % 90 < 10 ? 0 : 6 + Math.sin(i / 20),
          hr: 120 + (i % 40),
          cadence: i % 7 === 0 ? 0 : 85,
          power: i % 5 === 0 ? null : 150 + (i % 50),
          alt: 100 + Math.sin(i / 60) * 20 + i * 0.05,
        }),
      );
    }
    const live = new BikeMetrics(CFG);
    for (const s of samples) live.ingest(s);
    const restored = BikeMetrics.from(samples, CFG);
    expect(restored.snapshot()).toEqual(live.snapshot());
  });

  it('an empty replay is an empty engine', () => {
    const s = BikeMetrics.from([], CFG).snapshot();
    expect(s.avgSpeedMps).toBeNull();
    expect(s.ascentM).toBe(0);
    expect(s.estPowerW).toBeNull();
  });
});

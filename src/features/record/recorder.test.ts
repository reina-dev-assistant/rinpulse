import { describe, expect, it } from 'bun:test';
import { virtualSpeedMs } from '@/features/cycling/series';
import { bytesToHex } from '../sensors/gatt';
import { Recorder, type GpsFix, type RecorderConfig, normalizedPower } from './recorder';

const T0 = 1_700_000_000_000;
const profile = { weightKg: 70, age: 35, sex: 'male' as const };
const config = (sport: RecorderConfig['sport'], gps = false): RecorderConfig => ({ sport, gps, wheelCircumferenceM: 2.105, profile });

const hr = (bpm: number) => bytesToHex(new Uint8Array([0x00, bpm]));
const u16 = (v: number) => [v & 255, (v >>> 8) & 255];
const u32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const csc = (wheelRevs: number, wheelTime: number, crankRevs: number, crankTime: number) =>
  bytesToHex(new Uint8Array([0x03, ...u32(wheelRevs), ...u16(wheelTime), ...u16(crankRevs), ...u16(crankTime)]));

/** A fix `meters` north of the origin at second `sec` of the test. */
const M_PER_DEG = 111_194.93;
const fixAt = (sec: number, meters: number, extra: Partial<GpsFix> = {}): GpsFix => ({
  ts: T0 + sec * 1000,
  lat: 10 + meters / M_PER_DEG,
  lon: 20,
  alt: 100,
  accuracy: 5,
  speed: null,
  ...extra,
});

describe('transitions', () => {
  it('starts idle, records, pauses, resumes and finishes', () => {
    const r = new Recorder(config('other'));
    expect(r.status).toBe('idle');
    r.start(T0);
    expect(r.status).toBe('recording');
    r.pause(T0 + 5000);
    expect(r.status).toBe('paused');
    r.resume(T0 + 20_000);
    expect(r.status).toBe('recording');
    const w = r.finish(T0 + 30_000);
    expect(r.status).toBe('finished');
    expect(w).not.toBeNull();
  });

  it('ignores transitions that do not apply', () => {
    const r = new Recorder(config('other'));
    r.pause(T0);
    r.resume(T0);
    expect(r.lap(T0)).toBeNull();
    expect(r.finish(T0)).toBeNull();
    expect(r.status).toBe('idle');
    r.start(T0);
    r.start(T0 + 1000);
    r.resume(T0 + 1000);
    expect(r.status).toBe('recording');
  });

  it('writes one sample per second, none while paused, and counts only running time', () => {
    const r = new Recorder(config('other'));
    r.start(T0);
    r.tick(T0 + 10_000);
    r.pause(T0 + 10_000);
    r.tick(T0 + 40_000);
    expect(r.sampleCount).toBe(11);
    r.resume(T0 + 40_000);
    r.tick(T0 + 50_000);
    const w = r.finish(T0 + 50_000)!;
    expect(w.samples.map((s) => s.ts).filter((ts) => ts > T0 / 1000 + 10 && ts < T0 / 1000 + 40)).toEqual([]);
    // 10 s before the pause and 10 s after: 20 running seconds even though 50 s passed
    expect(w.movingSec).toBe(20);
    expect(w.start).toBe(T0 / 1000);
    expect(w.end).toBe(T0 / 1000 + 50);
    expect(r.movingSec(T0 + 50_000)).toBe(20);
  });

  it('catches up the seconds a stalled JS thread missed', () => {
    const r = new Recorder(config('other'));
    r.start(T0);
    r.tick(T0 + 1000);
    r.tick(T0 + 11_000);
    expect(r.sampleCount).toBe(12);
    const ts = r.drainNew().map((s) => s.ts);
    expect(ts).toEqual(Array.from({ length: 12 }, (_, i) => T0 / 1000 + i));
    expect(r.drainNew()).toEqual([]);
  });

  it('finishing while paused ends at the last running second', () => {
    const r = new Recorder(config('other'));
    r.start(T0);
    r.pause(T0 + 8000);
    const w = r.finish(T0 + 60_000)!;
    expect(w.end).toBe(T0 / 1000 + 8);
    expect(w.movingSec).toBe(8);
  });

  it('a recording with no sample has nothing to save', () => {
    const r = new Recorder(config('other'));
    expect(r.finish(T0)).toBeNull();
  });
});

describe('laps', () => {
  it('closes a lap with its own heart rate and distance, and the last lap at finish', () => {
    const r = new Recorder(config('run', true));
    r.start(T0);
    const run = (from: number, to: number) => {
      for (let s = from; s <= to; s++) {
        r.fix(fixAt(s, s * 3, { speed: 3 }));
        r.sensor('2a37', hr(s < 10 ? 120 : 160), T0 + s * 1000);
        r.tick(T0 + s * 1000 + 500);
      }
    };
    run(0, 9);
    const lap = r.lap(T0 + 10_000)!;
    expect(lap.distanceM).toBeGreaterThan(20);
    expect(lap.maxHr).toBe(120);
    run(10, 20);
    const w = r.finish(T0 + 20_500)!;
    expect(w.laps).toHaveLength(2);
    expect(w.laps[1]!.avgHr).toBeGreaterThan(150);
    expect(w.laps[0]!.endTs).toBeLessThan(w.laps[1]!.endTs);
    expect(w.laps[0]!.distanceM + w.laps[1]!.distanceM).toBeCloseTo(w.distanceM, -1);
  });
});

describe('heart rate and energy', () => {
  it('uses heart rate energy when the strap covers most of the session', () => {
    const r = new Recorder(config('other'));
    r.start(T0);
    for (let s = 0; s < 600; s++) {
      r.sensor('2a37', hr(150), T0 + s * 1000);
      r.tick(T0 + s * 1000);
    }
    const w = r.finish(T0 + 599_000)!;
    expect(w.kcalSource).toBe('hr');
    expect(w.avgHr).toBe(150);
    expect(w.maxHr).toBe(150);
    // Keytel male, 70 kg, 35 y, 150 bpm: 14.5 kcal/min -> 10 min about 145 kcal
    expect(w.calories).toBeGreaterThan(140);
    expect(w.calories).toBeLessThan(150);
  });

  it('falls back to MET without a strap', () => {
    const r = new Recorder(config('run'));
    r.start(T0);
    r.tick(T0 + 3_599_000);
    const w = r.finish(T0 + 3_599_000)!;
    expect(w.kcalSource).toBe('met');
    // 9.8 MET x 70 kg x 1 h
    expect(w.calories).toBe(686);
    expect(w.avgHr).toBeNull();
  });

  it('holds a heart rate for 5 s only', () => {
    const r = new Recorder(config('other'));
    r.sensor('2a37', hr(140), T0);
    r.start(T0);
    for (let s = 0; s <= 10; s++) r.tick(T0 + s * 1000);
    const w = r.finish(T0 + 10_000)!;
    expect(w.samples.filter((s) => s.hr !== null)).toHaveLength(6);
  });
});

describe('GPS distance', () => {
  it('adds the path of good fixes and gives the sample its speed', () => {
    const r = new Recorder(config('run', true));
    r.start(T0);
    for (let s = 0; s <= 60; s++) {
      r.fix(fixAt(s, s * 3, { speed: 3 }));
      r.tick(T0 + s * 1000);
    }
    const w = r.finish(T0 + 60_000)!;
    expect(w.distanceM).toBeGreaterThan(175);
    expect(w.distanceM).toBeLessThan(185);
    expect(w.avgSpeed).toBeCloseTo(3, 0);
    expect(w.samples[30]!.lat).not.toBeNull();
    expect(w.samples[30]!.speed).toBe(3);
  });

  it('ignores poor fixes, a teleport and standing-still jitter', () => {
    const r = new Recorder(config('run', true));
    r.start(T0);
    r.fix(fixAt(0, 0));
    r.tick(T0);
    // standing still, reported speed 0.1 m/s, wandering 3 m
    for (let s = 1; s <= 10; s++) {
      r.fix(fixAt(s, (s % 2) * 3, { speed: 0.1 }));
      r.tick(T0 + s * 1000);
    }
    // an accuracy 80 m fix far away
    r.fix(fixAt(11, 500, { accuracy: 80 }));
    // a teleport of 2 km in a second
    r.fix(fixAt(12, 2000));
    r.tick(T0 + 12_000);
    const w = r.finish(T0 + 12_000)!;
    expect(w.distanceM).toBe(0);
  });

  it('re-anchors after repeated jumps so the track is not lost for good', () => {
    const r = new Recorder(config('run', true));
    r.start(T0);
    r.fix(fixAt(0, 0));
    // the phone really was carried 5 km away in a car-like jump: five in a row re-anchor
    for (let s = 1; s <= 6; s++) r.fix(fixAt(s, 5000 + s * 3));
    r.fix(fixAt(7, 5000 + 7 * 3 + 3));
    r.tick(T0 + 7000);
    const w = r.finish(T0 + 7000)!;
    expect(w.distanceM).toBeLessThan(10);
    expect(w.distanceM).toBeGreaterThan(0);
  });

  it('a pause adds no distance and the first fix after it is only an anchor', () => {
    const r = new Recorder(config('run', true));
    r.start(T0);
    for (let s = 0; s <= 10; s++) {
      r.fix(fixAt(s, s * 3, { speed: 3 }));
      r.tick(T0 + s * 1000);
    }
    r.pause(T0 + 10_000);
    r.fix(fixAt(30, 600, { speed: 0 }));
    r.resume(T0 + 30_000);
    r.fix(fixAt(31, 603, { speed: 3 }));
    r.tick(T0 + 31_000);
    const w = r.finish(T0 + 31_000)!;
    expect(w.distanceM).toBeLessThan(40);
  });

  it('does not use GPS for an indoor sport', () => {
    const r = new Recorder(config('treadmill', false));
    r.start(T0);
    r.fix(fixAt(0, 0));
    r.fix(fixAt(5, 30));
    r.tick(T0 + 5000);
    const w = r.finish(T0 + 5000)!;
    expect(w.distanceM).toBe(0);
    expect(w.samples.every((s) => s.lat === null)).toBe(true);
  });

  it('drops the position when the last fix is stale', () => {
    const r = new Recorder(config('run', true));
    r.start(T0);
    r.fix(fixAt(0, 0));
    for (let s = 0; s <= 20; s++) r.tick(T0 + s * 1000);
    const w = r.finish(T0 + 20_000)!;
    expect(w.samples[2]!.lat).not.toBeNull();
    expect(w.samples[10]!.lat).toBeNull();
  });
});

describe('sensors', () => {
  it('a speed and cadence sensor gives distance, speed and cadence indoors', () => {
    const r = new Recorder(config('indoorRide'));
    r.start(T0);
    r.sensor('2a5b', csc(1000, 0, 500, 0), T0);
    r.tick(T0);
    // 10 s at 5 wheel revs and 1.5 crank revs per second
    for (let s = 1; s <= 10; s++) {
      r.sensor('2a5b', csc(1000 + s * 5, s * 1024, 500 + Math.floor(s * 1.5), s * 1024), T0 + s * 1000);
      r.tick(T0 + s * 1000);
    }
    const w = r.finish(T0 + 10_000)!;
    expect(w.distanceM).toBe(Math.round(50 * 2.105));
    expect(w.samples[5]!.speed).toBeCloseTo(5 * 2.105, 1);
    expect(w.avgCadence).toBeGreaterThan(50);
    expect(w.maxCadence).toBeLessThanOrEqual(120);
  });

  it('a stopped bike reads 0 speed and adds no distance', () => {
    const r = new Recorder(config('indoorRide'));
    r.start(T0);
    r.sensor('2a5b', csc(0, 0, 0, 0), T0);
    r.tick(T0);
    r.sensor('2a5b', csc(5, 1024, 0, 0), T0 + 1000);
    r.tick(T0 + 1000);
    r.tick(T0 + 10_000);
    const w = r.finish(T0 + 10_000)!;
    expect(w.distanceM).toBe(Math.round(5 * 2.105));
    expect(w.samples[10]!.speed).toBe(0);
  });

  it('outdoors a wheel sensor wins over the GPS path, and GPS is used again without it', () => {
    const r = new Recorder(config('ride', true));
    r.start(T0);
    r.sensor('2a5b', csc(0, 0, 0, 0), T0);
    r.fix(fixAt(0, 0));
    r.tick(T0);
    for (let s = 1; s <= 5; s++) {
      r.sensor('2a5b', csc(s * 5, s * 1024, 0, 0), T0 + s * 1000);
      r.fix(fixAt(s, s * 20, { speed: 20 }));
      r.tick(T0 + s * 1000);
    }
    // wheel total 5 x 5 x 2.105 = 52.6 m although GPS said 100 m
    expect(r.live(T0 + 5000).distanceM).toBeCloseTo(52.6, 0);
    // the sensor goes quiet for good: after the coasting timeout the wheel reads 0 speed, so distance stays; but a ride with no
    // wheel data at all uses the GPS path
    const gpsOnly = new Recorder(config('ride', true));
    gpsOnly.start(T0);
    for (let s = 0; s <= 5; s++) {
      gpsOnly.fix(fixAt(s, s * 10, { speed: 10 }));
      gpsOnly.tick(T0 + s * 1000);
    }
    expect(gpsOnly.live(T0 + 5000).distanceM).toBeGreaterThan(45);
  });

  it('an indoor ride with a power meter and no wheel sensor rides at the speed those watts make on the flat', () => {
    const r = new Recorder(config('indoorRide'));
    r.start(T0);
    for (let s = 0; s <= 60; s++) {
      r.sensor('2a63', bytesToHex(new Uint8Array([0, 0, ...u16(200)])), T0 + s * 1000);
      r.tick(T0 + s * 1000);
    }
    const w = r.finish(T0 + 60_000)!;
    const v = virtualSpeedMs(200, 70);
    expect(w.samples[30]!.speed).toBeCloseTo(v, 1);
    expect(w.distanceM).toBeGreaterThan(v * 58);
    expect(w.distanceM).toBeLessThan(v * 62);
    // A wheel sensor, when there is one, still wins.
    const wheel = new Recorder(config('indoorRide'));
    wheel.start(T0);
    wheel.sensor('2a5b', csc(0, 0, 0, 0), T0);
    wheel.tick(T0);
    for (let s = 1; s <= 5; s++) {
      wheel.sensor('2a63', bytesToHex(new Uint8Array([0, 0, ...u16(200)])), T0 + s * 1000);
      wheel.sensor('2a5b', csc(s * 5, s * 1024, 0, 0), T0 + s * 1000);
      wheel.tick(T0 + s * 1000);
    }
    expect(wheel.finish(T0 + 5000)!.distanceM).toBe(Math.round(25 * 2.105));
  });

  it('keeps the mean pedal balance of a power meter that reports it, while pedalling', () => {
    const r = new Recorder(config('indoorRide'));
    r.start(T0);
    // flags 0x0001: pedal power balance in half percent after the power: 97 = 48.5 % left, then 100 = 50 %; the first second is taken before the first reading and a second without watts counts for nothing.
    for (const [s, watts, half] of [[0, 200, 60], [1, 200, 97], [2, 200, 100], [3, 0, 60]] as const) {
      r.sensor('2a63', bytesToHex(new Uint8Array([1, 0, ...u16(watts), half])), T0 + s * 1000);
      r.tick(T0 + s * 1000);
    }
    const w = r.finish(T0 + 3000)!;
    expect(w.balanceLeftPct).toBe(49.3);
    const none = new Recorder(config('indoorRide'));
    none.start(T0);
    none.sensor('2a63', bytesToHex(new Uint8Array([0, 0, ...u16(200)])), T0);
    none.tick(T0);
    expect(none.finish(T0)!.balanceLeftPct).toBeNull();
  });

  it('power and a foot pod end up in the sample', () => {
    const r = new Recorder(config('treadmill'));
    r.start(T0);
    r.sensor('2a63', bytesToHex(new Uint8Array([0, 0, ...u16(200)])), T0);
    r.sensor('2a53', bytesToHex(new Uint8Array([0x05, ...u16(768), 160, ...u16(110)])), T0);
    r.tick(T0);
    r.tick(T0 + 4000);
    const w = r.finish(T0 + 4000)!;
    expect(w.samples[2]).toMatchObject({ power: 200, cadence: 160, stride: 1.1, speed: 3 });
    expect(w.avgPower).toBe(200);
    expect(w.normalizedPower).toBe(200);
    // 3 m/s for the 4 seconds after the first sample
    expect(w.distanceM).toBe(12);
    expect(w.steps).toBeGreaterThan(10);
  });
});

describe('restore after a kill', () => {
  it('comes back paused from the last sample with its totals', () => {
    const r = new Recorder(config('run', true));
    r.start(T0);
    for (let s = 0; s <= 30; s++) {
      r.fix(fixAt(s, s * 3, { speed: 3 }));
      r.sensor('2a37', hr(140), T0 + s * 1000);
      r.tick(T0 + s * 1000);
    }
    const samples = r.drainNew();
    const meta = JSON.parse(JSON.stringify(r.meta()));
    const back = Recorder.restore(meta, samples);
    expect(back.status).toBe('paused');
    expect(back.sampleCount).toBe(31);
    expect(back.live(T0 + 600_000).distanceM).toBeCloseTo(r.live(T0 + 30_000).distanceM, 6);
    // time the app was dead is not workout time
    expect(back.movingSec(T0 + 600_000)).toBe(31);
    back.resume(T0 + 600_000);
    back.tick(T0 + 605_000);
    const w = back.finish(T0 + 605_000)!;
    expect(w.samples.length).toBe(31 + 6);
    expect(w.movingSec).toBe(30 + 5);
  });
});

describe('normalizedPower', () => {
  it('is the plain mean under 30 s and weights surges above it', () => {
    expect(normalizedPower([100, 200, 300])).toBe(200);
    const steady = new Array(60).fill(200);
    expect(normalizedPower(steady)).toBe(200);
    const surgy = [...new Array(30).fill(100), ...new Array(30).fill(300)];
    expect(normalizedPower(surgy)).toBeGreaterThan(200);
  });
});

describe('virtual speed from the web game (indoor ride, cadence sensor only)', () => {
  const run = (virtual: boolean, wheel = false) => {
    const r = new Recorder(config('indoorRide'));
    r.start(T0);
    for (let s = 1; s <= 20; s++) {
      if (virtual) r.virtualSpeed(8, T0 + s * 1000);
      if (wheel) r.sensor('2a5b', csc(s * 4, (s * 1024) % 65536, s, (s * 1024) % 65536), T0 + s * 1000);
      r.tick(T0 + s * 1000);
    }
    return r.finish(T0 + 20_000)!;
  };

  it('is the speed and distance of the ride while the game keeps reporting', () => {
    const w = run(true);
    expect(w.distanceM).toBeGreaterThan(150);
    expect(w.distanceM).toBeLessThanOrEqual(8 * 21);
    expect(w.samples.at(-1)!.speed).toBe(8);
  });

  it('stops counting when the game goes quiet for over five seconds', () => {
    const r = new Recorder(config('indoorRide'));
    r.start(T0);
    r.virtualSpeed(8, T0);
    r.tick(T0 + 10_000);
    const w = r.finish(T0 + 10_000)!;
    expect(w.samples.filter((p) => p.speed === 8).length).toBeLessThanOrEqual(6);
    expect(w.samples.at(-1)!.speed).toBeNull();
  });

  it('gives way to a real wheel speed sensor', () => {
    const w = run(true, true);
    expect(w.samples.at(-1)!.speed).not.toBe(8);
  });

  it('does nothing without the game', () => {
    expect(run(false).distanceM).toBe(0);
  });
});

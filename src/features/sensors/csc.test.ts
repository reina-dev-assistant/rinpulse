import { describe, expect, it } from 'bun:test';

import { cscFrames, type CscFrame } from './cscSim';
import { bytesToHex, COAST_TIMEOUT_MAX_MS, COAST_TIMEOUT_MS, holdMs, parseCsc, hexToBytes, SensorTracker } from './gatt';

const T0 = 1_700_000_000_000;
const WHEEL_M = 2.105;

/** Feeds the frames to a tracker and reads it once a second, like the recorder; returns each second's reading. */
function run(tracker: SensorTracker, frames: readonly CscFrame[], seconds: number) {
  const readings: { sec: number; cadenceRpm?: number; speedMps?: number }[] = [];
  let next = 0;
  for (let sec = 1; sec <= seconds; sec++) {
    const now = T0 + sec * 1000;
    for (let f = frames[next]; f !== undefined && f.ts <= now; f = frames[next]) {
      tracker.ingest('2a5b', f.hex, f.ts);
      next += 1;
    }
    const r = tracker.read(now);
    readings.push({ sec, cadenceRpm: r.cadenceRpm, speedMps: r.speedMps });
  }
  return readings;
}

describe('CSC frames of a crank-only sensor (cadence mode)', () => {
  it('are 5 bytes: flags 0x02, crank revolutions, crank event time', () => {
    const frames = cscFrames({ mode: 'cadence', crank: { rpm: 80 }, fromMs: T0, toMs: T0 + 5000 });
    expect(frames.length).toBeGreaterThan(4);
    for (const f of frames) expect(f.hex).toHaveLength(10);
    const first = parseCsc(hexToBytes(frames[0]!.hex));
    expect(first?.wheel).toBeUndefined();
    expect(first?.crank?.revs).toBe(1);
  });

  it('delivers revolutions in bursts at connection events, as the phone sees them', () => {
    const frames = cscFrames({ mode: 'cadence', crank: { rpm: 150 }, fromMs: T0, toMs: T0 + 6000 });
    const perInstant = new Map<number, number>();
    for (const f of frames) perInstant.set(f.ts, (perInstant.get(f.ts) ?? 0) + 1);
    expect(Math.max(...perInstant.values())).toBeGreaterThanOrEqual(2);
    expect([...perInstant.keys()].every((ts) => (ts - T0) % 750 === 0)).toBe(true);
  });

  it('give the cadence within 1 rpm every second once two events are in, mode "cadence", no speed', () => {
    const tracker = new SensorTracker(WHEEL_M);
    const readings = run(tracker, cscFrames({ mode: 'cadence', crank: { rpm: 80 }, fromMs: T0, toMs: T0 + 60_000 }), 60);
    for (const r of readings.slice(4)) {
      expect(r.cadenceRpm).toBeGreaterThan(78.5);
      expect(r.cadenceRpm).toBeLessThan(81.5);
      expect(r.speedMps).toBeUndefined();
    }
    expect(tracker.cscMode).toBe('cadence');
    expect(tracker.read(T0 + 60_000).cscMode).toBe('cadence');
    expect(tracker.wheelDistanceM).toBe(0);
    expect(tracker.frames).toBeGreaterThan(70);
    expect(tracker.lastValueAt).toBeGreaterThan(T0 + 58_000);
  });

  it('survive both counters rolling over inside the stream (uint16 revolutions, uint16 clock)', () => {
    const tracker = new SensorTracker(WHEEL_M);
    const frames = cscFrames({ mode: 'cadence', crank: { rpm: 90, startRevs: 65_530, startTicks: 64_000 }, fromMs: T0, toMs: T0 + 40_000 });
    const readings = run(tracker, frames, 40);
    for (const r of readings.slice(4)) expect(Math.round(r.cadenceRpm ?? -1)).toBeGreaterThanOrEqual(89);
    for (const r of readings.slice(4)) expect(Math.round(r.cadenceRpm ?? -1)).toBeLessThanOrEqual(91);
  });

  it('read 0 once pedalling stops, and come back on the first two events after it restarts', () => {
    const tracker = new SensorTracker(WHEEL_M);
    const frames = cscFrames({ mode: 'cadence', crank: { rpm: 70, stops: [[20_000, 40_000]] }, fromMs: T0, toMs: T0 + 60_000 });
    const readings = run(tracker, frames, 60);
    expect(readings[18]?.cadenceRpm).toBeGreaterThan(65);
    // the last event is ~20 s; 3 s of hold, then zero until the crank turns again
    for (const r of readings.slice(25, 39)) expect(r.cadenceRpm).toBe(0);
    for (const r of readings.slice(46)) expect(r.cadenceRpm).toBeGreaterThan(65);
  });

  it('keep a slow climb (30 rpm) above zero: the hold grows with the revolution time', () => {
    const tracker = new SensorTracker(WHEEL_M);
    const readings = run(tracker, cscFrames({ mode: 'cadence', crank: { rpm: 30 }, fromMs: T0, toMs: T0 + 60_000 }), 60);
    for (const r of readings.slice(6)) expect(r.cadenceRpm).toBeGreaterThan(28);
  });

  it('after a link drop longer than 10 s the first frame is a new baseline, not a cadence over the gap', () => {
    const tracker = new SensorTracker(WHEEL_M);
    const frames = cscFrames({ mode: 'cadence', crank: { rpm: 80 }, fromMs: T0, toMs: T0 + 60_000, linkDown: [[20_000, 35_000]] });
    const readings = run(tracker, frames, 60);
    for (const r of readings.slice(0, 19).slice(4)) expect(r.cadenceRpm).toBeGreaterThan(78);
    // nothing arrives while the link is down
    for (const r of readings.slice(25, 34)) expect(r.cadenceRpm).toBe(0);
    for (const r of readings.slice(40)) {
      expect(r.cadenceRpm).toBeGreaterThan(78);
      expect(r.cadenceRpm).toBeLessThan(82);
    }
  });

  it('ignore a counter that restarted instead of reporting a cadence of thousands', () => {
    const tracker = new SensorTracker(WHEEL_M);
    const u16 = (v: number) => [v & 255, (v >>> 8) & 255];
    const frame = (revs: number, ticks: number) => bytesToHex(new Uint8Array([0x02, ...u16(revs), ...u16(ticks)]));
    tracker.ingest('2a5b', frame(500, 10_000), T0);
    tracker.ingest('2a5b', frame(501, 10_700), T0 + 700);
    expect(tracker.read(T0 + 700).cadenceRpm).toBeCloseTo(87.8, 0);
    // the sensor woke up with its counters at zero: 64 000 "revolutions" in under a second is not a rider
    tracker.ingest('2a5b', frame(3, 11_400), T0 + 1400);
    expect(tracker.read(T0 + 1400).cadenceRpm).toBeCloseTo(87.8, 0);
  });
});

describe('CSC frames of a wheel-only sensor (speed mode)', () => {
  it('are 7 bytes: flags 0x01, wheel revolutions, wheel event time; no cadence, mode "speed"', () => {
    const frames = cscFrames({ mode: 'speed', wheel: { rpm: 150 }, fromMs: T0, toMs: T0 + 30_000 });
    for (const f of frames) expect(f.hex).toHaveLength(14);
    const tracker = new SensorTracker(WHEEL_M);
    const readings = run(tracker, frames, 30);
    for (const r of readings.slice(4)) {
      expect(r.cadenceRpm).toBeUndefined();
      // 150 rev/min = 2.5 rev/s over 2.105 m
      expect(r.speedMps).toBeGreaterThan(5.1);
      expect(r.speedMps).toBeLessThan(5.4);
    }
    expect(tracker.cscMode).toBe('speed');
    expect(tracker.read(T0 + 30_000).cscMode).toBe('speed');
    expect(tracker.wheelDistanceM).toBeGreaterThan(5.2 * 25);
  });
});

describe('CSC frames carrying both parts', () => {
  it('are 11 bytes, give speed and cadence, mode "both"', () => {
    const frames = cscFrames({ mode: 'both', wheel: { rpm: 160 }, crank: { rpm: 85 }, fromMs: T0, toMs: T0 + 30_000 });
    for (const f of frames) expect(f.hex).toHaveLength(22);
    const tracker = new SensorTracker(WHEEL_M);
    const readings = run(tracker, frames, 30);
    const last = readings[29]!;
    expect(last.cadenceRpm).toBeGreaterThan(83);
    expect(last.cadenceRpm).toBeLessThan(87);
    expect(last.speedMps).toBeGreaterThan(5.4);
    expect(tracker.cscMode).toBe('both');
  });
});

describe('holdMs', () => {
  it('is the 3 s minimum for a normal crank, grows for a slow one and never passes the cap', () => {
    expect(holdMs(0.75)).toBe(COAST_TIMEOUT_MS);
    expect(holdMs(1)).toBe(COAST_TIMEOUT_MS);
    expect(holdMs(2)).toBe(4000);
    expect(holdMs(30)).toBe(COAST_TIMEOUT_MAX_MS);
  });
});

describe('CSC mode of a tracker', () => {
  it('is unknown before the first CSC frame and not set by other sensors', () => {
    const tracker = new SensorTracker(WHEEL_M);
    expect(tracker.cscMode).toBeNull();
    tracker.ingest('2a37', '0048', T0);
    expect(tracker.cscMode).toBeNull();
    expect(tracker.read(T0).cscMode).toBeUndefined();
    expect(tracker.frames).toBe(1);
  });

  it('accumulates: a sensor that alternates wheel-only and crank-only frames is "both"', () => {
    const tracker = new SensorTracker(WHEEL_M);
    tracker.ingest('2a5b', '01640000000004', T0);
    expect(tracker.cscMode).toBe('speed');
    tracker.ingest('2a5b', '0232000004', T0 + 500);
    expect(tracker.cscMode).toBe('both');
  });
});

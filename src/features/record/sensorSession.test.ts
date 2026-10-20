import { afterEach, describe, expect, it } from 'bun:test';

import type { LocationEvent, StepsEvent, ValueEvent, WorkoutSessionOptions } from '../../../modules/ble-sensors/src/BleSensors.types';
import { cscFrames, type CscFrame } from '../sensors/cscSim';
import { ensureSensorSchema, type SavedSensor } from '../sensors/store';
import { RecordingController, type HubApi, type SessionApi } from './controller';
import { ensureRecordingSchema } from './journal';
import { openDb } from './testDb';

/**
 * A XOSS Vortex sleeps until the crank turns and then drops its link when it dozes off again. The recording must keep looking for it for
 * the whole session and take its values whenever it is back, not try once at "Mulai".
 */
const T0 = 1_700_000_000_000;

const vor: SavedSensor = {
  id: 'D4:1B:9E:04:3D:86',
  name: 'XOSS VOR 3D86',
  alias: null,
  kinds: ['csc'],
  addedAt: 0,
  lastSeen: null,
  battery: null,
  batteryAt: null,
  manufacturer: null,
  model: null,
  autoConnect: true,
};

type State = 'connecting' | 'connected' | 'disconnected';

/**
 * The radio of one sensor as the native link behaves: `connect` starts an attempt (`connecting`), which ends in `connected` when the
 * sensor is awake and in `disconnected` with a failure after `attemptMs`; an awake sensor that goes out of range drops its link.
 */
class Radio implements HubApi {
  values: ((e: ValueEvent) => void)[] = [];
  fixes: ((e: LocationEvent) => void)[] = [];
  steps: ((e: StepsEvent) => void)[] = [];
  connects: number[] = [];
  disconnects = 0;
  state: State | null = null;
  failure: string | null = null;
  private attemptStarted = 0;

  constructor(
    private readonly now: () => number,
    /** [fromMs, toMs) windows relative to T0 in which the sensor is awake and in range. */
    private readonly awake: readonly (readonly [number, number])[],
    private readonly attemptMs = 35_000,
  ) {}

  isAwake(at = this.now()): boolean {
    return this.awake.some(([from, to]) => at - T0 >= from && at - T0 < to);
  }

  onValue(l: (e: ValueEvent) => void) {
    this.values.push(l);
    return () => (this.values = this.values.filter((x) => x !== l));
  }
  onSteps(l: (e: StepsEvent) => void) {
    this.steps.push(l);
    return () => (this.steps = this.steps.filter((x) => x !== l));
  }
  onLocation(l: (e: LocationEvent) => void) {
    this.fixes.push(l);
    return () => (this.fixes = this.fixes.filter((x) => x !== l));
  }
  async connect() {
    this.connects.push(this.now());
    this.state = 'connecting';
    this.attemptStarted = this.now();
  }
  async disconnect() {
    this.disconnects += 1;
    this.state = null;
  }
  links() {
    return this.state ? { [vor.id]: { state: this.state, error: this.failure, lastFailure: this.failure } } : {};
  }

  /** One second of radio time: attempts succeed or time out, a link to a sensor that left drops. */
  step() {
    const awake = this.isAwake();
    if (this.state === 'connecting') {
      if (awake) {
        this.state = 'connected';
        this.failure = null;
      } else if (this.now() - this.attemptStarted >= this.attemptMs) {
        this.state = 'disconnected';
        this.failure = 'connecting timed out';
      }
    } else if (this.state === 'connected' && !awake) {
      this.state = 'disconnected';
      this.failure = 'Link ended: GATT status 8 (connection timeout)';
    }
  }

  deliver(frame: CscFrame) {
    for (const l of this.values) l({ id: vor.id, ts: frame.ts, service: '1816', characteristic: '2a5b', value: frame.hex });
  }
}

class FakeSession implements SessionApi {
  starts: WorkoutSessionOptions[] = [];
  async start(o: WorkoutSessionOptions) {
    this.starts.push(o);
  }
  async update() {}
  onAction() {
    return () => {};
  }
  async end() {}
}

let live: RecordingController | null = null;
afterEach(async () => {
  await live?.discard().catch(() => {});
  live = null;
});

interface Session {
  /** Seconds in `ready` before "Mulai". */
  readySeconds?: number;
  /** Seconds recorded. */
  seconds: number;
  /** When the sensor is awake, relative to T0. */
  awake: readonly (readonly [number, number])[];
  /** The crank turns at 80 rpm during these windows (relative to T0); frames are only delivered while the link is up. */
  pedalling?: readonly (readonly [number, number])[];
  /** How long one connect attempt waits for a sleeping sensor before it fails (the native link: 35 s direct, 90 s auto-connect). */
  attemptMs?: number;
}

async function session(opts: Session) {
  const { db, all } = openDb();
  await ensureSensorSchema(db as never);
  await ensureRecordingSchema(db as never);
  let clock = T0;
  const radio = new Radio(() => clock, opts.awake, opts.attemptMs);
  const logs: string[] = [];
  const controller = new RecordingController({
    hub: radio,
    session: new FakeSession(),
    db,
    now: () => clock,
    profile: () => ({ weightKg: 70, age: 35, sex: 'male' }),
    stepCounter: async () => 'unavailable',
    wheelCircumferenceM: () => 2.105,
    sensors: () => [vor],
    log: (m) => logs.push(m),
  });
  live = controller;

  // The sensor counts its crank for the whole time; the radio hears the frames only while the link is up.
  const total = (opts.readySeconds ?? 0) + opts.seconds;
  const frames = cscFrames({
    mode: 'cadence',
    crank: { rpm: 80, stops: complement(opts.pedalling ?? [[0, total * 1000]], total * 1000) },
    fromMs: T0,
    toMs: T0 + total * 1000 + 1000,
  });
  let next = 0;
  const second = () => {
    clock += 1000;
    radio.step();
    for (let f = frames[next]; f !== undefined && f.ts <= clock; f = frames[next]) {
      next += 1;
      if (radio.state === 'connected') radio.deliver(f);
    }
    controller.tick();
  };

  await controller.prepare('indoorRide', 'Ride');
  for (let s = 0; s < (opts.readySeconds ?? 0); s++) second();
  controller.start();
  for (let s = 0; s < opts.seconds; s++) second();
  return { controller, radio, logs, all, db, second, clock: () => clock };
}

/** The windows in `[0, total)` not covered by `windows`. */
function complement(windows: readonly (readonly [number, number])[], total: number): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (const [from, to] of [...windows].sort((a, b) => a[0] - b[0])) {
    if (from > at) out.push([at, from]);
    at = Math.max(at, to);
  }
  if (at < total) out.push([at, total]);
  return out;
}

describe('a sensor that is asleep when the recording starts', () => {
  it('keeps trying through the whole recording and takes its values from the moment it is back (30 s after "Mulai")', async () => {
    // the first attempt at "Mulai" fails after 20 s; the sensor shows up at 30 s
    const { controller, radio, all, logs } = await session({ seconds: 120, awake: [[30_000, 1_000_000]], attemptMs: 20_000 });
    // the recording restarted the link after the failure instead of waiting for the next native retry
    expect(radio.connects.length).toBeGreaterThanOrEqual(2);
    expect(radio.state).toBe('connected');
    const live = controller.getSnapshot().live!;
    expect(live.cadence).toBeGreaterThanOrEqual(78);
    expect(live.cadence).toBeLessThanOrEqual(82);

    const result = (await controller.finish())!;
    const points = all<{ ts: number; cadence: number | null }>('SELECT ts, cadence FROM workout_points WHERE workout_id = ? ORDER BY ts', result.workoutId);
    const first = points[0]!.ts;
    const at = (sec: number) => points.find((p) => p.ts === first + sec)?.cadence ?? null;
    expect(at(20)).toBeNull();
    expect(at(29)).toBeNull();
    expect(at(40)).toBeGreaterThanOrEqual(78);
    expect(at(60)).toBeGreaterThanOrEqual(78);
    expect(at(110)).toBeGreaterThanOrEqual(78);
    const [row] = all<{ summary_json: string }>('SELECT summary_json FROM workouts WHERE id = ?', result.workoutId);
    const summary = JSON.parse(row!.summary_json);
    expect(summary.avgCadence).toBeGreaterThanOrEqual(78);
    expect(summary.sensors[0]).toMatchObject({ id: vor.id, mode: 'cadence' });
    expect(summary.sensors[0].frames).toBeGreaterThan(50);
    // the log tells the story: down, connecting, the first value, connected
    expect(logs.some((l) => l.includes('XOSS VOR 3D86: not connected'))).toBe(true);
    expect(logs.some((l) => l.includes('XOSS VOR 3D86: connecting again'))).toBe(true);
    expect(logs.some((l) => /XOSS VOR 3D86: first 2a5b value 02/.test(l))).toBe(true);
    expect(logs.some((l) => l.includes('XOSS VOR 3D86: connected'))).toBe(true);
  });

  it('is also found when it only wakes while the recording is still getting ready', async () => {
    const { controller, radio } = await session({ readySeconds: 20, seconds: 60, awake: [[10_000, 1_000_000]] });
    expect(radio.state).toBe('connected');
    expect(controller.getSnapshot().live!.cadence).toBeGreaterThanOrEqual(78);
  });

  it('backs off the restarts (3 s, then 6, 12, 24, 30 s apart) and never gives up, also after ten minutes', async () => {
    const { controller, radio, second } = await session({ seconds: 60, awake: [] });
    for (let s = 0; s < 540; s++) second();
    const gaps = radio.connects.slice(1).map((at, i) => Math.round((at - (radio.connects[i] as number)) / 1000));
    // the native attempt takes 35 s to time out; restarts come at the next tick after the pause, so the gaps grow, then hold at the cap
    expect(gaps.length).toBeGreaterThan(8);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(45);
    const lastAt = radio.connects[radio.connects.length - 1] as number;
    expect(lastAt - T0).toBeGreaterThan(540_000);
    expect(controller.getSnapshot().phase).toBe('active');
  });

  it('records the sensor as asked for but silent when it never showed up, so the workout can say so', async () => {
    const { controller, all } = await session({ seconds: 60, awake: [] });
    const result = (await controller.finish())!;
    const [row] = all<{ summary_json: string }>('SELECT summary_json FROM workouts WHERE id = ?', result.workoutId);
    const summary = JSON.parse(row!.summary_json);
    expect(summary.sensors).toEqual([{ id: vor.id, name: vor.name, kinds: ['csc'], frames: 0 }]);
    expect(summary.avgCadence).toBeUndefined();
    expect(all('SELECT * FROM workout_sensor WHERE workout_id = ?', result.workoutId)).toHaveLength(1);
  });
});

describe('a sensor that drops and comes back during the ride', () => {
  it('is connected again within a few seconds of being seen down and its cadence continues', async () => {
    // awake 0-60 s, away 60-100 s, back at 100 s; pedalling all the time
    const { controller, radio, all } = await session({
      seconds: 180,
      awake: [
        [0, 60_000],
        [100_000, 1_000_000],
      ],
    });
    expect(radio.state).toBe('connected');
    const result = (await controller.finish())!;
    const points = all<{ ts: number; cadence: number | null }>('SELECT ts, cadence FROM workout_points WHERE workout_id = ? ORDER BY ts', result.workoutId);
    const first = points[0]!.ts;
    const at = (sec: number) => points.find((p) => p.ts === first + sec)?.cadence ?? null;
    expect(at(40)).toBeGreaterThanOrEqual(78);
    // away: nothing is heard, the cadence reads 0 after the hold
    expect(at(80)).toBe(0);
    expect(at(150)).toBeGreaterThanOrEqual(78);
    expect(at(175)).toBeGreaterThanOrEqual(78);
    expect(radio.connects.length).toBeGreaterThanOrEqual(2);
  });

  it('does not restart a link that is up or being set up', async () => {
    const { radio } = await session({ seconds: 90, awake: [[0, 1_000_000]] });
    expect(radio.connects).toHaveLength(1);
  });

  it('stops looking when the recording ends and drops the link', async () => {
    const { controller, radio, second } = await session({ seconds: 30, awake: [] });
    const before = radio.connects.length;
    await controller.finish();
    expect(radio.disconnects).toBe(1);
    for (let s = 0; s < 120; s++) second();
    expect(radio.connects.length).toBe(before);
  });
});

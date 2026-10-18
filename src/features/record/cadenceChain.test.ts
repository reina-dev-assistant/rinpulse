import { afterEach, describe, expect, it } from 'bun:test';

import type { LocationEvent, ValueEvent, WorkoutSessionOptions } from '../../../modules/ble-sensors/src/BleSensors.types';
import { analyzeRide } from '../cycling/analyzeRide';
import { PROFILE } from '../cycling/rideFixtures';
import { cscFrames, type CscFrame } from '../sensors/cscSim';
import { ensureSensorSchema, listWorkoutSensors, type SavedSensor } from '../sensors/store';
import { RecordingController, type HubApi, type SessionApi } from './controller';
import { ensureRecordingSchema } from './journal';
import { openDb } from './testDb';

/**
 * The whole chain of a ride with a crank-only sensor (XOSS Vortex in cadence mode): radio notifications in connection-event bursts ->
 * hub value events -> controller -> recorder samples -> save -> `workout_points` -> ride analysis, which is what the ride detail shows.
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

class FakeHub implements HubApi {
  values: ((e: ValueEvent) => void)[] = [];
  fixes: ((e: LocationEvent) => void)[] = [];
  connects: string[] = [];
  onValue(l: (e: ValueEvent) => void) {
    this.values.push(l);
    return () => (this.values = this.values.filter((x) => x !== l));
  }
  onLocation(l: (e: LocationEvent) => void) {
    this.fixes.push(l);
    return () => (this.fixes = this.fixes.filter((x) => x !== l));
  }
  async connect(id: string) {
    this.connects.push(id);
  }
  async disconnect() {}
  links() {
    return { [vor.id]: { state: 'connected' as const, error: null, lastFailure: null } };
  }
  emit(frame: CscFrame) {
    for (const l of this.values) l({ id: vor.id, ts: frame.ts, service: '1816', characteristic: '2a5b', value: frame.hex });
  }
  emitFix(ts: number, meters: number) {
    for (const l of this.fixes) l({ ts, lat: 10 + meters / 111_194.93, lon: 20, alt: 100, accuracy: 5, speed: 6, bearing: null });
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

interface RideOptions {
  frames: CscFrame[];
  sport?: 'ride' | 'indoorRide';
  warm?: boolean;
  seconds: number;
}

async function ride({ frames, sport = 'ride', warm = false, seconds }: RideOptions) {
  const { db, all } = openDb();
  await ensureSensorSchema(db as never);
  await ensureRecordingSchema(db as never);
  const hub = new FakeHub();
  let clock = T0;
  const controller = new RecordingController({
    hub,
    session: new FakeSession(),
    db,
    now: () => clock,
    profile: () => ({ weightKg: 70, age: 35, sex: 'male' }),
    wheelCircumferenceM: () => 2.105,
    sensors: () => [vor],
  });
  live = controller;
  if (warm) await controller.warmUp(sport, 'Ride');
  await controller.prepare(sport, 'Ride');
  controller.start();
  let next = 0;
  let meters = 0;
  for (let s = 0; s < seconds; s++) {
    clock += 1000;
    for (let f = frames[next]; f !== undefined && f.ts <= clock; f = frames[next]) {
      hub.emit(f);
      next += 1;
    }
    meters += 6;
    if (sport === 'ride') hub.emitFix(clock, meters);
    controller.tick();
  }
  const result = await controller.finish();
  live = null;
  return { result: result!, db, all, hub, snapshot: controller.getSnapshot() };
}

const stream = (opts: Parameters<typeof cscFrames>[0]) => cscFrames(opts);

describe('a ride with a crank-only sensor', () => {
  it('stores the cadence of every pedalling second and the ride detail shows it', async () => {
    const frames = stream({ mode: 'cadence', crank: { rpm: 82, stops: [[60_000, 75_000]] }, fromMs: T0, toMs: T0 + 180_000 });
    const { result, all, db } = await ride({ frames, seconds: 180 });

    const points = all<{ ts: number; cadence: number | null; speed: number | null }>(
      'SELECT ts, cadence, speed FROM workout_points WHERE workout_id = ? ORDER BY ts',
      result.workoutId,
    );
    expect(points.length).toBeGreaterThanOrEqual(180);
    const pedalling = points.filter((p) => (p.cadence ?? 0) > 0);
    // pedalling ~165 of the 180 s; the first ~3 s need two events, the 15 s stop reads 0 after the hold
    expect(pedalling.length).toBeGreaterThan(150);
    for (const p of pedalling) {
      expect(p.cadence).toBeGreaterThanOrEqual(80);
      expect(p.cadence).toBeLessThanOrEqual(84);
    }
    const stopped = points.filter((p) => p.cadence === 0);
    expect(stopped.length).toBeGreaterThan(8);
    // a crank-only sensor gives no speed: the speed of the ride is the GPS one
    expect(points.some((p) => p.speed !== null && p.speed > 0)).toBe(true);

    const [row] = all<{ summary_json: string; distance: number; duration: number; start: number; end: number }>(
      'SELECT * FROM workouts WHERE id = ?',
      result.workoutId,
    );
    const summary = JSON.parse(row!.summary_json);
    expect(summary.avgCadence).toBeGreaterThanOrEqual(80);
    expect(summary.avgCadence).toBeLessThanOrEqual(84);
    expect(summary.maxCadence).toBeLessThanOrEqual(84);
    expect(await listWorkoutSensors(db as never, result.workoutId)).toEqual([{ id: vor.id, name: vor.name, kinds: ['csc'] }]);
    // the workout remembers how many values the sensor sent and that they were crank-only (cadence mode)
    expect(summary.sensors).toHaveLength(1);
    expect(summary.sensors[0]).toMatchObject({ id: vor.id, kinds: ['csc'], mode: 'cadence' });
    expect(summary.sensors[0].frames).toBeGreaterThan(150);

    const analysis = analyzeRide({
      workout: { start: row!.start, end: row!.end, duration: row!.duration, distance: row!.distance, calories: 0, sportType: 3, sportName: 'Ride' },
      summary,
      points,
      profile: PROFILE,
    });
    expect(analysis.cadence?.avg).toBeGreaterThanOrEqual(80);
    expect(analysis.cadence?.avg).toBeLessThanOrEqual(84);
    expect(analysis.cadence?.pedallingSec).toBeGreaterThan(150);
    expect(analysis.cadence?.bands.some((b) => b.sec > 0)).toBe(true);
  });

  it('is the same when the GPS warm-up of the picker ran first', async () => {
    const frames = stream({ mode: 'cadence', crank: { rpm: 75 }, fromMs: T0, toMs: T0 + 90_000 });
    const { result, all } = await ride({ frames, seconds: 90, warm: true });
    const points = all<{ cadence: number | null }>('SELECT cadence FROM workout_points WHERE workout_id = ?', result.workoutId);
    expect(points.filter((p) => (p.cadence ?? 0) > 0).length).toBeGreaterThan(80);
  });

  it('is the same indoors', async () => {
    const frames = stream({ mode: 'cadence', crank: { rpm: 90 }, fromMs: T0, toMs: T0 + 90_000 });
    const { result, all } = await ride({ frames, seconds: 90, sport: 'indoorRide' });
    const points = all<{ cadence: number | null }>('SELECT cadence FROM workout_points WHERE workout_id = ?', result.workoutId);
    expect(points.filter((p) => (p.cadence ?? 0) > 0).length).toBeGreaterThan(80);
  });

  it('keeps the cadence across a link drop and reconnect in the middle of the ride', async () => {
    // 3 minutes at 80 rpm, link down from 1:00 to 1:25 (the sensor keeps counting, the phone hears nothing)
    const frames = stream({ mode: 'cadence', crank: { rpm: 80 }, fromMs: T0, toMs: T0 + 180_000, linkDown: [[60_000, 85_000]] });
    const { result, all } = await ride({ frames, seconds: 180 });
    const points = all<{ ts: number; cadence: number | null }>('SELECT ts, cadence FROM workout_points WHERE workout_id = ? ORDER BY ts', result.workoutId);
    const first = points[0]!.ts;
    const at = (sec: number) => points.find((p) => p.ts === first + sec)?.cadence ?? null;
    expect(at(30)).toBeGreaterThanOrEqual(78);
    // while the link was down the phone has no data: it reads 0 after the hold, never an invented number
    expect(at(75)).toBe(0);
    expect(at(120)).toBeGreaterThanOrEqual(78);
    expect(at(170)).toBeLessThanOrEqual(82);
  });
});

describe('a ride with a wheel-only sensor (speed mode)', () => {
  it('stores no cadence and uses the wheel for speed and distance', async () => {
    const frames = stream({ mode: 'speed', wheel: { rpm: 160 }, fromMs: T0, toMs: T0 + 120_000 });
    const { result, all, snapshot } = await ride({ frames, seconds: 120, sport: 'indoorRide' });
    const points = all<{ cadence: number | null; speed: number | null }>('SELECT cadence, speed FROM workout_points WHERE workout_id = ?', result.workoutId);
    expect(points.every((p) => p.cadence === null)).toBe(true);
    const moving = points.filter((p) => (p.speed ?? 0) > 5);
    expect(moving.length).toBeGreaterThan(110);
    const [row] = all<{ distance: number }>('SELECT distance FROM workouts WHERE id = ?', result.workoutId);
    // 160 rev/min x 2.105 m = 5.6 m/s over ~117 s
    expect(row!.distance).toBeGreaterThan(600);
    expect(snapshot.phase).toBe('idle');
    const [saved] = all<{ summary_json: string }>('SELECT summary_json FROM workouts WHERE id = ?', result.workoutId);
    const summary = JSON.parse(saved!.summary_json);
    expect(summary.avgCadence).toBeUndefined();
    expect(summary.sensors[0]).toMatchObject({ id: vor.id, mode: 'speed' });
    expect(summary.sensors[0].frames).toBeGreaterThan(100);
  });
});

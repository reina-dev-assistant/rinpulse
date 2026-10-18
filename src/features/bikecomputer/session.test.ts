import { beforeAll, describe, expect, test } from 'bun:test';

import { applyLocale } from '@/i18n';
import { Recorder, type RecorderConfig } from '@/features/record/recorder';

import { at, polyline } from './nav/testRoutes';
import { BikeSession, bearingDeg, type BikeSessionDeps } from './session';
import { DEFAULT_BIKE_SETTINGS } from './settingsModel';
import type { BikeSettings, RideAlert } from './types';

const T0 = 1_700_000_000_000;
const config: RecorderConfig = { sport: 'ride', gps: true, wheelCircumferenceM: 2.105, profile: { weightKg: 70, age: 35, sex: 'male' } };

interface Rig {
  recorder: Recorder;
  session: BikeSession;
  alerts: RideAlert[];
  /** One second of the ride: the bike is `meters` north of the start and the GPS says `speed`. */
  step(sec: number, meters: number, speed: number, eastM?: number): void;
  settings: BikeSettings;
}

function rig(opts: { settings?: Partial<BikeSettings>; route?: boolean; recorder?: Recorder; battery?: number | null } = {}): Rig {
  const recorder = opts.recorder ?? new Recorder(config);
  if (recorder.status === 'idle') recorder.start(T0);
  const settings: BikeSettings = { ...DEFAULT_BIKE_SETTINGS, ...opts.settings };
  let clock = T0;
  const alerts: RideAlert[] = [];
  const deps: BikeSessionDeps = {
    settings: () => settings,
    profile: () => ({ weightKg: 70, maxHr: 190, ftp: 250 }),
    route: opts.route ? { id: 'r1', points: polyline([[0, 0], [0, 3000]], 10) } : null,
    actions: {
      pause: () => recorder.pause(clock),
      resume: () => recorder.resume(clock),
      lap: () => recorder.lap(clock),
    },
    battery: () => ({ pct: opts.battery ?? null, charging: false }),
    lostSensors: () => [],
    onAlert: (a) => alerts.push(a),
  };
  const session = new BikeSession(deps);
  return {
    recorder,
    session,
    alerts,
    settings,
    step(sec, meters, speed, eastM = 0) {
      clock = T0 + sec * 1000;
      const p = at(eastM, meters, 100);
      recorder.fix({ ts: clock, lat: p.lat, lon: p.lon, alt: 100, accuracy: 5, speed });
      recorder.tick(clock);
      session.onTick({ recorder, now: clock });
    },
  };
}

beforeAll(async () => {
  await applyLocale('id');
});

describe('BikeSession', () => {
  test('metrics follow the ride and the position gets a heading once the rider has moved', () => {
    const r = rig();
    for (let s = 1; s <= 30; s++) r.step(s, s * 7, 7);
    const snap = r.session.getSnapshot();
    expect(snap).not.toBeNull();
    expect(snap?.metrics.maxSpeedMps).toBeCloseTo(7, 0);
    expect(snap?.metrics.avgSpeedMps).toBeGreaterThan(6);
    expect(snap?.position?.headingDeg).not.toBeNull();
    expect(Math.abs((snap?.position?.headingDeg ?? 99) % 360)).toBeLessThan(2);
    expect(snap?.autoPaused).toBe(false);
    expect(snap?.nav).toBeNull();
  });

  test('auto-pause stops the recorder when the bike stops and resumes it when it moves', () => {
    const r = rig();
    for (let s = 1; s <= 10; s++) r.step(s, s * 7, 7);
    expect(r.recorder.status).toBe('recording');
    for (let s = 11; s <= 18; s++) r.step(s, 70, 0);
    expect(r.recorder.status).toBe('paused');
    expect(r.session.getSnapshot()?.autoPaused).toBe(true);
    for (let s = 19; s <= 24; s++) r.step(s, 70 + (s - 18) * 7, 7);
    expect(r.recorder.status).toBe('recording');
    expect(r.session.getSnapshot()?.autoPaused).toBe(false);
  });

  test('auto-pause off leaves a stop alone', () => {
    const r = rig({ settings: { autoPause: false } });
    for (let s = 1; s <= 20; s++) r.step(s, 0, 0);
    expect(r.recorder.status).toBe('recording');
  });

  test('a pause the rider made is not undone by auto-pause', () => {
    const r = rig();
    for (let s = 1; s <= 10; s++) r.step(s, s * 7, 7);
    r.recorder.pause(T0 + 10_500);
    for (let s = 11; s <= 25; s++) r.step(s, s * 7, 7);
    expect(r.recorder.status).toBe('paused');
    expect(r.session.getSnapshot()?.autoPaused).toBe(false);
  });

  test('auto-lap by distance closes a lap each time and a manual lap resets the count', () => {
    const r = rig({ settings: { autoLap: { mode: 'distance', everyM: 1000 } } });
    for (let s = 1; s <= 320; s++) r.step(s, s * 10, 10);
    expect(r.recorder.live(T0 + 320_000).lapNumber).toBeGreaterThanOrEqual(3);
    const laps = r.recorder.live(T0 + 320_000).lapNumber;
    expect(r.alerts.filter((a) => a.kind === 'autoLap').length).toBeGreaterThanOrEqual(1);
    r.recorder.lap(T0 + 321_000);
    r.step(322, 3220, 10);
    r.step(323, 3230, 10);
    expect(r.recorder.live(T0 + 323_000).lapNumber).toBe(laps + 1);
  });

  test('following a route gives progress, the next cue and the finish distance', () => {
    const r = rig({ route: true });
    expect(r.session.hasRoute).toBe(true);
    for (let s = 1; s <= 30; s++) r.step(s, s * 10, 10);
    const nav = r.session.getSnapshot()?.nav;
    expect(nav?.routeId).toBe('r1');
    expect(nav?.distanceDoneM).toBeCloseTo(300, -1);
    expect(nav?.distanceToFinishM).toBeCloseTo(2700, -1);
    expect(nav?.offCourse).toBe(false);
    expect(nav?.etaSec).not.toBeNull();
  });

  test('leaving the route raises the off-course alert once, and returning raises back-on-course', () => {
    const r = rig({ route: true });
    for (let s = 1; s <= 20; s++) r.step(s, s * 10, 10);
    for (let s = 21; s <= 45; s++) r.step(s, 200 + (s - 20) * 5, 5, 150);
    expect(r.alerts.filter((a) => a.kind === 'offCourse').length).toBe(1);
    expect(r.session.getSnapshot()?.nav?.offCourse).toBe(true);
    for (let s = 46; s <= 60; s++) r.step(s, 325 + (s - 45) * 10, 10, 0);
    expect(r.alerts.filter((a) => a.kind === 'backOnCourse').length).toBe(1);
    expect(r.session.getSnapshot()?.nav?.offCourse).toBe(false);
  });

  test('low battery alerts once at 20 percent', () => {
    const r = rig({ battery: 19 });
    for (let s = 1; s <= 10; s++) r.step(s, s * 7, 7);
    expect(r.alerts.filter((a) => a.kind === 'lowBattery').length).toBe(1);
  });

  test('a restored recorder is replayed into the metrics on the first tick', () => {
    const first = rig();
    for (let s = 1; s <= 30; s++) first.step(s, s * 7, 7);
    const second = rig({ recorder: first.recorder });
    second.step(31, 217, 7);
    expect(second.session.getSnapshot()?.metrics.avgSpeedMps).toBeGreaterThan(6);
    expect(second.session.getSnapshot()?.metrics.maxSpeedMps).toBeCloseTo(7, 0);
  });
});

describe('bearingDeg', () => {
  test('cardinal directions', () => {
    const a = { lat: 0, lon: 0 };
    expect(bearingDeg(a, { lat: 1, lon: 0 })).toBeCloseTo(0, 5);
    expect(bearingDeg(a, { lat: 0, lon: 1 })).toBeCloseTo(90, 5);
    expect(bearingDeg(a, { lat: -1, lon: 0 })).toBeCloseTo(180, 5);
    expect(bearingDeg(a, { lat: 0, lon: -1 })).toBeCloseTo(270, 5);
  });
});

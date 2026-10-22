import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { applyLocale } from '@/i18n';
import type { LiveStats } from '@/features/record/recorder';

import { FIELD_IDS, type BikeMetricsSnapshot, type NavSnapshot } from '../types';
import { fieldValue, powerZoneOf, type FieldContext } from './values';
import { hrZonesForMax } from '@/features/hrzones/zones';

const live: LiveStats = {
  status: 'recording',
  movingSec: 3725,
  elapsedSec: 4000,
  distanceM: 28_430,
  hr: 152,
  speedMps: 7.5,
  cadence: 88,
  watts: 210,
  calories: 640,
  lapNumber: 2,
  lapDistanceM: 1234,
  lapMovingSec: 200,
  fixAgeSec: 1,
  fixAccuracyM: 6,
};

const metrics: BikeMetricsSnapshot = {
  avgSpeedMps: 6.8,
  maxSpeedMps: 13.9,
  lapAvgSpeedMps: 7.1,
  avgCadence: 85,
  avgHr: 140,
  maxHr: 171,
  avgPower: 180,
  power3s: 230,
  power10s: 205,
  normPower: 195,
  altitudeM: 812.4,
  ascentM: 321.6,
  descentM: 120,
  gradePct: 4.26,
  estPowerW: 187.4,
};

const nav: NavSnapshot = {
  routeId: 'r1',
  distanceDoneM: 10_000,
  distanceToFinishM: 12_345,
  etaSec: 1800,
  offCourse: false,
  offCourseM: 4,
  nextCue: { cue: { kind: 'left', atM: 10_300, lat: 0, lon: 0 }, distanceM: 300 },
  climb: { climb: { startM: 10_500, endM: 12_000, lengthM: 1500, ascentM: 90, avgGradePct: 6, maxGradePct: 9, category: 4 }, startsInM: 500, remainingAscentM: 90, remainingM: 2000, inProgress: false },
};

const base: FieldContext = { live, metrics, nav, zones: hrZonesForMax(190), ftp: 250, batteryPct: 64, nowMs: Date.UTC(2026, 9, 18, 3, 5), lapSpeedMps: null };
const empty: FieldContext = {
  live: { ...live, hr: null, speedMps: null, cadence: null, watts: null },
  metrics: Object.fromEntries(Object.keys(metrics).map((k) => [k, null])) as unknown as BikeMetricsSnapshot,
  nav: null,
  zones: hrZonesForMax(190),
  ftp: null,
  batteryPct: null,
  nowMs: base.nowMs,
  lapSpeedMps: null,
};

beforeAll(async () => {
  await applyLocale('en');
});

// Other test files run in Indonesian (bunfig preload); do not leak English into them.
afterAll(async () => {
  await applyLocale('id');
});

describe('fieldValue', () => {
  test('every field has a value for a full context and a placeholder for an empty one, never a throw', () => {
    for (const id of FIELD_IDS) {
      expect(fieldValue(id, base).value.length).toBeGreaterThan(0);
      expect(fieldValue(id, empty).value.length).toBeGreaterThan(0);
    }
  });

  test('speed fields are km/h with one decimal', () => {
    expect(fieldValue('speed', base)).toMatchObject({ value: '27.0', unit: 'km/h' });
    expect(fieldValue('maxSpeed', base).value).toBe('50.0');
    expect(fieldValue('lapSpeed', base).value).toBe('25.6');
    expect(fieldValue('lapSpeed', { ...base, lapSpeedMps: 8 }).value).toBe('28.8');
    expect(fieldValue('speed', empty).value).toBe('--');
  });

  test('time fields', () => {
    expect(fieldValue('movingTime', base).value).toBe('1:02:05');
    expect(fieldValue('elapsedTime', base).value).toBe('1:06:40');
    expect(fieldValue('lapTime', base).value).toBe('3:20');
  });

  test('distance switches to km above 1000 m', () => {
    expect(fieldValue('distance', base)).toMatchObject({ value: '28.43', unit: 'km' });
    expect(fieldValue('lapDistance', base)).toMatchObject({ value: '1.23', unit: 'km' });
    expect(fieldValue('lapDistance', { ...base, live: { ...live, lapDistanceM: 640 } })).toMatchObject({ value: '640', unit: 'm' });
  });

  test('heart rate zone carries its tone and name; below zone 1 there is none', () => {
    const z = fieldValue('hrZone', base);
    expect(z.value).toBe('4');
    expect(z.tone).toBe('zone4');
    expect(z.sub).not.toBeNull();
    expect(fieldValue('hrZone', { ...base, live: { ...live, hr: 80 } }).value).toBe('--');
  });

  test('power zone follows FTP; without an FTP it is empty', () => {
    expect(powerZoneOf(100, 250)).toBe(1);
    expect(powerZoneOf(140, 250)).toBe(2);
    expect(powerZoneOf(210, 250)).toBe(3);
    expect(powerZoneOf(240, 250)).toBe(4);
    expect(powerZoneOf(600, 250)).toBe(7);
    expect(fieldValue('powerZone', base)).toMatchObject({ value: '3', tone: 'zone3' });
    expect(fieldValue('powerZone', { ...base, ftp: null }).value).toBe('--');
  });

  test('terrain fields are whole metres and one decimal of grade', () => {
    expect(fieldValue('altitude', base).value).toBe('812');
    expect(fieldValue('ascent', base).value).toBe('322');
    expect(fieldValue('grade', base)).toMatchObject({ value: '4.3', unit: '%' });
    expect(fieldValue('grade', empty).value).toBe('--');
  });

  test('navigation fields come from the nav snapshot and are empty without a route', () => {
    expect(fieldValue('distanceToFinish', base)).toMatchObject({ value: '12.35', unit: 'km' });
    expect(fieldValue('distanceToTurn', base)).toMatchObject({ value: '300', unit: 'm' });
    expect(fieldValue('climbRemaining', base).value).toBe('90');
    expect(fieldValue('eta', base).value).not.toBe('--');
    for (const id of ['distanceToFinish', 'distanceToTurn', 'climbRemaining', 'eta'] as const) expect(fieldValue(id, empty).value).toBe('--');
  });

  test('estimated power says it is an estimate', () => {
    const v = fieldValue('estPower', base);
    expect(v.value).toBe('187');
    expect(v.sub).not.toBeNull();
  });

  test('battery turns to the warning tone at 20 percent', () => {
    expect(fieldValue('battery', base).tone).toBe('neutral');
    expect(fieldValue('battery', { ...base, batteryPct: 20 }).tone).toBe('warn');
    expect(fieldValue('battery', empty).value).toBe('--');
  });
});

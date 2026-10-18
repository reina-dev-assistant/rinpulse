/**
 * Golden tests on real bike-computer files. None is committed: the files are other people's recordings with no licence that
 * allows redistribution (python-fitparse and tormoder/fit carry them in their test data, the Edge 810 + Vector one is
 * DC Rainmaker's 2013 Garmin Vector review ride). Point `RIDE_FIT_DIR` at a folder holding any of them (names below) to run
 * these; without it the whole block is skipped and the synthetic tests in `analyzeRide.test.ts` carry the suite.
 *
 * What the files give: the devices write their own session figures (normalized power, TSS, intensity factor, FTP, work, ascent, timer
 * time), so each is a reference computed by the head unit. The Garmin Edge 810 file agrees with JoyoFit to the watt.
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseFitActivity, type FitActivity } from '@/features/fitimport/parseFit';

import { analyzeRide } from './analyzeRide';
import { PROFILE } from './rideFixtures';

const dir = process.env.RIDE_FIT_DIR ?? '';
const file = (name: string) => join(dir, name);
const has = (name: string) => dir !== '' && existsSync(file(name));

function load(name: string): FitActivity {
  const a = parseFitActivity(new Uint8Array(readFileSync(file(name))));
  if ('ok' in a) throw new Error(`${name}: ${a.message}`);
  return a;
}

function analyse(a: FitActivity, ftp: number | null) {
  return analyzeRide({
    workout: { start: a.start, end: a.end, duration: a.timerSeconds, distance: a.distance, calories: a.calories, sportType: 3, sportName: 'Cycling' },
    // As the FIT import stores it: the device's own ascent and descent.
    summary: { laps: a.laps, importedFrom: 'FIT file', elevationGain: a.ascent ?? undefined, elevationLoss: a.descent ?? undefined, ascentSource: 'device' },
    points: a.points,
    profile: { ...PROFILE, ftp },
  });
}

const EDGE810 = 'Edge810-Vector-2013-08-16-15-35-10.fit';
const ELEMNT = '2019-02-17-062644-ELEMNT-297E-195-0.fit';
const EDGE500 = 'garmin-edge-500-activity.fit';
const COROS = 'coros-pace-2-cycling-misaligned-fields.fit';

/** Device values read from each file's session message (Garmin FIT SDK decode). */
describe.skipIf(!has(EDGE810))('Garmin Edge 810 with Vector pedals (device: avg 276 W, NP 301 W, IF 0.956, TSS 118.7 at FTP 315, 1296 kJ)', () => {
  const a = has(EDGE810) ? load(EDGE810) : null;
  const r = a ? analyse(a, 315) : null;

  it('average power, NP, IF, TSS and work match the head unit', () => {
    expect(Math.abs((r?.power?.avg ?? 0) - 276)).toBeLessThanOrEqual(1);
    expect(Math.abs((r?.power?.normalized ?? 0) - 301)).toBeLessThanOrEqual(1);
    expect(Math.abs((r?.power?.intensityFactor ?? 0) - 0.956)).toBeLessThan(0.006);
    expect(Math.abs((r?.power?.tss ?? 0) - 118.7)).toBeLessThan(1.2);
    expect(Math.abs((r?.power?.workKj ?? 0) - 1296)).toBeLessThanOrEqual(2);
    expect(r?.power?.max).toBe(a?.maxPower ?? -1);
  });

  it('distance, timer and the 5 km splits agree with the file', () => {
    expect(r?.distanceM).toBe(Math.round(a?.distance ?? 0));
    expect(r?.times.timerSec).toBe(Math.round(a?.timerSeconds ?? 0));
    expect(r?.times.movingSec).toBeLessThanOrEqual(r?.times.timerSec ?? 0);
    expect(r?.splits.length).toBe(9);
    expect(r?.splits.reduce((s, x) => s + x.distM, 0)).toBe(r?.distanceM ?? -1);
  });

  it('pedal balance is read from the records (device session: 49.8 % right)', () => {
    expect(a?.balanceLeftPct).not.toBeNull();
    expect(Math.abs((a?.balanceLeftPct ?? 0) - 50.2)).toBeLessThan(1.5);
  });

  it('ascent is the device\'s own and the two 3 km climbs are found as category 4', () => {
    expect(r?.elevation?.source).toBe('device');
    expect(r?.elevation?.gainM).toBe(a?.ascent ?? -1);
    expect(r?.climbs.length).toBeGreaterThanOrEqual(2);
    expect(r?.climbs[0]?.category).toBe('4');
  });

  it('the best 20 minutes suggests an FTP near the head unit setting of 315 W', () => {
    expect(Math.abs((r?.ftpSuggestion?.watts ?? 0) - 315)).toBeLessThan(25);
  });
});

describe.skipIf(!has(ELEMNT))('Wahoo ELEMNT, a long ride with stops (device: timer 13471 s of 23595 s, NP 157 W, TSS 190 at FTP 220)', () => {
  const a = has(ELEMNT) ? load(ELEMNT) : null;
  const r = a ? analyse(a, 220) : null;

  it('timer, elapsed and distance are the file totals; NP within 3 % of the device', () => {
    expect(r?.times.elapsedSec).toBe(23595);
    expect(r?.times.timerSec).toBe(13471);
    expect(r?.times.movingSec).toBeLessThanOrEqual(13471);
    expect(r?.times.movingSec).toBeGreaterThan(12000);
    const np = r?.power?.normalized ?? 0;
    expect(Math.abs(np - 157) / 157).toBeLessThan(0.03);
    expect(Math.abs((r?.power?.tss ?? 0) - 190) / 190).toBeLessThan(0.06);
  });

  it('avg speed over the timer is below avg moving speed, overall is the lowest', () => {
    expect((r?.speed.avgOverallMs ?? 0) < (r?.speed.avgMs ?? 0)).toBe(true);
    expect((r?.speed.avgMs ?? 0) < (r?.speed.avgMovingMs ?? 0)).toBe(true);
  });
});

describe.skipIf(!has(EDGE500))('Garmin Edge 500, 92 km with auto-pause (device: timer 10641 s of 12691 s, ascent 541 m)', () => {
  const a = has(EDGE500) ? load(EDGE500) : null;
  const r = a ? analyse(a, null) : null;

  it('timer is the device timer and the stopped time stays inside it', () => {
    expect(r?.times.timerSec).toBe(10641);
    expect(r?.times.elapsedSec).toBe(12691);
    expect(r?.times.movingSec).toBeLessThanOrEqual(10641);
    expect(r?.times.movingSec).toBeGreaterThan(10400);
  });

  it('avg speed is over the timer: 92.6 km in 10641 s is 31.3 km/h', () => {
    expect((r?.speed.avgMs ?? 0) * 3.6).toBeCloseTo(31.33, 1);
  });

  it('ascent is the device figure; computed it is within 25 % (its barometer counts every ripple)', () => {
    expect(r?.elevation?.source).toBe('device');
    expect(r?.elevation?.gainM).toBe(a?.ascent ?? -1);
    // Without the device's totals (a phone GPS recording) the computed ascent is within 25 % of it.
    const computed = a ? analyzeRide({ workout: { start: a.start, end: a.end, duration: a.timerSeconds, distance: a.distance, calories: 0, sportType: 3, sportName: 'Cycling' }, summary: {}, points: a.points, profile: PROFILE }) : null;
    expect(computed?.elevation?.source).toBe('computed');
    const ratio = (computed?.elevation?.gainM ?? 0) / (a?.ascent ?? 1);
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(1.25);
  });

  it('cadence average leaves coasting out (above the device figure that counts zeros)', () => {
    expect(r?.cadence?.avg).toBeGreaterThan(80);
    expect((r?.cadence?.coastingSec ?? 0) > 1000).toBe(true);
  });
});

describe.skipIf(!has(COROS))('COROS Pace 2 mountain ride (device: ascent 938 m, no power)', () => {
  const a = has(COROS) ? load(COROS) : null;
  const r = a ? analyse(a, null) : null;

  it('ascent within 10 % of the device, climbs of category 3 and 4 are found, calories stay the device figure', () => {
    expect(r?.elevation?.gainM).toBe(a?.ascent ?? -1);
    const computed = a ? analyzeRide({ workout: { start: a.start, end: a.end, duration: a.timerSeconds, distance: a.distance, calories: a.calories, sportType: 3, sportName: 'Cycling' }, summary: {}, points: a.points, profile: PROFILE }) : null;
    const ratio = (computed?.elevation?.gainM ?? 0) / (a?.ascent ?? 1);
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
    expect(r?.climbs.length).toBeGreaterThanOrEqual(4);
    expect(r?.climbs.some((c) => c.category === '3')).toBe(true);
    expect(r?.calories?.source).toBe('device');
    expect(r?.power).toBeNull();
  });
});

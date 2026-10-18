import { describe, expect, it } from 'bun:test';

import { analyzeRide } from '@/features/cycling/analyzeRide';
import { rideUploadFields } from '@/features/cycling/forStrava';
import { PROFILE, rideInput, syntheticPoints, T0 } from '@/features/cycling/rideFixtures';
import { parseFitActivity } from '@/features/fitimport/parseFit';

import { buildFit, buildUploadForm, stravaSport, type StravaWorkout } from './activityFile';
import { decodeFit } from './testDecode';

const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

describe('Strava activity type of a bike workout', () => {
  it('outdoors Ride, indoors VirtualRide, and EBikeRide only when the person marked an outdoor ride', () => {
    expect(stravaSport(3)).toMatchObject({ sportType: 'Ride', fitSport: 2, fitSubSport: 0 });
    expect(stravaSport(7)).toMatchObject({ sportType: 'VirtualRide', fitSport: 2, fitSubSport: 6, trainer: false });
    expect(stravaSport(141).sportType).toBe('VirtualRide');
    expect(stravaSport(3, true)).toMatchObject({ sportType: 'EBikeRide', fitSport: 2, fitSubSport: 28 });
    expect(stravaSport(7, true).sportType).toBe('VirtualRide');
    expect(stravaSport(1, true).sportType).toBe('Run');
  });

  it('the upload form carries the type', () => {
    const base: StravaWorkout = { start: T0, end: T0 + 600, sportType: 3, sportName: 'Cycling', duration: 600, distance: 5000, calories: 100, avgHr: null, maxHr: null };
    const field = (w: StravaWorkout) => /name="sport_type"\r\n\r\n(.*)\r\n/.exec(latin1(buildUploadForm(w, new Uint8Array([1]), { addLink: false }).body))?.[1];
    expect(field(base)).toBe('Ride');
    expect(field({ ...base, ebike: true })).toBe('EBikeRide');
    expect(field({ ...base, sportType: 7 })).toBe('VirtualRide');
    expect(latin1(buildUploadForm({ ...base, sportType: 7 }, new Uint8Array([1]), { addLink: false }).body)).not.toContain('name="trainer"');
  });
});

describe('ride metrics in the FIT session', () => {
  const workout: StravaWorkout = {
    start: T0,
    end: T0 + 3600,
    sportType: 3,
    sportName: 'Cycling',
    duration: 3600,
    distance: 32400,
    calories: 700,
    avgHr: 150,
    maxHr: 170,
    avgPower: 300,
    maxPower: 600,
    normalizedPower: 310,
    ride: { tss: 144.4, intensityFactor: 1.24, ftp: 250, workKj: 1080, balanceLeftPct: 48.6, avgGradePct: 1.5, maxGradePct: 9.8, minGradePct: -7.2 },
  };
  const built = buildFit(workout, [], { utcOffsetSeconds: 0 });
  const decoded = decodeFit(built.bytes);
  const session = decoded.messages.sessionMesgs?.[0];

  it('is a valid file', () => {
    expect(decoded.errors).toEqual([]);
    expect(decoded.integrity).toBe(true);
  });

  it('carries NP, TSS, IF, FTP, work, balance and grades where FIT has fields for them', () => {
    expect(session?.normalizedPower).toBe(310);
    expect(session?.trainingStressScore).toBeCloseTo(144.4, 1);
    expect(session?.intensityFactor).toBeCloseTo(1.24, 3);
    expect(session?.thresholdPower).toBe(250);
    expect(session?.totalWork).toBe(1_080_000);
    expect(session?.avgGrade).toBeCloseTo(1.5, 2);
    expect(session?.maxPosGrade).toBeCloseTo(9.8, 2);
    expect(session?.maxNegGrade).toBeCloseTo(-7.2, 2);
    // left_right_balance_100: 48.60 % in hundredths, left pedal (right flag 0x8000 clear).
    expect(Number(session?.leftRightBalance) & 0x3fff).toBe(4860);
    expect(Number(session?.leftRightBalance) & 0x8000).toBe(0);
    expect(decoded.messages.lapMesgs?.[0]?.normalizedPower).toBe(310);
  });

  it('leaves them out for a ride that has none', () => {
    const plain = decodeFit(buildFit({ ...workout, ride: undefined }, [], { utcOffsetSeconds: 0 }).bytes).messages.sessionMesgs?.[0];
    expect(plain?.trainingStressScore).toBeUndefined();
    expect(plain?.leftRightBalance).toBeUndefined();
    expect(plain?.totalWork).toBeUndefined();
  });

  it('writes the e-bike sub sport', () => {
    const e = decodeFit(buildFit({ ...workout, ebike: true }, [], { utcOffsetSeconds: 0 }).bytes).messages.sessionMesgs?.[0];
    expect(Number(e?.subSport)).toBe(28);
    expect(Number(e?.sport)).toBe(2);
  });
});

describe('a ride through the FIT file and back', () => {
  const opts = {
    secs: 3000,
    speed: (t: number) => 8 + Math.sin(t / 60),
    speedChannel: true,
    gps: true,
    power: (t: number) => 180 + (Math.floor(t / 90) % 3) * 70,
    cadence: (t: number) => (t % 40 < 8 ? 0 : 88),
    hr: (t: number) => 130 + Math.floor(t / 100),
    alt: (t: number) => 50 + t / 20,
  } as const;

  it('NP, average power, cadence and distance survive the Strava file and the FIT import', () => {
    const input = rideInput(opts);
    const direct = analyzeRide(input);
    const fields = rideUploadFields(input.workout, input.summary, input.points, PROFILE);
    expect(fields.normalizedPower).toBe(direct.power?.normalized as number);
    expect(fields.ride?.tss).toBe(direct.power?.tss as number);
    const built = buildFit(
      { ...input.workout, avgHr: null, maxHr: null, ...fields },
      syntheticPoints(opts).map((p) => ({ ts: p.ts, lat: p.lat ?? null, lon: p.lon ?? null, alt: p.alt ?? null, hr: p.hr ?? null, speed: p.speed ?? null, cadence: p.cadence ?? null, power: p.power ?? null })),
      { utcOffsetSeconds: 0 },
    );
    const parsed = parseFitActivity(built.bytes);
    expect('ok' in parsed).toBe(false);
    if ('ok' in parsed) return;
    expect(parsed.normalizedPower).toBe(direct.power?.normalized as number);
    expect(parsed.avgPower).toBe(direct.power?.avg as number);
    expect(parsed.distance).toBeCloseTo(input.workout.distance, -1);
    const again = analyzeRide({
      workout: { start: parsed.start, end: parsed.end, duration: parsed.timerSeconds, distance: parsed.distance, calories: 0, sportType: 3, sportName: 'Cycling' },
      summary: {},
      points: parsed.points,
      profile: PROFILE,
    });
    expect(Math.abs((again.power?.normalized ?? 0) - (direct.power?.normalized ?? 0))).toBeLessThanOrEqual(1);
    expect(again.power?.tss).toBeCloseTo(direct.power?.tss as number, 0);
    expect(again.cadence?.avg).toBe(direct.cadence?.avg as number);
  });

  it('only a bike gets the extra fields', () => {
    const input = rideInput(opts, { workout: { sportName: 'Outdoor Run', sportType: 1 } });
    expect(rideUploadFields(input.workout, input.summary, input.points, PROFILE)).toEqual({});
  });
});

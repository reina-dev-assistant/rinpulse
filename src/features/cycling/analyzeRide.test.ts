import { describe, expect, it } from 'bun:test';

import { keytelKcalPerMin } from '@/features/record/energy';

import { analyzeRide, cyclingMet, KCAL_PER_KJ } from './analyzeRide';
import { climbCategory } from './climbs';
import { referenceNormalizedPower, rideInput } from './rideFixtures';
import { virtualSpeedMs } from './series';

const HOUR = 3600;

describe('power metrics against the textbook formulas', () => {
  it('1 h at 250 W with FTP 250: NP 250, IF 1.00, TSS 100, VI 1.00, 900 kJ', () => {
    const r = analyzeRide(rideInput({ secs: HOUR, power: () => 250 }));
    expect(r.power?.normalized).toBe(250);
    expect(r.power?.intensityFactor).toBe(1);
    expect(r.power?.tss).toBe(100);
    expect(r.power?.variabilityIndex).toBe(1);
    expect(r.power?.workKj).toBe(900);
    expect(r.power?.avgWkg).toBeCloseTo(250 / 75, 2);
  });

  it('1 h at 200 W with FTP 250: IF 0.80 and TSS 64 (= 3600 x NP x IF / (FTP x 3600) x 100)', () => {
    const r = analyzeRide(rideInput({ secs: HOUR, power: () => 200 }));
    expect(r.power?.intensityFactor).toBe(0.8);
    expect(r.power?.tss).toBe(64);
  });

  it('a variable ride matches an independent NP implementation', () => {
    const watts = Array.from({ length: 5400 + 1 }, (_, t) => (Math.floor(t / 60) % 2 === 0 ? 300 : 100) + (t % 7) * 5);
    const r = analyzeRide(rideInput({ secs: 5400, power: (t) => watts[t]! }));
    // The ride's samples are seconds 0..5400; the reference works on the same 5401 values.
    expect(r.power?.normalized).toBeCloseTo(referenceNormalizedPower(watts), 0);
    expect(r.power?.variabilityIndex).toBeGreaterThan(1.1);
  });

  it('a pause of the recorder is dropped before rolling: NP does not change, the 20 min best does not bridge it', () => {
    const solid = analyzeRide(rideInput({ secs: 3000, power: (t) => (t < 1500 ? 180 : 260) }));
    const withGap = analyzeRide(rideInput({ secs: 3600, power: (t) => (t - (t >= 1800 ? 600 : 0) < 1500 ? 180 : 260), gaps: [[1500, 2100]] }));
    expect(withGap.power?.normalized).toBeCloseTo(solid.power?.normalized as number, 0);
  });

  it('coasting seconds are zeros inside the timer: average falls, NP stays above it', () => {
    const r = analyzeRide(rideInput({ secs: 1800, power: (t) => (t % 60 < 30 ? 300 : 0) }));
    expect(r.power?.avg).toBe(150);
    expect(r.power?.normalized as number).toBeGreaterThan(150);
    expect(r.power?.zeroSec).toBeGreaterThan(850);
  });

  it('Coggan zones from FTP 200: 50, 65, 85, 95, 110, 130 and 170 percent land in z1 to z7', () => {
    const levels = [100, 130, 170, 190, 220, 260, 340];
    const r = analyzeRide(rideInput({ secs: levels.length * 60, power: (t) => levels[Math.min(levels.length - 1, Math.floor(t / 60))]! }, { profile: { ftp: 200 } }));
    const zones = r.power?.zones;
    expect(zones?.map((z) => z.key)).toEqual(['z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7']);
    expect(zones?.map((z) => z.fromW)).toEqual([0, 110, 150, 180, 210, 240, 300]);
    expect(zones?.map((z) => z.sec)).toEqual([60, 60, 60, 60, 60, 60, 61]);
  });

  it('no FTP: no IF, no TSS, no zones, no load from power', () => {
    const r = analyzeRide(rideInput({ secs: 1200, power: () => 200 }, { profile: { ftp: null } }));
    expect(r.power?.intensityFactor).toBeNull();
    expect(r.power?.tss).toBeNull();
    expect(r.power?.zones).toBeNull();
    expect(r.load.basis).toBeNull();
  });

  it('the power curve of a ramp is the textbook mean of its last seconds', () => {
    const r = analyzeRide(rideInput({ secs: 3600, power: (t) => t / 3 }));
    const best = (sec: number) => r.power?.curve.find((e) => e.sec === sec)?.watts;
    // t / 3 for t = 0..3600 (3601 samples): the best d seconds are the last d.
    expect(best(5)).toBe(Math.round(((3600 + 3596) / 2) / 3));
    expect(best(60)).toBe(Math.round(((3600 + 3541) / 2) / 3));
    expect(best(1200)).toBe(Math.round(((3600 + 2401) / 2) / 3));
    expect(best(3600)).toBe(Math.round(((3600 + 1) / 2) / 3));
    expect(best(7200)).toBeUndefined();
  });

  it('suggests 95 percent of the best 20 minutes as FTP, and only then', () => {
    expect(analyzeRide(rideInput({ secs: 1500, power: () => 300 })).ftpSuggestion).toEqual({ watts: 285, best20Watts: 300 });
    expect(analyzeRide(rideInput({ secs: 900, power: () => 300 })).ftpSuggestion).toBeNull();
  });

  it('reports the pedal balance a summary carries', () => {
    const r = analyzeRide(rideInput({ secs: 600, power: () => 200 }, { summary: { balanceLeftPct: 48.6 } }));
    expect(r.power?.balanceLeftPct).toBe(48.6);
  });
});

describe('speed, moving time and distance', () => {
  const stops = (t: number) => (t >= 300 && t < 420 ? 0 : t >= 600 && t < 660 ? 0.8 : 6);

  it('a bike stands still below 1 m/s: 2 min stopped and 1 min at 0.8 m/s are 3 min of stopped time (running would count the slow minute)', () => {
    const r = analyzeRide(rideInput({ secs: 1200, speed: stops, speedChannel: true, gps: true }));
    expect(r.times.elapsedSec).toBe(1200);
    expect(r.times.timerSec).toBe(1200);
    expect(Math.abs(r.times.movingSec - (1200 - 180))).toBeLessThanOrEqual(6);
    expect(Math.abs(r.times.stoppedSec - 180)).toBeLessThanOrEqual(6);
  });

  it('avg speed is over the timer, avg moving speed over moving time, overall over elapsed; all in m/s for km/h', () => {
    const input = rideInput({ secs: 1200, speed: stops, speedChannel: true, gps: true });
    const r = analyzeRide(input);
    const d = input.workout.distance;
    expect(r.speed.avgMs).toBeCloseTo(d / 1200, 2);
    expect(r.speed.avgMovingMs).toBeCloseTo(d / r.times.movingSec, 2);
    expect(r.speed.avgMovingMs as number).toBeGreaterThan(r.speed.avgMs as number);
    expect(r.speed.avgOverallMs).toBeCloseTo(d / 1200, 2);
    expect(r.speed.maxMs as number).toBeGreaterThan(5.9);
    expect(r.speed.source).toBe('sensor');
  });

  it('a watch timer shorter than the elapsed time by a pause (30 s or more) is the timer; the moving time never exceeds it', () => {
    const r = analyzeRide(rideInput({ secs: 1200, speed: () => 6, speedChannel: true, gps: true }, { workout: { duration: 1000 } }));
    expect(r.times.timerSec).toBe(1000);
    expect(r.times.movingSec).toBeLessThanOrEqual(1000);
  });

  it('distance is the recorder total and splits are every 5 km, partial one kept from 500 m', () => {
    const r = analyzeRide(rideInput({ secs: 2300, speed: () => 10, speedChannel: true, gps: true }));
    expect(r.distanceM).toBe(23000);
    expect(r.splits.map((s) => s.distM)).toEqual([5000, 5000, 5000, 5000, 3000]);
    expect(r.splits[0]?.sec).toBe(500);
    expect(r.splits[0]?.avgSpeedKmh).toBe(36);
    expect(r.splits[4]?.avgSpeedKmh).toBe(36);
  });

  it('laps come from the device and carry their own averages', () => {
    const input = rideInput({ secs: 1200, speed: () => 5, speedChannel: true, gps: true, power: (t) => (t < 600 ? 150 : 250), cadence: () => 80 });
    input.summary.laps = [
      { startTs: input.workout.start, endTs: input.workout.start + 600, distanceM: null, avgHr: null, maxHr: null, avgCadence: null },
      { startTs: input.workout.start + 600, endTs: input.workout.start + 1200, distanceM: null, avgHr: null, maxHr: null, avgCadence: null },
    ];
    const r = analyzeRide(input);
    expect(r.laps).toHaveLength(2);
    expect(r.laps[0]?.avgPower).toBe(150);
    expect(r.laps[1]?.avgPower).toBe(250);
    expect(r.laps[1]?.startSec).toBe(600);
    expect(r.laps[0]?.avgSpeedKmh).toBe(18);
  });
});

describe('elevation, grade and climbs', () => {
  /** Flat 1 km, a 6 % climb of 2 km (+120 m), flat 1 km, then back down the same 120 m over 2 km. Ridden at 5 m/s. */
  const alt = (t: number) => {
    const d = t * 5;
    if (d < 1000) return 100;
    if (d < 3000) return 100 + (d - 1000) * 0.06;
    if (d < 4000) return 220;
    if (d < 6000) return 220 - (d - 4000) * 0.06;
    return 100;
  };
  const ride = () => analyzeRide(rideInput({ secs: 1400, speed: () => 5, speedChannel: true, gps: true, alt }));

  it('gain and loss are the profile (120 m each, within the smoothing), min and max are exact', () => {
    const e = ride().elevation;
    expect(e?.source).toBe('computed');
    expect(e?.gainM as number).toBeGreaterThan(110);
    expect(e?.gainM as number).toBeLessThan(125);
    expect(e?.lossM as number).toBeGreaterThan(110);
    expect(e?.lossM as number).toBeLessThan(125);
    expect(e?.minM).toBeCloseTo(100, 0);
    expect(e?.maxM).toBeCloseTo(220, 0);
    expect(e?.avgGradePct).toBeCloseTo(0, 0);
    expect(e?.maxGradePct as number).toBeGreaterThan(5);
    expect(e?.maxGradePct as number).toBeLessThan(7);
    expect(e?.minGradePct as number).toBeLessThan(-5);
  });

  it('a device ascent in the summary is used as it is, a phone recording\'s own computed one is not', () => {
    const opts = { secs: 1400, speed: () => 5, speedChannel: true, gps: true, alt } as const;
    const device = analyzeRide(rideInput(opts, { summary: { importedFrom: 'Garmin', elevationGain: 200, elevationLoss: 190, ascentSource: 'device' } }));
    expect(device.elevation).toMatchObject({ source: 'device', gainM: 200, lossM: 190 });
    const phone = analyzeRide(rideInput(opts, { summary: { elevationGain: 500, elevationLoss: 500, ascentSource: 'computed' } }));
    expect(phone.elevation?.source).toBe('computed');
    expect(phone.elevation?.gainM as number).toBeLessThan(130);
  });

  it('finds the 2 km climb: length, gain, 6 % grade and Garmin category 4 (score 12 000)', () => {
    const climbs = ride().climbs;
    expect(climbs).toHaveLength(1);
    const c = climbs[0]!;
    expect(Math.abs(c.lengthM - 2000)).toBeLessThan(150);
    expect(Math.abs(c.gainM - 120)).toBeLessThan(10);
    expect(Math.abs(c.avgGradePct - 6)).toBeLessThan(0.6);
    expect(c.category).toBe('4');
    expect(c.score).toBeGreaterThan(10500);
    expect(c.sec).toBeGreaterThan(350);
    expect(c.vam as number).toBeGreaterThan(900);
  });

  it('does not call a short steep ramp or a long gentle slope a climb', () => {
    const shortSteep = (t: number) => (t * 5 < 1000 ? 100 : t * 5 < 1400 ? 100 + (t * 5 - 1000) * 0.08 : 132);
    const gentle = (t: number) => 100 + t * 5 * 0.02;
    expect(analyzeRide(rideInput({ secs: 600, speed: () => 5, speedChannel: true, gps: true, alt: shortSteep })).climbs).toHaveLength(0);
    expect(analyzeRide(rideInput({ secs: 1000, speed: () => 5, speedChannel: true, gps: true, alt: gentle })).climbs).toHaveLength(0);
  });

  it('a recording gap does not make a climb or a grade out of a lift home', () => {
    const jump = (t: number) => (t < 300 ? 100 : 160);
    const r = analyzeRide(rideInput({ secs: 900, speed: () => 5, speedChannel: true, gps: true, alt: jump, gaps: [[300, 600]] }));
    expect(r.climbs).toHaveLength(0);
    expect(Math.abs(r.elevation?.maxGradePct ?? 0)).toBeLessThan(1);
  });

  it('climb categories follow Garmin ClimbPro scores (greater than 8k, 16k, 32k, 64k, 80k)', () => {
    expect(climbCategory(1500)).toBe('none');
    expect(climbCategory(8000)).toBe('none');
    expect(climbCategory(8001)).toBe('4');
    expect(climbCategory(16001)).toBe('3');
    expect(climbCategory(32001)).toBe('2');
    expect(climbCategory(64001)).toBe('1');
    expect(climbCategory(80001)).toBe('hc');
  });

  it('indoors there is no elevation and no climbs', () => {
    const r = analyzeRide(rideInput({ secs: 900, power: () => 200, alt: () => 100 }));
    expect(r.indoor).toBe(true);
    expect(r.elevation).toBeNull();
    expect(r.climbs).toEqual([]);
  });
});

describe('cadence', () => {
  it('coasting is left out of the average and counted apart; bands add up to the covered time', () => {
    const r = analyzeRide(rideInput({ secs: 1000, speed: () => 6, speedChannel: true, gps: true, cadence: (t) => (t % 2 === 0 ? 90 : 0) }));
    expect(r.cadence?.avg).toBe(90);
    expect(r.cadence?.max).toBe(90);
    expect(r.cadence?.coastingSec).toBeGreaterThan(480);
    expect(r.cadence?.bands[0]?.sec).toBe(r.cadence?.coastingSec);
    expect(r.cadence?.bands.find((b) => b.fromRpm === 90)?.sec).toBe(r.cadence?.pedallingSec);
    expect(r.cadence?.bands.reduce((a, b) => a + b.sec, 0)).toBe(1001);
  });
});

describe('heart rate', () => {
  it('aerobic decoupling: Pw:Hr falls by the heart rate drift (first half 140, second half 147 = 4.76 %)', () => {
    const r = analyzeRide(rideInput({ secs: 5400, speed: () => 8, speedChannel: true, gps: true, power: () => 200, hr: (t) => (t < 2700 + 300 ? 140 : 147) }));
    expect(r.hr.decoupling?.basis).toBe('power');
    expect(r.hr.decoupling?.pct).toBeCloseTo(((1 - 140 / 147) * 100), 0);
  });

  it('no decoupling for a short ride, or without heart rate', () => {
    expect(analyzeRide(rideInput({ secs: 1800, speed: () => 8, speedChannel: true, gps: true, power: () => 200, hr: () => 140 })).hr.decoupling).toBeNull();
    expect(analyzeRide(rideInput({ secs: 5400, speed: () => 8, speedChannel: true, gps: true, power: () => 200 })).hr.decoupling).toBeNull();
  });

  it('without power the decoupling uses speed (Pa:Hr)', () => {
    const r = analyzeRide(rideInput({ secs: 5400, speed: () => 8, speedChannel: true, gps: true, hr: (t) => (t < 3000 ? 140 : 154) }));
    expect(r.hr.decoupling?.basis).toBe('speed');
    expect(r.hr.decoupling?.pct as number).toBeGreaterThan(5);
  });
});

describe('calories: power, then heart rate, then MET', () => {
  it('power: 200 W for an hour is 720 kJ, about as many kcal (24 % efficiency)', () => {
    const r = analyzeRide(rideInput({ secs: HOUR, power: () => 200, hr: () => 120 }));
    expect(r.power?.workKj).toBe(720);
    expect(r.calories).toEqual({ kcal: Math.round(720 * KCAL_PER_KJ), source: 'power' });
    expect(Math.abs(720 * KCAL_PER_KJ - 720)).toBeLessThan(5);
  });

  it('heart rate (Keytel) when there is no power and no stored energy', () => {
    const r = analyzeRide(rideInput({ secs: HOUR, speed: () => 7, speedChannel: true, gps: true, hr: () => 140 }));
    expect(r.calories?.source).toBe('hr');
    const expected = keytelKcalPerMin(140, { weightKg: 75, age: 35, sex: 'male' }) * 60;
    expect(Math.abs((r.calories?.kcal ?? 0) - expected)).toBeLessThan(expected * 0.02);
  });

  it('MET by speed when there is neither: 25 km/h is 10 MET', () => {
    expect(cyclingMet(25)).toBe(10);
    expect(cyclingMet(10)).toBe(4);
    expect(cyclingMet(40)).toBe(15.8);
    const r = analyzeRide(rideInput({ secs: HOUR, speed: () => 25 / 3.6, speedChannel: true, gps: true }));
    expect(r.calories?.source).toBe('met');
    expect(Math.abs((r.calories?.kcal ?? 0) - 10 * 75)).toBeLessThan(30);
  });

  it('the device figure stands in when there is no power', () => {
    const r = analyzeRide(rideInput({ secs: 1200, speed: () => 7, speedChannel: true, gps: true, hr: () => 140 }, { workout: { calories: 321 } }));
    expect(r.calories).toEqual({ kcal: 321, source: 'device' });
  });
});

describe('indoor rides', () => {
  it('without a wheel sensor the speed is the flat-road model of the power, and the distance follows it', () => {
    const r = analyzeRide(rideInput({ secs: 1800, power: () => 200 }, { workout: { distance: 0 } }));
    expect(r.indoor).toBe(true);
    expect(r.speed.source).toBe('power');
    const v = virtualSpeedMs(200, 75);
    expect(v * 3.6).toBeGreaterThan(28);
    expect(v * 3.6).toBeLessThan(36);
    expect(r.distanceM as number).toBeGreaterThan(v * 1790);
    expect(r.distanceM as number).toBeLessThan(v * 1810);
  });

  it('the model is monotonic and zero without power', () => {
    expect(virtualSpeedMs(0, 75)).toBe(0);
    expect(virtualSpeedMs(300, 75)).toBeGreaterThan(virtualSpeedMs(200, 75));
    expect(virtualSpeedMs(200, 95)).toBeLessThan(virtualSpeedMs(200, 55));
  });

  it('a wheel sensor beats the model', () => {
    const r = analyzeRide(rideInput({ secs: 600, power: () => 200, speed: () => 7, speedChannel: true }));
    expect(r.speed.source).toBe('sensor');
    expect(r.speed.avgMovingMs).toBeCloseTo(7, 1);
  });
});

describe('training load', () => {
  it('TSS-based when there is power and FTP (TSS x 2.4 as TRIMP), heart rate TRIMP otherwise', () => {
    const withPower = analyzeRide(rideInput({ secs: HOUR, power: () => 250, hr: () => 150 }));
    expect(withPower.load.basis).toBe('tss');
    expect(withPower.load.tssTrimp).toBe(240);
    expect(withPower.load.trimpUsed).toBe(240);
    expect(withPower.load.trimp).toBeGreaterThan(0);
    const hrOnly = analyzeRide(rideInput({ secs: HOUR, speed: () => 7, speedChannel: true, gps: true, hr: () => 150 }));
    expect(hrOnly.load.basis).toBe('hr');
    expect(hrOnly.load.trimpUsed).toBe(hrOnly.load.trimp);
  });
});

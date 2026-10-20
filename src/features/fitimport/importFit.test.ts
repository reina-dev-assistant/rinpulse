import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';

import { Encoder, Profile } from '@garmin/fitsdk';

import migrations from '../../../modules/huawei-wear/schema/joyofit-db-migrations.json';
import { buildActivityFile } from './fitFixture';
import { applyLocale } from '@/i18n';
import { importFit, type FitImportDb } from './importFit';
import { parseFitActivity, sportFor } from './parseFit';

const START = 1_792_058_016;

/** The real schema (the migrations the app and the native side share) in memory, behind the slice of expo-sqlite the import uses. */
function openDb() {
  const raw = new Database(':memory:');
  for (const statements of migrations) raw.exec(statements.join(';\n'));
  const flat = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? params[0] : params) as never[];
  const txn = {
    getAllAsync: async (sql: string, ...params: unknown[]) => raw.query(sql).all(...flat(params)),
    runAsync: async (sql: string, ...params: unknown[]) => {
      const r = raw.query(sql).run(...flat(params));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes };
    },
  };
  const db = {
    ...txn,
    withExclusiveTransactionAsync: async (task: (t: typeof txn) => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await task(txn);
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as FitImportDb;
  const one = <T>(sql: string, ...params: unknown[]) => raw.query(sql).get(...(params as never[])) as T;
  const all = <T>(sql: string, ...params: unknown[]) => raw.query(sql).all(...(params as never[])) as T[];
  return { raw, db, one, all };
}

/** A workout the watch synced (`imported = 0`), the way `WorkoutStore` writes it. */
function watchWorkout(raw: Database, start: number, end: number) {
  raw.exec(
    `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, imported)
     VALUES (7, ${start}, ${end}, 3, 'Biking', ${end - start}, 15000, 600, 130, 160, 0, '{}', 1, 0)`,
  );
}

describe('parseFitActivity', () => {
  it('reads the session totals, the records and the brand of a cycling file', () => {
    const a = parseFitActivity(buildActivityFile({ start: START, elapsed: 3600, distance: 20_000 }));
    if (!('start' in a)) throw new Error(a.message);
    expect(a.start).toBe(START);
    expect(a.end).toBe(START + 3600);
    expect(a.sport.type).toBe(3);
    expect(a.name).toBe('Ride (iGPSPORT)');
    expect(a.timerSeconds).toBe(3600);
    expect(a.distance).toBe(20_000);
    expect(a.calories).toBe(900);
    expect(a.avgHr).toBe(140);
    expect(a.maxHr).toBe(171);
    expect(a.avgSpeed).toBeCloseTo(20_000 / 3600, 2);
    expect(a.maxSpeed).toBeCloseTo(14, 2);
    expect(a.ascent).toBe(310);
    expect(a.avgCadence).toBe(85);
    expect(a.avgPower).toBe(200);
    expect(a.maxPower).toBe(640);
    expect(a.normalizedPower).toBe(215);
    expect(a.points).toHaveLength(361);
    expect(a.points[0]?.ts).toBe(START);
    expect(a.points[0]?.lat).toBeCloseTo(-6.2, 6);
    expect(a.points[0]?.lon).toBeCloseTo(106.8, 6);
    expect(a.points[0]?.alt).toBeCloseTo(10, 1);
    expect(a.points[0]?.hr).toBe(120);
  });

  it('names the workout after the sport alone when the manufacturer is not a known brand', () => {
    const dev = parseFitActivity(buildActivityFile({ start: START, manufacturer: 255 }));
    const none = parseFitActivity(buildActivityFile({ start: START, manufacturer: null }));
    expect('name' in dev && dev.name).toBe('Ride');
    expect('name' in none && none.name).toBe('Ride');
  });

  it('reads records without GPS', () => {
    const a = parseFitActivity(buildActivityFile({ start: START, withGps: false, sport: 2, subSport: 6 }));
    if (!('start' in a)) throw new Error(a.message);
    expect(a.sport.type).toBe(7);
    expect(a.points.every((p) => p.lat === null && p.lon === null)).toBe(true);
    expect(a.points[3]?.hr).toBe(123);
  });

  it('keeps speed, cadence and power of every record; a bike cadence stays in rpm and a file with one lap has no laps', () => {
    const a = parseFitActivity(buildActivityFile({ start: START, elapsed: 3600, distance: 20_000 }));
    if (!('start' in a)) throw new Error(a.message);
    expect(a.points[0]?.speed).toBeCloseTo(20_000 / 3600, 2);
    expect(a.points[0]?.cadence).toBe(85);
    expect(a.points[0]?.power).toBe(200);
    expect(a.points[0]?.stride).toBeNull();
    expect(a.laps).toEqual([]);
  });

  it('doubles the per-leg cadence of a foot sport, adds fractional_cadence first, and converts step_length from millimetres', () => {
    const a = parseFitActivity(buildActivityFile({ start: START, elapsed: 1800, distance: 5000, sport: 1, stepLength: true, fractionalCadence: true }));
    if (!('start' in a)) throw new Error(a.message);
    // (85 + 0.5) strides per minute are 171 steps per minute.
    expect(a.points[0]?.cadence).toBe(171);
    expect(a.points[0]?.stride).toBeCloseTo(1.05, 6);
    expect(a.points.every((p) => p.cadence === 171 && p.stride !== null)).toBe(true);
  });

  it('keeps a run\'s session cadence as strides per minute and its avg_step_length as metres, and a bike has no step length', () => {
    const run = parseFitActivity(buildActivityFile({ start: START, elapsed: 1800, distance: 5000, sport: 1, sessionStepLength: true }));
    if (!('start' in run)) throw new Error(run.message);
    expect(run.avgCadence).toBe(85);
    expect(run.maxCadence).toBe(112);
    expect(run.avgStepLength).toBeCloseTo(1.05, 6);
    const ride = parseFitActivity(buildActivityFile({ start: START, elapsed: 1800, distance: 5000 }));
    if (!('start' in ride)) throw new Error(ride.message);
    expect(ride.avgStepLength).toBeNull();
  });

  it('leaves cadence null on every record of a file that has none, while the session keeps its average', () => {
    const a = parseFitActivity(buildActivityFile({ start: START, elapsed: 1800, distance: 5000, sport: 1, cadence: null }));
    if (!('start' in a)) throw new Error(a.message);
    expect(a.points.every((p) => p.cadence === null)).toBe(true);
    expect(a.avgCadence).toBe(85);
  });

  it('adds the session\'s fractional cadence to its average and maximum (per leg), keeping both decimals', () => {
    const a = parseFitActivity(buildActivityFile({ start: START, elapsed: 1800, distance: 5000, sport: 1, sessionFractionalCadence: true }));
    if (!('start' in a)) throw new Error(a.message);
    expect(a.avgCadence).toBe(85.5);
    expect(a.maxCadence).toBe(112.25);
  });

  it('doubles a per-leg run cadence, and reads a writer that counts steps from its own speed and step length', () => {
    // 5000 m in 1800 s is 2.78 m/s; at a 1.05 m step that is 158.7 steps per minute.
    const perLeg = parseFitActivity(buildActivityFile({ start: START, elapsed: 1800, distance: 5000, sport: 1, stepLength: true, cadence: 79 }));
    if (!('start' in perLeg)) throw new Error(perLeg.message);
    expect(perLeg.cadencePerLeg).toBe(true);
    expect(perLeg.points[5]?.cadence).toBe(158);
    const steps = parseFitActivity(buildActivityFile({ start: START, elapsed: 1800, distance: 5000, sport: 1, stepLength: true, cadence: 159 }));
    if (!('start' in steps)) throw new Error(steps.message);
    expect(steps.cadencePerLeg).toBe(false);
    expect(steps.points[5]?.cadence).toBe(159);
  });

  it('keeps FIT\'s per-leg reading when the file has no step length to check it against, and never doubles an impossible one', () => {
    const noStep = parseFitActivity(buildActivityFile({ start: START, elapsed: 1800, distance: 5000, sport: 1, cadence: 159 }));
    if (!('start' in noStep)) throw new Error(noStep.message);
    expect(noStep.cadencePerLeg).toBe(true);
    // 159 per leg would be 318 steps per minute: the writer counted steps.
    expect(noStep.points[5]?.cadence).toBe(159);
  });

  it('reads the lap messages of a file with two or more laps', () => {
    const a = parseFitActivity(buildActivityFile({ start: START, elapsed: 3600, distance: 20_000, laps: 3 }));
    if (!('start' in a)) throw new Error(a.message);
    expect(a.laps).toHaveLength(3);
    expect(a.laps[0]).toEqual({ startTs: START, endTs: START + 1200, distanceM: expect.closeTo(6666.67, 1), avgHr: 130, maxHr: 160, avgCadence: 80 });
    expect(a.laps[2]).toMatchObject({ startTs: START + 2400, endTs: START + 3600, avgHr: 132, maxHr: 162, avgCadence: 82 });

    const run = parseFitActivity(buildActivityFile({ start: START, elapsed: 1800, distance: 5000, sport: 1, laps: 2 }));
    if (!('start' in run)) throw new Error(run.message);
    expect(run.laps.map((l) => l.avgCadence)).toEqual([160, 162]);
  });

  it('reads enhanced_speed, leaves absent readings null and keeps real zeros', () => {
    const encoder = new Encoder();
    const at = (offset: number) => new Date((START + offset) * 1000);
    encoder.onMesg(Profile.MesgNum.FILE_ID, { type: 'activity', manufacturer: 'garmin', product: 1, timeCreated: at(0) });
    encoder.onMesg(Profile.MesgNum.RECORD, { timestamp: at(0), heartRate: 100, enhancedSpeed: 3.5, cadence: 90, power: 0 });
    encoder.onMesg(Profile.MesgNum.RECORD, { timestamp: at(1), heartRate: 101, speed: 0 });
    encoder.onMesg(Profile.MesgNum.SESSION, { timestamp: at(60), startTime: at(0), sport: 'cycling', totalElapsedTime: 60, totalTimerTime: 60, totalDistance: 200 });
    const a = parseFitActivity(encoder.close());
    if (!('start' in a)) throw new Error(a.message);
    expect(a.points[0]).toMatchObject({ speed: 3.5, cadence: 90, power: 0, stride: null });
    expect(a.points[1]).toMatchObject({ speed: 0, cadence: null, power: null });
  });

  it('reads a file written by Garmin\'s own encoder (enhanced speed fields, two sessions added up)', () => {
    const encoder = new Encoder();
    const at = (offset: number) => new Date((START + offset) * 1000);
    encoder.onMesg(Profile.MesgNum.FILE_ID, { type: 'activity', manufacturer: 'garmin', product: 1, timeCreated: at(0) });
    for (let i = 0; i < 10; i++) {
      encoder.onMesg(Profile.MesgNum.RECORD, { timestamp: at(i * 60), positionLat: 74_000_000 + i * 1000, positionLong: 1_274_000_000, heartRate: 100 + i, enhancedAltitude: 50 + i });
    }
    encoder.onMesg(Profile.MesgNum.SESSION, {
      timestamp: at(300), startTime: at(0), sport: 'running', subSport: 'generic', totalElapsedTime: 300, totalTimerTime: 300, totalDistance: 1000,
      totalCalories: 80, enhancedAvgSpeed: 3.333, enhancedMaxSpeed: 4.5, avgHeartRate: 110, maxHeartRate: 120, totalCycles: 400,
    });
    encoder.onMesg(Profile.MesgNum.SESSION, {
      timestamp: at(900), startTime: at(600), sport: 'running', subSport: 'generic', totalElapsedTime: 300, totalTimerTime: 300, totalDistance: 900,
      totalCalories: 70, enhancedAvgSpeed: 3, enhancedMaxSpeed: 5, avgHeartRate: 130, maxHeartRate: 150, totalCycles: 380,
    });
    const a = parseFitActivity(encoder.close());
    if (!('start' in a)) throw new Error(a.message);
    expect(a.name).toBe('Run (Garmin)');
    expect(a.start).toBe(START);
    expect(a.end).toBe(START + 900);
    expect(a.timerSeconds).toBe(600);
    expect(a.distance).toBe(1900);
    expect(a.calories).toBe(150);
    expect(a.avgHr).toBe(120);
    expect(a.maxHr).toBe(150);
    expect(a.maxSpeed).toBeCloseTo(5, 2);
    expect(a.avgSpeed).toBeCloseTo(3.1665, 3);
    expect(a.steps).toBe(1560);
    expect(a.points[0]?.lat).toBeCloseTo((74_000_000 * 180) / 2 ** 31, 6);
    expect(a.points[0]?.alt).toBeCloseTo(50, 1);
  });

  it('rejects what is not an activity file, with a reason', () => {
    const garbage = parseFitActivity(new Uint8Array(200).fill(7));
    expect(garbage).toMatchObject({ ok: false, reason: 'not-fit' });
    expect(parseFitActivity(new Uint8Array(0))).toMatchObject({ ok: false, reason: 'not-fit' });

    const good = buildActivityFile({ start: START });
    const flipped = good.slice();
    flipped[Math.floor(good.length / 2)] ^= 0xff;
    expect(parseFitActivity(flipped)).toMatchObject({ ok: false, reason: 'corrupt' });
    expect(parseFitActivity(good.slice(0, good.length - 40))).toMatchObject({ ok: false, reason: 'corrupt' });

    expect(parseFitActivity(buildActivityFile({ start: START, fileType: 2 }))).toMatchObject({ ok: false, reason: 'not-activity' });
    expect(parseFitActivity(buildActivityFile({ start: START, withSession: false }))).toMatchObject({ ok: false, reason: 'no-session' });
  });
});

describe('sportFor', () => {
  it('maps cycling, running, walking and hiking to the Huawei sport types, everything else to Exercise', () => {
    expect(sportFor('cycling', 'generic').type).toBe(3);
    expect(sportFor('cycling', 'mountain').type).toBe(3);
    expect(sportFor('cycling', 'indoorCycling').type).toBe(7);
    expect(sportFor('cycling', 'virtualActivity').type).toBe(7);
    expect(sportFor('eBiking', 'generic').type).toBe(3);
    expect(sportFor('running', 'generic').type).toBe(1);
    expect(sportFor('running', 'trail').type).toBe(11);
    expect(sportFor('running', 'treadmill').type).toBe(5);
    expect(sportFor('walking', 'generic').type).toBe(2);
    expect(sportFor('walking', 'indoorWalking').type).toBe(13);
    expect(sportFor('hiking', 'generic').type).toBe(14);
    expect(sportFor('swimming', 'lapSwimming').type).toBe(255);
    expect(sportFor(undefined, undefined).type).toBe(255);
    expect(sportFor(250, 0).name).toBe('Workout');
  });
});

afterEach(() => applyLocale('id'));

describe('importFit', () => {
  it('words the result in English when the app is in English', async () => {
    await applyLocale('en');
    const { db } = openDb();
    const result = await importFit(db, ride());
    expect(result.ok && result.message).toBe('Imported Ride 42.1 km, 1:35:20');
    expect(await importFit(db, ride())).toMatchObject({ ok: false, reason: 'duplicate' });
  });

  const ride = () => buildActivityFile({ start: START, elapsed: 5720, step: 20, distance: 42_100, calories: 1010 });

  it('stores a cycling file with GPS, heart rate and power as an imported workout', async () => {
    const { db, one, all } = openDb();
    const result = await importFit(db, ride());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toBe('Berhasil mengimpor bersepeda 42,1 km, 1:35:20');
    expect(result.name).toBe('Ride (iGPSPORT)');

    const w = one<Record<string, number | string | null>>('SELECT * FROM workouts');
    expect(w).toMatchObject({
      id: result.workoutId,
      workout_number: 0,
      start: START,
      end: START + 5720,
      sport_type: 3,
      sport_name: 'Ride (iGPSPORT)',
      duration: 5720,
      distance: 42_100,
      calories: 1010,
      avg_hr: 140,
      max_hr: 171,
      steps: 0,
      complete: 1,
      imported: 1,
    });
    const summary = JSON.parse(w.summary_json as string);
    expect(summary).toMatchObject({ kind: 'CYCLING', gps: 'ok', gpsPoints: 287, avgPower: 200, maxPower: 640, avgCadence: 85, maxCadence: 112, elevationGain: 310, importedFrom: 'iGPSPORT' });
    expect(summary.avgSpeed).toBeCloseTo(42_100 / 5720, 2);

    const points = all<{ ts: number; lat: number; lon: number; alt: number; hr: number }>('SELECT ts, lat, lon, alt, hr FROM workout_points WHERE workout_id = ? ORDER BY ts', result.workoutId);
    expect(points).toHaveLength(287);
    expect(points[0]).toMatchObject({ ts: START, hr: 120 });
    expect(points[0]?.lat).toBeCloseTo(-6.2, 6);
    expect(points[286]?.ts).toBe(START + 5720);
  });

  it('counts for strain: each minute of heart rate lands in step_samples as imported, and a watch minute is left alone', async () => {
    const { db, raw, one, all } = openDb();
    const minute = START - (START % 60);
    raw.exec(`INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate, imported) VALUES (${minute + 120}, 30, 4, 20, 99, 0)`);
    await importFit(db, ride());
    const rows = all<{ timestamp: number; heart_rate: number; imported: number; steps: number }>('SELECT timestamp, heart_rate, imported, steps FROM step_samples ORDER BY timestamp');
    expect(rows.length).toBeGreaterThan(90);
    expect(rows.filter((r) => r.imported === 1).every((r) => r.steps === 0 && r.heart_rate >= 120 && r.heart_rate < 160)).toBe(true);
    expect(rows.every((r) => r.timestamp % 60 === 0)).toBe(true);
    expect(one('SELECT steps, heart_rate, imported FROM step_samples WHERE timestamp = ?', minute + 120)).toEqual({ steps: 30, heart_rate: 99, imported: 0 });
  });

  it('keeps the file out of the watch-only uploads: only imported = 1, the column the step and sleep upload, Health Connect and Strava queries exclude', async () => {
    const { db, one } = openDb();
    await importFit(db, ride());
    // The very condition of `listAutoUploadCandidates` (Strava); the JoyoRogo workout sync keeps imported workouts on purpose.
    expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM workouts WHERE complete != 0 AND imported = 0').n).toBe(0);
    expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM step_samples WHERE imported = 0').n).toBe(0);
  });

  it('adds nothing the second time the same file comes in', async () => {
    const { db, one } = openDb();
    const first = await importFit(db, ride());
    expect(first.ok).toBe(true);
    const counts = () => ({
      workouts: one<{ n: number }>('SELECT COUNT(*) AS n FROM workouts').n,
      points: one<{ n: number }>('SELECT COUNT(*) AS n FROM workout_points').n,
      minutes: one<{ n: number }>('SELECT COUNT(*) AS n FROM step_samples').n,
    });
    const before = counts();
    const again = await importFit(db, ride());
    expect(again).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(counts()).toEqual(before);
  });

  it('skips a file that overlaps a watch workout by more than half and keeps the watch workout', async () => {
    const { db, raw, one } = openDb();
    watchWorkout(raw, START + 1000, START + 5000);
    const result = await importFit(db, ride());
    expect(result).toMatchObject({ ok: false, reason: 'overlap' });
    if (!result.ok) expect(result.message).toContain('Jam kamu sudah merekam latihan ini');
    expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM workouts').n).toBe(1);
    expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM workout_points').n).toBe(0);
    expect(one<{ imported: number; sport_name: string }>('SELECT imported, sport_name FROM workouts')).toEqual({ imported: 0, sport_name: 'Biking' });
  });

  it('skips a watch workout that starts the very second the file does, however short', async () => {
    const { db, raw } = openDb();
    watchWorkout(raw, START, START + 60);
    expect(await importFit(db, ride())).toMatchObject({ ok: false, reason: 'overlap' });
  });

  it('imports a file that overlaps a watch workout by less than half', async () => {
    const { db, raw, one } = openDb();
    watchWorkout(raw, START - 3000, START + 1000);
    const result = await importFit(db, ride());
    expect(result.ok).toBe(true);
    expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM workouts').n).toBe(2);
  });

  it('reports a file that is not a FIT activity without touching the database', async () => {
    const { db, one } = openDb();
    expect(await importFit(db, new Uint8Array([1, 2, 3, 4, 5]))).toMatchObject({ ok: false, reason: 'not-fit' });
    expect(await importFit(db, buildActivityFile({ start: START, withSession: false }))).toMatchObject({ ok: false, reason: 'no-session' });
    expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM workouts').n).toBe(0);
  });

  it('imports a run with GPS and gives it a pace', async () => {
    const { db, one } = openDb();
    const result = await importFit(db, buildActivityFile({ start: START, elapsed: 1800, distance: 5000, sport: 1, manufacturer: 1, calories: 350 }));
    expect(result.ok && result.message).toBe('Berhasil mengimpor lari 5,0 km, 30:00');
    const w = one<{ sport_type: number; sport_name: string; summary_json: string }>('SELECT sport_type, sport_name, summary_json FROM workouts');
    expect(w).toMatchObject({ sport_type: 1, sport_name: 'Run (Garmin)' });
    expect(JSON.parse(w.summary_json).avgPaceSecPerKm).toBeCloseTo(360, 0);
  });

  it('stores speed, cadence, stride and power per point and the laps in the summary', async () => {
    const { db, one, all } = openDb();
    const result = await importFit(db, buildActivityFile({ start: START, elapsed: 1800, distance: 5000, sport: 1, laps: 3, stepLength: true, fractionalCadence: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const points = all<{ speed: number; cadence: number; stride: number; power: number }>(
      'SELECT speed, cadence, stride, power FROM workout_points WHERE workout_id = ? ORDER BY ts',
      result.workoutId,
    );
    expect(points).toHaveLength(181);
    expect(points[0]?.speed).toBeCloseTo(5000 / 1800, 2);
    expect(points[0]).toMatchObject({ cadence: 171, power: 200 });
    expect(points[0]?.stride).toBeCloseTo(1.05, 6);
    const summary = JSON.parse(one<{ summary_json: string }>('SELECT summary_json FROM workouts').summary_json);
    expect(summary.laps).toHaveLength(3);
    expect(summary.laps[1]).toMatchObject({ startTs: START + 600, endTs: START + 1200, avgHr: 131, maxHr: 161, avgCadence: 162 });
    expect(summary.laps[1].distanceM).toBeCloseTo(5000 / 3, 1);
  });

  it('keeps the session step length in the summary and the per-leg cadence figures the analysis doubles', async () => {
    const { db, one } = openDb();
    await importFit(db, buildActivityFile({ start: START, elapsed: 1800, distance: 5000, sport: 1, sessionStepLength: true, cadence: null }));
    const summary = JSON.parse(one<{ summary_json: string }>('SELECT summary_json FROM workouts').summary_json);
    expect(summary).toMatchObject({ avgCadence: 85, maxCadence: 112, avgStepLengthM: 1.05, importedFrom: 'iGPSPORT' });
  });

  it('leaves laps out of the summary for a file with a single lap', async () => {
    const { db, one } = openDb();
    await importFit(db, ride());
    expect(JSON.parse(one<{ summary_json: string }>('SELECT summary_json FROM workouts').summary_json).laps).toBeUndefined();
  });

  it('stores a six-hour ride sampled every second in full', async () => {
    const { db, one } = openDb();
    const result = await importFit(db, buildActivityFile({ start: START, elapsed: 21_600, step: 1, distance: 150_000 }));
    expect(result.ok && result.points).toBe(21_601);
    expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM workout_points').n).toBe(21_601);
    expect(one<{ n: number }>('SELECT COUNT(*) AS n FROM step_samples').n).toBeGreaterThanOrEqual(360);
  });
});

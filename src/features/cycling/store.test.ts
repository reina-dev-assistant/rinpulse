import { describe, expect, it } from 'bun:test';

import { listDayHeartLoad, listWorkoutPoints } from '@/db/queries';
import { openDb } from '@/features/record/testDb';
import { startOfLocalDay } from '@/features/today/stats';
import { strainFromLoads, workoutStrain } from '@/features/today/strain';

import { analyzeRide } from './analyzeRide';
import { PROFILE } from './rideFixtures';
import { allTimeCurve, applyRideLoad, ensureCyclingSchema, listRideMetrics, recordsOf, rideLoadDeltas, syncRideMetrics, type RideMetricsRow } from './store';

// Midday of three consecutive days, so local midnight arithmetic cannot move a workout to another day.
const DAY0 = startOfLocalDay(1_760_000_000) + 12 * 3600;
const day = (n: number) => DAY0 + n * 86400;

interface Seed {
  start: number;
  name: string;
  type: number;
  secs: number;
  hr?: number;
  power?: number;
  speed?: number;
}

/** Inserts a workout with 1 Hz points and the per-minute heart rate the watch would have stored for it. */
async function seed(db: Awaited<ReturnType<typeof openDb>>['db'], s: Seed): Promise<number> {
  const inserted = await db.runAsync(
    `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, imported)
     VALUES (0, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, '{}', 1, 0)`,
    [s.start, s.start + s.secs, s.type, s.name, s.secs, (s.speed ?? 0) * s.secs, s.hr ?? null, s.hr ?? null],
  );
  const id = inserted.lastInsertRowId;
  for (let t = 0; t <= s.secs; t++) {
    await db.runAsync('INSERT INTO workout_points (workout_id, ts, hr, power, speed, cadence) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      s.start + t,
      s.hr ?? null,
      s.power ?? null,
      s.speed ?? null,
      s.power !== undefined ? 85 : null,
    ]);
  }
  if (s.hr !== undefined) {
    for (let m = s.start - (s.start % 60); m <= s.start + s.secs; m += 60) {
      await db.runAsync('INSERT OR IGNORE INTO step_samples (timestamp, steps, calories, distance, heart_rate, imported) VALUES (?, 0, 0, 0, ?, 0)', [m, s.hr]);
    }
  }
  return id;
}

describe('ride metrics store', () => {
  it('computes the rides that have no row, newest first, a few per call, and never touches a run', async () => {
    const { db } = openDb();
    await ensureCyclingSchema(db);
    await seed(db, { start: day(0), name: 'Outdoor Run', type: 1, secs: 600, hr: 150, speed: 3 });
    await seed(db, { start: day(1), name: 'Cycling', type: 3, secs: 900, power: 200, hr: 140, speed: 7 });
    await seed(db, { start: day(2), name: 'Indoor cycling', type: 7, secs: 900, power: 250 });
    expect(await syncRideMetrics(db, PROFILE, { sinceSec: 0, limit: 1 })).toBe(1);
    const first = await listRideMetrics(db);
    expect(first.map((r) => r.start)).toEqual([day(2)]);
    expect(await syncRideMetrics(db, PROFILE, { sinceSec: 0, limit: 5 })).toBe(1);
    const rows = await listRideMetrics(db);
    expect(rows.map((r) => r.start)).toEqual([day(1), day(2)]);
    expect(rows[0]?.np).toBeCloseTo(200, 0);
    expect(rows[1]?.np).toBeCloseTo(250, 0);
    expect(rows[1]?.curve.find((e) => e.sec === 300)?.watts).toBe(250);
    // Nothing left to do.
    expect(await syncRideMetrics(db, PROFILE, { sinceSec: 0, limit: 5 })).toBe(0);
  });

  it('all-time curve takes the best of every duration and says which ride set it', () => {
    const row = (start: number, curve: [number, number][]): RideMetricsRow => ({ start, rev: 1, np: 200, basisSec: 3600, trimpHr: 0, curve: curve.map(([sec, watts]) => ({ sec, watts, atSec: 0 })) });
    const rows = [row(1, [[5, 900], [60, 400], [1200, 280]]), row(2, [[5, 800], [60, 450], [1200, 300]])];
    expect(allTimeCurve(rows)).toEqual([
      { sec: 5, watts: 900, start: 1 },
      { sec: 60, watts: 450, start: 2 },
      { sec: 1200, watts: 300, start: 2 },
    ]);
    expect(recordsOf(2, rows)).toEqual([60, 1200]);
    expect(recordsOf(1, rows)).toEqual([5]);
  });
});

describe('training load of rides does not double count', () => {
  async function days() {
    const { db } = openDb();
    await ensureCyclingSchema(db);
    // Day 0: a run and a hard power ride (300 W, IF 1.2 at FTP 250, TSS 144) with a heart rate strap.
    await seed(db, { start: day(0), name: 'Outdoor Run', type: 1, secs: 2400, hr: 160, speed: 3 });
    const hard = await seed(db, { start: day(0) + 4 * 3600, name: 'Cycling', type: 3, secs: 3600, hr: 150, power: 300, speed: 9 });
    // Day 1: a ride with a power meter and no heart rate at all.
    await seed(db, { start: day(1), name: 'Cycling', type: 3, secs: 3600, power: 250, speed: 9 });
    // Day 2: a ride with heart rate and no power.
    await seed(db, { start: day(2), name: 'Cycling', type: 3, secs: 3600, hr: 150, speed: 9 });
    // Day 3: only a run.
    await seed(db, { start: day(3), name: 'Outdoor Run', type: 1, secs: 2400, hr: 160, speed: 3 });
    await syncRideMetrics(db, PROFILE, { sinceSec: 0, limit: 10 });
    const bounds = [startOfLocalDay(day(0)), startOfLocalDay(day(1)), startOfLocalDay(day(2)), startOfLocalDay(day(3)), startOfLocalDay(day(4))];
    const base = strainFromLoads(await listDayHeartLoad(db, bounds, PROFILE.zones.bounds));
    const rows = await listRideMetrics(db);
    return { base, rows, db, hard, bounds };
  }

  it('a power ride is scored by TSS instead of its heart rate, a run keeps its heart rate, and the ride is counted once', async () => {
    const { base, rows, db, hard, bounds } = await days();
    const rideTrimp = workoutStrain(await listWorkoutPoints(db, hard), PROFILE.zones)?.trimp ?? 0;
    const tssTrimp = analyzeRide({
      workout: { start: day(0) + 4 * 3600, end: day(0) + 4 * 3600 + 3600, duration: 3600, distance: 32400, calories: 0, sportType: 3, sportName: 'Cycling' },
      summary: {},
      points: await listWorkoutPoints(db, hard),
      profile: PROFILE,
    }).load.tssTrimp as number;
    expect(tssTrimp).toBeCloseTo(144 * 2.4, 0);
    expect(rideTrimp).toBeCloseTo(240, 0);

    const applied = applyRideLoad(base, rideLoadDeltas(rows, PROFILE.ftp));
    const base0 = base.find((d) => d.day === bounds[0])?.trimp ?? 0;
    const d0 = applied.find((d) => d.day === bounds[0])?.trimp ?? 0;
    // The day held the run and the ride's heart rate; the ride's heart rate comes out and its TSS load goes in.
    expect(d0).toBeCloseTo(base0 + tssTrimp - rideTrimp, 0);
    // Counting both would add the whole TSS load on top of the heart rate (and the run is still in).
    expect(d0).toBeLessThan(base0 + tssTrimp - 0.8 * rideTrimp);
    expect(d0).toBeGreaterThan(base0);
    // A day with only a run is exactly as the heart rate had it.
    expect(applied.find((d) => d.day === bounds[3])).toEqual(base.find((d) => d.day === bounds[3]));
  });

  it('a ride with a power meter and no heart rate adds its day; a ride with no power and the run alone change nothing', async () => {
    const { base, rows, bounds } = await days();
    expect(base.find((d) => d.day === bounds[1])).toBeUndefined();
    const applied = applyRideLoad(base, rideLoadDeltas(rows, PROFILE.ftp));
    expect(applied.find((d) => d.day === bounds[1])?.trimp).toBeCloseTo(100 * 2.4, 0);
    expect(applied.find((d) => d.day === bounds[2])).toEqual(base.find((d) => d.day === bounds[2]));
  });

  it('without an FTP nothing changes; strain follows the changed TRIMP', async () => {
    const { base, rows } = await days();
    expect(applyRideLoad(base, rideLoadDeltas(rows, null))).toEqual(base);
    const applied = applyRideLoad(base, rideLoadDeltas(rows, PROFILE.ftp));
    const changed = applied.find((d, i) => base[i] && d.trimp !== base[i]!.trimp);
    expect(changed && changed.strain !== base.find((b) => b.day === changed.day)?.strain).toBe(true);
    expect(applied.every((d) => d.trimp >= 0)).toBe(true);
    expect(applied.map((d) => d.day)).toEqual([...applied.map((d) => d.day)].sort((a, b) => a - b));
  });
});

import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { buildFit } from '@/features/strava/activityFile';
import { decodeFit } from '@/features/strava/testDecode';
import migrationsJson from '../../../modules/huawei-wear/schema/joyofit-db-migrations.json';
import { minuteHeartRates } from '../record/save';
import { ensureSensorSchema } from '../sensors/store';
import { recordedSamplesOf, type StrapResult } from './hr';
import { attachWorkoutRow, detachWorkoutRow, ensureRows, reconcileLinks } from './link';
import {
  applyRemote,
  deleteFolder,
  ensureStrengthSchema,
  getStrengthWorkout,
  getStrengthWorkoutByStart,
  lastPerformance,
  listDirty,
  listFolders,
  listRestPrefs,
  listTimedPrefs,
  listRoutines,
  listStrengthWorkouts,
  listStrengthWorkoutsByPlanKey,
  loadDraft,
  loadSettings,
  markUploaded,
  saveDraft,
  saveFolder,
  saveRoutine,
  saveSettings,
  saveWorkout,
  setRestPref,
  setTimedPref,
  DEFAULT_SETTINGS,
} from './store';
import { emptyDraft } from './draft';
import type { StrengthWorkout } from './types';

/** The slice of expo-sqlite the store uses, over bun:sqlite with the app's real schema. */
async function open() {
  const raw = new Database(':memory:');
  for (const statements of migrationsJson) raw.exec(statements.join(';\n'));
  const db = {
    execAsync: async (sql: string) => void raw.exec(sql),
    runAsync: async (sql: string, ...params: unknown[]) => raw.query(sql).run(...(params as never[])),
    getAllAsync: async (sql: string, ...params: unknown[]) => raw.query(sql).all(...(params as never[])),
    getFirstAsync: async (sql: string, ...params: unknown[]) => raw.query(sql).get(...(params as never[])),
    withTransactionAsync: async (task: () => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as SQLiteDatabase;
  await ensureStrengthSchema(db);
  await ensureSensorSchema(db);
  return { raw, db };
}

const T0 = 1_760_000_000_000;
let n = 0;
const workout = (over: Partial<StrengthWorkout> = {}): StrengthWorkout => ({
  id: `w${n++}`,
  name: 'Push',
  startedAt: T0,
  endedAt: T0 + 3_600_000,
  durationSec: 3600,
  note: '',
  routineId: null,
  planKey: null,
  exercises: [
    {
      key: 'k1',
      exerciseId: 'bench_press',
      note: '',
      restSec: null,
      supersetGroup: null,
      sets: [{ id: 's1', type: 'normal', weightKg: 60, reps: 8, seconds: null, rpe: null, done: true, doneAt: T0 + 1 }],
    },
  ],
  workoutStart: null,
  kcal: null,
  kcalSource: null,
  updatedAt: T0 + 3_600_000,
  deletedAt: null,
  ...over,
});

const watchRow = (raw: Database, start: number, end: number, sportType = 140, calories = 300, imported = 0, complete = 1) =>
  raw.exec(
    `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, imported)
     VALUES (7, ${start}, ${end}, ${sportType}, 'Strength Training', ${end - start}, 0, ${calories}, 120, 160, 0, '{}', ${complete}, ${imported})`,
  );

const rows = (raw: Database) => raw.query('SELECT start, "end" AS "end", sport_type AS sportType, calories, imported, summary_json AS summary FROM workouts ORDER BY start').all() as {
  start: number;
  end: number;
  sportType: number;
  calories: number;
  imported: number;
  summary: string;
}[];

describe('records', () => {
  it('saves, lists newest first, finds by plan key and by workout start, and hides deleted ones', async () => {
    const { db } = await open();
    const a = workout({ startedAt: T0, planKey: 'p1:0:0', workoutStart: 111 });
    const b = workout({ startedAt: T0 + 86_400_000 });
    const c = workout({ startedAt: T0 + 2 * 86_400_000, deletedAt: T0 + 3 * 86_400_000 });
    for (const w of [a, b, c]) await saveWorkout(db, w);
    expect((await listStrengthWorkouts(db)).map((w) => w.id)).toEqual([b.id, a.id]);
    expect((await listStrengthWorkoutsByPlanKey(db, 'p1:0:0')).map((w) => w.id)).toEqual([a.id]);
    expect((await getStrengthWorkoutByStart(db, 111))?.id).toBe(a.id);
    expect((await getStrengthWorkout(db, c.id))?.deletedAt).not.toBeNull();
  });

  it('answers "previous" with the done sets of the newest earlier workout that had the exercise', async () => {
    const { db } = await open();
    const old = workout({ startedAt: T0 });
    const recent = workout({
      startedAt: T0 + 86_400_000,
      exercises: [{ ...workout().exercises[0]!, sets: [
        { id: 'a', type: 'normal', weightKg: 62.5, reps: 8, seconds: null, rpe: null, done: true, doneAt: 1 },
        { id: 'b', type: 'normal', weightKg: 62.5, reps: 7, seconds: null, rpe: null, done: false, doneAt: null },
      ] }],
    });
    await saveWorkout(db, old);
    await saveWorkout(db, recent);
    const last = await lastPerformance(db, 'bench_press', T0 + 5 * 86_400_000);
    expect(last).toMatchObject({ workoutId: recent.id, sets: [{ weightKg: 62.5, reps: 8 }] });
    expect((await lastPerformance(db, 'bench_press', T0 + 86_400_000))?.workoutId).toBe(old.id);
    expect(await lastPerformance(db, 'bench_press', T0)).toBeNull();
    expect(await lastPerformance(db, 'squat')).toBeNull();
    expect((await lastPerformance(db, 'bench_press', undefined, recent.id))?.workoutId).toBe(old.id);
  });

  it('forgets the exercise index of a deleted workout', async () => {
    const { db } = await open();
    const w = workout();
    await saveWorkout(db, w);
    await saveWorkout(db, { ...w, deletedAt: T0 + 1, updatedAt: T0 + 1 });
    expect(await lastPerformance(db, 'bench_press')).toBeNull();
  });

  it('orders routines and folders, and a deleted folder frees its routines', async () => {
    const { db } = await open();
    await saveFolder(db, { id: 'f1', name: 'PPL', sortOrder: 1, updatedAt: 1, deletedAt: null });
    await saveRoutine(db, { id: 'r2', name: 'B', folderId: 'f1', note: '', exercises: [], sortOrder: 2, createdAt: 1, updatedAt: 1, deletedAt: null });
    await saveRoutine(db, { id: 'r1', name: 'A', folderId: 'f1', note: '', exercises: [], sortOrder: 1, createdAt: 1, updatedAt: 1, deletedAt: null });
    expect((await listRoutines(db)).map((r) => r.id)).toEqual(['r1', 'r2']);
    await deleteFolder(db, (await listFolders(db))[0]!, 50);
    expect(await listFolders(db)).toEqual([]);
    expect((await listRoutines(db)).every((r) => r.folderId === null)).toBe(true);
  });

  it('keeps rest preferences and forgets one set back to null', async () => {
    const { db } = await open();
    await setRestPref(db, 'bench_press', 150, 1);
    await setRestPref(db, 'squat', 180, 1);
    expect([...(await listRestPrefs(db))]).toEqual(expect.arrayContaining([['bench_press', 150], ['squat', 180]]));
    await setRestPref(db, 'squat', null, 2);
    expect((await listRestPrefs(db)).has('squat')).toBe(false);
  });

  it('stores the draft and the settings', async () => {
    const { db } = await open();
    expect(await loadDraft(db)).toBeNull();
    const draft = emptyDraft(T0, 'x');
    await saveDraft(db, draft);
    expect(await loadDraft(db)).toEqual(draft);
    await saveDraft(db, null);
    expect(await loadDraft(db)).toBeNull();
    expect(await loadSettings(db)).toEqual(DEFAULT_SETTINGS);
    await saveSettings(db, { ...DEFAULT_SETTINGS, defaultRestSec: 120 });
    expect((await loadSettings(db)).defaultRestSec).toBe(120);
  });
});

describe('sync bookkeeping', () => {
  it('uploads dirty rows once, and a record changed meanwhile stays dirty', async () => {
    const { db } = await open();
    const w = workout();
    await saveWorkout(db, w);
    const dirty = await listDirty(db, 10);
    expect(dirty).toHaveLength(1);
    await saveWorkout(db, { ...w, name: 'changed', updatedAt: w.updatedAt + 5 });
    await markUploaded(db, dirty);
    expect(await listDirty(db, 10)).toHaveLength(1);
    await markUploaded(db, await listDirty(db, 10));
    expect(await listDirty(db, 10)).toHaveLength(0);
  });

  it('takes a newer remote record, ignores an older one, and does not mark remote data for upload', async () => {
    const { db } = await open();
    const w = workout();
    await saveWorkout(db, w);
    await markUploaded(db, await listDirty(db, 10));
    const remote = (doc: StrengthWorkout) => ({ kind: 'workout' as const, id: doc.id, json: JSON.stringify(doc), updatedAt: doc.updatedAt, deletedAt: doc.deletedAt });
    expect((await applyRemote(db, [remote({ ...w, name: 'older', updatedAt: w.updatedAt - 1 })])).applied).toBe(0);
    expect((await getStrengthWorkout(db, w.id))?.name).toBe('Push');
    const fresh = workout();
    const result = await applyRemote(db, [remote({ ...w, name: 'newer', updatedAt: w.updatedAt + 1 }), remote(fresh)]);
    expect(result.applied).toBe(2);
    expect(result.workouts).toHaveLength(2);
    expect((await getStrengthWorkout(db, w.id))?.name).toBe('newer');
    expect(await listDirty(db, 10)).toHaveLength(0);
  });

  it('applies a remote delete', async () => {
    const { db } = await open();
    const w = workout();
    await saveWorkout(db, w);
    await applyRemote(db, [{ kind: 'workout', id: w.id, json: JSON.stringify({ ...w, deletedAt: w.updatedAt + 9, updatedAt: w.updatedAt + 9 }), updatedAt: w.updatedAt + 9, deletedAt: w.updatedAt + 9 }]);
    expect(await listStrengthWorkouts(db)).toEqual([]);
  });

  it('carries a timed workout, routine and measure pref to another phone unchanged', async () => {
    const { db } = await open();
    const w = workout({
      exercises: [
        { key: 'k1', exerciseId: 'plank', timed: true, note: '', restSec: 60, supersetGroup: null, sets: [{ id: 's1', type: 'normal', weightKg: null, reps: null, seconds: 45, rpe: null, done: true, doneAt: T0 + 1 }] },
        { key: 'k2', exerciseId: 'push_up', timed: false, note: '', restSec: null, supersetGroup: null, sets: [{ id: 's2', type: 'normal', weightKg: null, reps: 12, seconds: null, rpe: null, done: true, doneAt: T0 + 2 }] },
      ],
    });
    const routine = {
      id: 'r1',
      name: 'Core',
      folderId: null,
      note: '',
      exercises: [{ exerciseId: 'plank', timed: true, restSec: null, note: '', supersetGroup: null, sets: [{ type: 'normal' as const, weightKg: null, reps: null, seconds: 60 }] }],
      sortOrder: 1,
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
    };
    await saveWorkout(db, w);
    await saveRoutine(db, routine);
    await setTimedPref(db, 'plank', true, T0);

    const { db: other } = await open();
    await applyRemote(other, (await listDirty(db, 10)).map(({ kind, id, json, updatedAt, deletedAt }) => ({ kind, id, json, updatedAt, deletedAt })));

    expect(await getStrengthWorkout(other, w.id)).toEqual(w);
    expect((await listRoutines(other))[0]).toMatchObject({ exercises: [{ timed: true, sets: [{ seconds: 60, reps: null }] }] });
    expect((await listTimedPrefs(other)).get('plank')).toBe(true);
  });
});

describe('the workouts row', () => {
  const start = Math.floor(T0 / 1000);

  it('gives a workout the watch did not record a row of its own (sport 140, imported, estimated energy)', async () => {
    const { raw, db } = await open();
    const w = await attachWorkoutRow(db, workout(), 70);
    expect(w).toMatchObject({ workoutStart: start, kcalSource: 'estimate' });
    expect(w.kcal).toBeGreaterThan(0);
    const [row] = rows(raw);
    expect(row).toMatchObject({ start, end: start + 3600, sportType: 140, imported: 1, calories: w.kcal });
    expect(row!.summary).toContain('"strengthWorkoutId"');
  });

  it('updates its own row when the workout is attached again', async () => {
    const { raw, db } = await open();
    const first = await attachWorkoutRow(db, workout(), 70);
    await attachWorkoutRow(db, { ...first, durationSec: 1800 }, 70);
    expect(rows(raw)).toHaveLength(1);
  });

  it('links to the watch workout of the same window and takes its calories, writing nothing to the watch row', async () => {
    const { raw, db } = await open();
    watchRow(raw, start + 120, start + 3500, 140, 412);
    const w = await attachWorkoutRow(db, workout(), 70);
    expect(w).toMatchObject({ workoutStart: start + 120, kcal: 412, kcalSource: 'watch' });
    expect(rows(raw)).toHaveLength(1);
    expect(rows(raw)[0]).toMatchObject({ imported: 0, calories: 412 });
  });

  it('estimates when the watch row has no calories', async () => {
    const { raw, db } = await open();
    watchRow(raw, start, start + 3600, 140, 0);
    expect(await attachWorkoutRow(db, workout(), 70)).toMatchObject({ workoutStart: start, kcalSource: 'estimate' });
  });

  it('does not merge with a run, a short overlap, an imported row or a watch workout another workout already took', async () => {
    const { raw, db } = await open();
    watchRow(raw, start, start + 3600, 1);
    watchRow(raw, start + 3000, start + 9000, 140);
    watchRow(raw, start - 4000, start + 3000, 140, 300, 1);
    const w = await attachWorkoutRow(db, workout(), 70);
    // `start` is taken by the run, so the row of its own is one second later: no watch workout was merged.
    expect(w.workoutStart).toBe(start + 1);
    expect(w.kcalSource).toBe('estimate');
    expect(rows(raw).filter((r) => r.imported === 1 && r.summary.includes('strengthWorkoutId'))).toHaveLength(1);

    const { raw: raw2, db: db2 } = await open();
    watchRow(raw2, start, start + 3600, 140);
    const first = await attachWorkoutRow(db2, workout(), 70);
    await saveWorkout(db2, first);
    const second = await attachWorkoutRow(db2, workout({ startedAt: T0 + 60_000 }), 70);
    expect(second.workoutStart).not.toBe(start);
  });

  it('moves to a free second when the watch has a row at the same second', async () => {
    const { raw, db } = await open();
    watchRow(raw, start, start + 3600, 1);
    expect((await attachWorkoutRow(db, workout(), 70)).workoutStart).toBe(start + 1);
  });

  it('moves a workout that has its own row to the watch workout that synced later', async () => {
    const { raw, db } = await open();
    const own = await attachWorkoutRow(db, workout(), 70);
    await saveWorkout(db, own);
    expect(await reconcileLinks(db, 70)).toEqual([]);
    watchRow(raw, start + 60, start + 3560, 140, 388);
    const changed = await reconcileLinks(db, 70);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ workoutStart: start + 60, kcal: 388, kcalSource: 'watch' });
    expect(rows(raw).map((r) => r.imported)).toEqual([0]);
    expect((await getStrengthWorkout(db, own.id))?.workoutStart).toBe(start + 60);
    expect(await listDirty(db, 10)).toHaveLength(1);
  });

  it('removes only a row the logger made', async () => {
    const { raw, db } = await open();
    watchRow(raw, start + 5000, start + 6000, 140);
    const w = await attachWorkoutRow(db, workout(), 70);
    await detachWorkoutRow(db, w);
    await detachWorkoutRow(db, { ...w, workoutStart: start + 5000 });
    expect(rows(raw).map((r) => r.start)).toEqual([start + 5000]);
  });

  it('gives a workout pulled from the cloud a row when the phone has none', async () => {
    const { raw, db } = await open();
    const pulled = workout({ workoutStart: start, kcal: 250, kcalSource: 'estimate' });
    const changed = await ensureRows(db, [pulled], 70);
    expect(rows(raw)).toHaveLength(1);
    expect(changed).toHaveLength(1);
    expect(await ensureRows(db, [pulled], 70)).toEqual([]);
  });
});

describe('the heart rate strap in the workouts row', () => {
  const start = Math.floor(T0 / 1000);
  const strapOf = (over: Partial<StrapResult> = {}): StrapResult => ({
    samples: Array.from({ length: 720 }, (_, i) => ({ ts: start + i * 5, hr: 120 + (i % 20) })),
    avgHr: 130,
    maxHr: 139,
    minHr: 120,
    kcal: 480,
    sensors: [{ id: 'AA:BB', name: 'Polar H10', kinds: ['hr'] }],
    ...over,
  });
  const count = (raw: Database, sql: string): number => {
    const found = raw.query(sql).get() as { n: number };
    return found.n;
  };

  it('gives the own row the strap heart rate, points, minute samples, sensor and energy (kcalSource hr)', async () => {
    const { raw, db } = await open();
    const strap = strapOf();
    const w = await attachWorkoutRow(db, workout(), 70, strap);
    expect(w).toMatchObject({ workoutStart: start, kcal: 480, kcalSource: 'hr' });
    const row = raw.query('SELECT id, calories, avg_hr AS avgHr, max_hr AS maxHr, imported, summary_json AS summary FROM workouts').get() as {
      id: number;
      calories: number;
      avgHr: number;
      maxHr: number;
      imported: number;
      summary: string;
    };
    expect(row).toMatchObject({ calories: 480, avgHr: 130, maxHr: 139, imported: 1 });
    expect(JSON.parse(row.summary)).toMatchObject({
      kind: 'strength',
      strengthWorkoutId: w.id,
      minHr: 120,
      kcalSource: 'hr',
      sensors: [{ id: 'AA:BB', name: 'Polar H10', kinds: ['hr'] }],
    });
    const points = raw.query('SELECT ts, hr FROM workout_points WHERE workout_id = ? ORDER BY ts').all(row.id) as { ts: number; hr: number }[];
    expect(points).toHaveLength(720);
    expect(points[0]).toEqual({ ts: start, hr: 120 });
    expect(points[719]).toEqual({ ts: start + 3595, hr: 139 });
    const minutes = minuteHeartRates(recordedSamplesOf(strap.samples));
    expect(count(raw, 'SELECT COUNT(*) AS n FROM step_samples WHERE imported = 1')).toBe(minutes.length);
    expect(raw.query('SELECT timestamp, heart_rate AS hr FROM step_samples ORDER BY timestamp').all()).toEqual(minutes.map(([timestamp, hr]) => ({ timestamp, hr })));
    expect(raw.query('SELECT sensor_id AS id, name FROM workout_sensor WHERE workout_id = ?').all(row.id)).toEqual([{ id: 'AA:BB', name: 'Polar H10' }]);
  });

  it('keeps the MET energy but still stores the points when the strap covered too little of the session', async () => {
    const { raw, db } = await open();
    const w = await attachWorkoutRow(db, workout(), 70, strapOf({ kcal: null }));
    expect(w.kcalSource).toBe('estimate');
    expect(w.kcal).toBe(rows(raw)[0]!.calories);
    expect(JSON.parse(rows(raw)[0]!.summary)).toMatchObject({ kcalSource: 'met', minHr: 120 });
    expect(count(raw, 'SELECT COUNT(*) AS n FROM workout_points')).toBe(720);
  });

  it('does not duplicate the points when the same finish is saved again', async () => {
    const { raw, db } = await open();
    const first = workout();
    await attachWorkoutRow(db, first, 70, strapOf());
    await attachWorkoutRow(db, first, 70, strapOf());
    expect(count(raw, 'SELECT COUNT(*) AS n FROM workout_points')).toBe(720);
    expect(count(raw, 'SELECT COUNT(*) AS n FROM workout_sensor')).toBe(1);
  });

  it('keeps the strap data and its energy when the sets of the finished workout are edited', async () => {
    const { raw, db } = await open();
    const first = await attachWorkoutRow(db, workout(), 70, strapOf());
    await saveWorkout(db, first);
    const edited = await attachWorkoutRow(db, { ...first, name: 'Pull', updatedAt: first.updatedAt + 1 }, 70);
    expect(edited).toMatchObject({ kcal: 480, kcalSource: 'hr', workoutStart: start });
    const row = rows(raw)[0]!;
    expect(row.calories).toBe(480);
    expect(raw.query('SELECT avg_hr AS a, max_hr AS m FROM workouts').get()).toEqual({ a: 130, m: 139 });
    expect(JSON.parse(row.summary)).toMatchObject({ minHr: 120, kcalSource: 'hr', sensors: [{ id: 'AA:BB' }] });
    expect(count(raw, 'SELECT COUNT(*) AS n FROM workout_points')).toBe(720);
  });

  it('lets a watch workout of the same session win and writes nothing of the strap', async () => {
    const { raw, db } = await open();
    watchRow(raw, start + 60, start + 3500, 140, 412);
    const w = await attachWorkoutRow(db, workout(), 70, strapOf());
    expect(w).toMatchObject({ workoutStart: start + 60, kcal: 412, kcalSource: 'watch' });
    expect(rows(raw)).toHaveLength(1);
    expect(raw.query('SELECT avg_hr AS a, max_hr AS m FROM workouts').get()).toEqual({ a: 120, m: 160 });
    expect(count(raw, 'SELECT COUNT(*) AS n FROM workout_points')).toBe(0);
    expect(count(raw, 'SELECT COUNT(*) AS n FROM workout_sensor')).toBe(0);
    expect(count(raw, 'SELECT COUNT(*) AS n FROM step_samples')).toBe(0);
  });

  it('drops the strap data when the watch workout syncs after the session', async () => {
    const { raw, db } = await open();
    const own = await attachWorkoutRow(db, workout(), 70, strapOf());
    await saveWorkout(db, own);
    expect(count(raw, 'SELECT COUNT(*) AS n FROM workout_points')).toBe(720);
    watchRow(raw, start + 60, start + 3560, 140, 388);
    const changed = await reconcileLinks(db, 70);
    expect(changed[0]).toMatchObject({ workoutStart: start + 60, kcal: 388, kcalSource: 'watch' });
    expect(rows(raw).map((r) => r.imported)).toEqual([0]);
    expect(count(raw, 'SELECT COUNT(*) AS n FROM workout_points')).toBe(0);
    expect(count(raw, 'SELECT COUNT(*) AS n FROM workout_sensor')).toBe(0);
    expect(count(raw, 'SELECT COUNT(*) AS n FROM step_samples')).toBe(0);
  });

  it('deleting the workout removes the strap data but leaves minutes another source wrote', async () => {
    const { raw, db } = await open();
    const own = await attachWorkoutRow(db, workout(), 70, strapOf());
    const minute = minuteHeartRates(recordedSamplesOf(strapOf().samples))[2]![0];
    // a minute that has steps (the watch's) is not the strap's: it stays
    raw.exec(`UPDATE step_samples SET steps = 14 WHERE timestamp = ${minute}`);
    await detachWorkoutRow(db, own);
    expect(rows(raw)).toEqual([]);
    expect(count(raw, 'SELECT COUNT(*) AS n FROM workout_points')).toBe(0);
    expect(count(raw, 'SELECT COUNT(*) AS n FROM workout_sensor')).toBe(0);
    expect(raw.query('SELECT timestamp FROM step_samples').all()).toEqual([{ timestamp: minute }]);
  });

  it('gives a workout pulled from the cloud its row with the strap energy it carries, without points', async () => {
    const { raw, db } = await open();
    const pulled = workout({ workoutStart: start, kcal: 480, kcalSource: 'hr' });
    const changed = await ensureRows(db, [pulled], 70);
    expect(changed).toEqual([]);
    expect(rows(raw)[0]!.calories).toBe(480);
    expect(count(raw, 'SELECT COUNT(*) AS n FROM workout_points')).toBe(0);
    const fresh = await attachWorkoutRow(db, workout({ kcal: 480, kcalSource: 'hr' }), 70);
    expect(fresh).toMatchObject({ kcal: 480, kcalSource: 'hr' });
  });

  it('puts the heart rate into the Strava file', async () => {
    const { raw, db } = await open();
    const w = await attachWorkoutRow(db, workout(), 70, strapOf());
    const row = raw.query('SELECT id, start, "end" AS "end", sport_type AS sportType, sport_name AS sportName, duration, distance, calories, avg_hr AS avgHr, max_hr AS maxHr FROM workouts').get() as {
      id: number;
      start: number;
      end: number;
      sportType: number;
      sportName: string;
      duration: number;
      distance: number;
      calories: number;
      avgHr: number | null;
      maxHr: number | null;
    };
    const points = raw.query('SELECT ts, lat, lon, alt, hr FROM workout_points WHERE workout_id = ? ORDER BY ts').all(row.id) as {
      ts: number;
      lat: number | null;
      lon: number | null;
      alt: number | null;
      hr: number | null;
    }[];
    const decoded = decodeFit(buildFit(row, points, { utcOffsetSeconds: 7 * 3600 }).bytes);
    expect(decoded.errors).toEqual([]);
    expect(decoded.integrity).toBe(true);
    const heartRates = (decoded.messages.recordMesgs ?? []).flatMap((r) => (r.heartRate === undefined ? [] : [r.heartRate]));
    expect(heartRates.length).toBeGreaterThanOrEqual(720);
    expect(Math.max(...heartRates)).toBe(139);
    expect(Math.min(...heartRates)).toBe(120);
    expect(decoded.messages.sessionMesgs?.[0]).toMatchObject({ avgHeartRate: 130, maxHeartRate: 139 });
    expect(w.kcalSource).toBe('hr');
  });
});

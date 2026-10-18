import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import exercisesJson from '../coach/exercises/exercises.json';
import {
  EQUIPMENT_MAP,
  MUSCLE_MAP,
  ROGO_TO_FIT,
  ROGO_UNMAPPED,
  importRogoStrength,
  mapCustomExercise,
  mapRoutine,
  mapSession,
  mapUnmappedExercise,
  probeRogoImport,
  roundRpe,
  type RogoExportPage,
  type RogoSession,
  type RogoSet,
} from './importRogo';
import { deleteStrengthWorkout, ensureStrengthSchema, getRecord, getStrengthMeta, listDirty, markUploaded, putRecord } from './store';

const SLUGS = new Set((exercisesJson as { id: string }[]).map((e) => e.id));

function open(): SQLiteDatabase {
  const raw = new Database(':memory:');
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
  return db;
}

describe('mapping table', () => {
  it('has 50 entries, all pointing at library slugs', () => {
    expect(Object.keys(ROGO_TO_FIT)).toHaveLength(50);
    for (const [rogo, slug] of Object.entries(ROGO_TO_FIT)) expect([rogo, SLUGS.has(slug)]).toEqual([rogo, true]);
  });

  it('keeps the 14 unmapped ids out of the table', () => {
    expect(Object.keys(ROGO_UNMAPPED)).toHaveLength(14);
    for (const id of Object.keys(ROGO_UNMAPPED)) expect(id in ROGO_TO_FIT).toBe(false);
  });

  it('covers every muscle and equipment key of JoyoRogo', () => {
    expect(Object.keys(MUSCLE_MAP)).toHaveLength(14);
    expect(Object.keys(EQUIPMENT_MAP)).toHaveLength(5);
  });
});

const set = (over: Partial<RogoSet> & { id: string; exerciseId: string; position: number }): RogoSet => ({
  reps: 10,
  weightKg: null,
  durationSec: null,
  rpe: null,
  setType: 'normal',
  note: null,
  supersetGroup: null,
  ...over,
});

const session = (over: Partial<RogoSession> = {}): RogoSession => ({
  id: 's1',
  date: '2026-10-15',
  name: 'Push',
  startedAt: '2026-10-15T01:00:00.000Z',
  durationMin: 10,
  note: null,
  createdAt: '2026-10-15T04:00:00.000Z',
  kcal: 30,
  sets: [],
  ...over,
});

describe('mapSession', () => {
  it('maps the basics', () => {
    const w = mapSession(session({ sets: [set({ id: 'a', exerciseId: 'push_up', position: 0 })] }));
    expect(w.id).toBe('rogo:s1');
    expect(w.startedAt).toBe(Date.parse('2026-10-15T01:00:00.000Z'));
    expect(w.durationSec).toBe(600);
    expect(w.endedAt).toBe(w.startedAt + 600_000);
    expect(w.note).toBe('');
    expect(w.workoutStart).toBeNull();
    expect(w.routineId).toBeNull();
    expect(w.planKey).toBeNull();
    expect(w.kcal).toBe(30);
    expect(w.kcalSource).toBe('estimate');
    expect(w.updatedAt).toBe(Date.parse('2026-10-15T04:00:00.000Z'));
    expect(w.deletedAt).toBeNull();
    expect(w.exercises[0]!.sets[0]).toMatchObject({ id: 'a', done: true, doneAt: null, type: 'normal' });
  });

  it('uses noon WIB when started_at is null', () => {
    const w = mapSession(session({ startedAt: null, durationMin: null }));
    expect(w.startedAt).toBe(Date.parse('2026-10-15T05:00:00.000Z'));
    expect(w.durationSec).toBe(0);
    expect(w.endedAt).toBe(w.startedAt);
  });

  it('uses noon WIB for a backdated session', () => {
    const w = mapSession(session({ date: '2026-10-10' }));
    expect(w.startedAt).toBe(Date.parse('2026-10-10T05:00:00.000Z'));
  });

  it('keeps a late-night WIB session on its WIB day', () => {
    const w = mapSession(session({ date: '2026-10-15', startedAt: '2026-10-15T16:30:00.000Z' }));
    expect(w.startedAt).toBe(Date.parse('2026-10-15T16:30:00.000Z'));
  });

  it('has no kcal source without kcal', () => {
    const w = mapSession(session({ kcal: null }));
    expect([w.kcal, w.kcalSource]).toEqual([null, null]);
  });

  it('keeps timed sets as seconds with null reps', () => {
    const w = mapSession(session({ sets: [set({ id: 'a', exerciseId: 'wall_sit', position: 0, reps: null, durationSec: 45 })] }));
    expect(w.exercises[0]!.exerciseId).toBe('wall_sit');
    expect(w.exercises[0]!.sets[0]).toMatchObject({ reps: null, seconds: 45 });
  });

  it('groups consecutive rows, splits a repeated exercise, keeps supersets', () => {
    const w = mapSession(
      session({
        sets: [
          set({ id: '5', exerciseId: 'squat', position: 3 }),
          set({ id: '1', exerciseId: 'push_up', position: 0, supersetGroup: 1, note: 'slow' }),
          set({ id: '2', exerciseId: 'push_up', position: 1, supersetGroup: 1, note: 'slow' }),
          set({ id: '3', exerciseId: 'plank', position: 2, supersetGroup: 1, reps: null, durationSec: 30 }),
          set({ id: '4', exerciseId: 'push_up', position: 4 }),
        ],
      }),
    );
    expect(w.exercises.map((e) => [e.key, e.exerciseId, e.supersetGroup, e.sets.map((s) => s.id)])).toEqual([
      ['e0', 'push_up', 1, ['1', '2']],
      ['e1', 'plank', 1, ['3']],
      ['e2', 'barbell_back_squat', null, ['5']],
      ['e3', 'push_up', null, ['4']],
    ]);
    expect(w.exercises[0]!.note).toBe('slow');
    expect(w.exercises[3]!.note).toBe('');
  });

  it('maps set types and rounds rpe to 0.5', () => {
    const w = mapSession(
      session({
        sets: [
          set({ id: 'a', exerciseId: 'push_up', position: 0, setType: 'warmup', rpe: 7.3 }),
          set({ id: 'b', exerciseId: 'push_up', position: 1, setType: 'failure', rpe: 9.8 }),
          set({ id: 'c', exerciseId: 'push_up', position: 2, setType: 'weird' }),
        ],
      }),
    );
    expect(w.exercises[0]!.sets.map((s) => [s.type, s.rpe])).toEqual([['warmup', 7.5], ['failure', 10], ['normal', null]]);
    expect(roundRpe(7.74)).toBe(7.5);
    expect(roundRpe(null)).toBeNull();
  });

  it('points an unmapped and an unknown id at custom exercises', () => {
    const w = mapSession(
      session({ sets: [set({ id: 'a', exerciseId: 'dips', position: 0 }), set({ id: 'b', exerciseId: 'abc-uuid', position: 1 })] }),
    );
    expect(w.exercises.map((e) => e.exerciseId)).toEqual(['custom_rogo_dips', 'custom_rogo_abc-uuid']);
  });
});

describe('mapRoutine / custom exercises', () => {
  it('maps a routine', () => {
    const r = mapRoutine(
      {
        id: 'r1',
        name: 'Day A',
        note: null,
        createdAt: '2026-10-14T00:00:00.000Z',
        updatedAt: '2026-10-15T00:00:00.000Z',
        exercises: [
          { exerciseId: 'bench_press', restSec: 120, note: null, sets: [{ setType: 'warmup', reps: 12, weightKg: 20, durationSec: null }, { setType: 'normal', reps: 8, weightKg: 60 }] },
          { exerciseId: 'face_pull' },
        ],
      },
      2,
    );
    expect(r).toMatchObject({ id: 'rogo:r1', name: 'Day A', note: '', folderId: null, sortOrder: 2, deletedAt: null });
    expect(r.createdAt).toBe(Date.parse('2026-10-14T00:00:00.000Z'));
    expect(r.updatedAt).toBe(Date.parse('2026-10-15T00:00:00.000Z'));
    expect(r.exercises[0]).toEqual({
      exerciseId: 'barbell_bench_press',
      restSec: 120,
      note: '',
      supersetGroup: null,
      sets: [
        { type: 'warmup', weightKg: 20, reps: 12, seconds: null },
        { type: 'normal', weightKg: 60, reps: 8, seconds: null },
      ],
    });
    expect(r.exercises[1]).toMatchObject({ exerciseId: 'custom_rogo_face_pull', restSec: null, sets: [] });
  });

  it('maps a custom exercise', () => {
    expect(mapCustomExercise({ id: 'u1', name: 'Hold', muscle: 'perut', equipment: 'mesin', type: 'duration', createdAt: '2026-10-14T00:00:00.000Z' })).toEqual({
      id: 'custom_rogo_u1',
      name: 'Hold',
      primary: ['abs'],
      equipment: 'machine',
      timed: true,
      updatedAt: Date.parse('2026-10-14T00:00:00.000Z'),
      deletedAt: null,
    });
    expect(mapCustomExercise({ id: 'u2', name: 'X', muscle: '?', equipment: '?', type: 'weight_reps', createdAt: 0 })).toMatchObject({
      primary: [],
      equipment: 'other',
      timed: false,
    });
  });

  it('maps an unmapped catalog id and an unknown id', () => {
    expect(mapUnmappedExercise('dead_hang', 5)).toMatchObject({ id: 'custom_rogo_dead_hang', name: 'Dead hang', primary: ['forearms'], timed: true, updatedAt: 5 });
    expect(mapUnmappedExercise('zzz', 5)).toMatchObject({ name: 'zzz', primary: [], equipment: 'other', timed: false });
  });
});

describe('importRogoStrength', () => {
  const page1: RogoExportPage = {
    sessions: [
      session({ id: 's1', sets: [set({ id: 'a', exerciseId: 'push_up', position: 0 }), set({ id: 'b', exerciseId: 'dips', position: 1 })] }),
    ],
    nextCursor: 'c2',
    total: { sessions: 2, sets: 3 },
    routines: [
      { id: 'r1', name: 'Old', note: null, createdAt: 1000, updatedAt: 1000, exercises: [{ exerciseId: 'face_pull' }] },
      { id: 'r2', name: 'New', note: null, createdAt: 2000, updatedAt: 3000, exercises: [{ exerciseId: 'bench_press' }] },
    ],
    customExercises: [{ id: 'u1', name: 'Mine', muscle: 'dada', equipment: 'kabel', type: 'weight_reps', createdAt: 500 }],
  };
  const page2: RogoExportPage = {
    sessions: [session({ id: 's2', createdAt: '2026-10-16T04:00:00.000Z', sets: [set({ id: 'c', exerciseId: 'u1', position: 0 })] })],
    nextCursor: null,
  };
  const fetchPage = async (cursor: string | undefined) => (cursor === undefined ? page1 : page2);

  it('imports every page, then a second run changes nothing', async () => {
    const db = open();
    await ensureStrengthSchema(db);
    const progress: [number, number][] = [];
    const first = await importRogoStrength(db, { fetchPage, onProgress: (d, t) => progress.push([d, t]), now: () => 42 });
    expect(first).toMatchObject({ workouts: 2, routines: 2, exercises: 3, skipped: 0, unavailable: false, aborted: false });
    expect(first.written).toBe(7);
    expect(progress.at(-1)).toEqual([4, 4]);
    expect(JSON.parse((await getStrengthMeta(db, 'rogoImport'))!)).toEqual({ doneAt: 42, workouts: 2, routines: 2 });

    expect((await getRecord(db, 'routine', 'rogo:r2'))!.sortOrder).toBe(0);
    expect((await getRecord(db, 'routine', 'rogo:r1'))!.sortOrder).toBe(1);
    expect(await getRecord(db, 'exercise', 'custom_rogo_dips')).not.toBeNull();
    expect(await getRecord(db, 'exercise', 'custom_rogo_u1')).not.toBeNull();
    expect(await getRecord(db, 'exercise', 'custom_rogo_front_squat')).toBeNull();

    const dirty = await listDirty(db, 100);
    expect(dirty).toHaveLength(7);
    await markUploaded(db, dirty);

    const second = await importRogoStrength(db, { fetchPage });
    expect(second).toMatchObject({ workouts: 2, routines: 2, written: 0, skipped: 0 });
    expect(await listDirty(db, 100)).toHaveLength(0);
  });

  it('does not overwrite a newer record nor resurrect a deleted one', async () => {
    const db = open();
    await ensureStrengthSchema(db);
    await importRogoStrength(db, { fetchPage });
    const edited = (await getRecord(db, 'workout', 'rogo:s2'))!;
    await putRecord(db, 'workout', { ...edited, name: 'Mine now', updatedAt: edited.updatedAt + 10 });
    const gone = (await getRecord(db, 'workout', 'rogo:s1'))!;
    await deleteStrengthWorkout(db, gone, gone.updatedAt + 20);

    const again = await importRogoStrength(db, { fetchPage });
    expect(again.skipped).toBe(2);
    expect(again.written).toBe(0);
    expect((await getRecord(db, 'workout', 'rogo:s2'))!.name).toBe('Mine now');
    expect((await getRecord(db, 'workout', 'rogo:s1'))!.deletedAt).not.toBeNull();
  });

  it('stores nothing when the procedure is not deployed', async () => {
    const db = open();
    await ensureStrengthSchema(db);
    const result = await importRogoStrength(db, { fetchPage: async () => null });
    expect(result.unavailable).toBe(true);
    expect(await getStrengthMeta(db, 'rogoImport')).toBeNull();
    expect(await probeRogoImport(async () => null)).toBeNull();
  });

  it('probes the first page for the totals', async () => {
    expect(await probeRogoImport(fetchPage)).toEqual({ sessions: 2, routines: 2 });
  });

  it('stops when aborted and stores no meta', async () => {
    const db = open();
    await ensureStrengthSchema(db);
    const controller = new AbortController();
    const result = await importRogoStrength(db, {
      fetchPage,
      signal: controller.signal,
      onProgress: (done) => {
        if (done === 3) controller.abort();
      },
    });
    expect(result.aborted).toBe(true);
    expect(await getStrengthMeta(db, 'rogoImport')).toBeNull();
    const resumed = await importRogoStrength(db, { fetchPage });
    expect(resumed.aborted).toBe(false);
    expect(resumed.workouts).toBe(2);
  });
});

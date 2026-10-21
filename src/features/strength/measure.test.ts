import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { bestsByExercise, findPersonalRecords, workoutTotals } from './calc';
import {
  addExercises,
  draftFromPlan,
  draftFromRoutine,
  draftFromWorkout,
  emptyDraft,
  finishDraft,
  hasMeasureValues,
  replaceExercise,
  resolveTimed,
  routineExercisesOf,
  setExerciseTimed,
  toggleSetDone,
  updateSet,
  type RestContext,
} from './draft';
import { digitsClock, digitsFromSeconds, previousForMeasure, secondsFromDigits } from './logFormat';
import {
  addExercises as addRoutineExercises,
  DEFAULT_REPS,
  DEFAULT_SECONDS,
  editFromRoutine,
  emptyEdit,
  hasCustomAmounts,
  routineFromEdit,
  setExerciseTimed as setRoutineExerciseTimed,
  storedExercises,
} from './routineEdit';
import { COUNTDOWN_VIBRATION, startSetTimer, timerElapsedSec, timerFinished, timerResultSec, timerShownSec } from './setTimer';
import { ensureStrengthSchema, getExercisePref, listRestPrefs, listTimedPrefs, setRestPref, setTimedPref } from './store';
import type { StrengthSet, StrengthWorkout } from './types';

const T0 = 1_000_000;
const ctx: RestContext = { defaultRestSec: 90, autoRest: false, prefs: new Map() };

const plank = () => addExercises(emptyDraft(T0), [{ exerciseId: 'plank', timed: true }]);
const squat = () => addExercises(emptyDraft(T0), [{ exerciseId: 'squat', timed: false }]);

describe('measure of an exercise in the logger', () => {
  it('remembers the way an exercise was added', () => {
    expect(plank().exercises[0]?.timed).toBe(true);
    expect(squat().exercises[0]?.timed).toBe(false);
  });

  it('switches reps to time: weight and type stay, amounts and ticks go', () => {
    let d = squat();
    const key = d.exercises[0]!.key;
    const id = d.exercises[0]!.sets[0]!.id;
    d = updateSet(d, key, id, { weightKg: 20, reps: 12, type: 'drop' });
    d = toggleSetDone(d, key, id, T0 + 1, ctx).draft;
    expect(d.exercises[0]!.sets[0]!.done).toBe(true);

    d = setExerciseTimed(d, key, true, false);
    const converted = d.exercises[0]!;
    expect(converted.timed).toBe(true);
    expect(converted.sets[0]).toMatchObject({ weightKg: 20, type: 'drop', reps: null, seconds: null, done: false, doneAt: null });
  });

  it('switches time to reps the same way', () => {
    let d = plank();
    const key = d.exercises[0]!.key;
    const id = d.exercises[0]!.sets[0]!.id;
    d = updateSet(d, key, id, { seconds: 45 });
    d = setExerciseTimed(d, key, false, true);
    expect(d.exercises[0]).toMatchObject({ timed: false });
    expect(d.exercises[0]!.sets[0]).toMatchObject({ seconds: null, reps: null });
  });

  it('does nothing when the exercise is measured that way already, and drops the rest timer of its sets', () => {
    let d = squat();
    const key = d.exercises[0]!.key;
    expect(setExerciseTimed(d, key, false, false)).toBe(d);
    const id = d.exercises[0]!.sets[0]!.id;
    d = updateSet(d, key, id, { reps: 8 });
    d = toggleSetDone(d, key, id, T0 + 1, { ...ctx, autoRest: true }).draft;
    expect(d.rest).not.toBeNull();
    expect(setExerciseTimed(d, key, true, false).rest).toBeNull();
  });

  it('asks for confirmation only when a set holds something', () => {
    const d = squat();
    const entry = d.exercises[0]!;
    expect(hasMeasureValues(entry)).toBe(false);
    const filled = updateSet(d, entry.key, entry.sets[0]!.id, { reps: 5 });
    expect(hasMeasureValues(filled.exercises[0]!)).toBe(true);
  });

  it('an entry choice beats the library flag; without either the sets decide', () => {
    expect(resolveTimed({ timed: false, sets: [] }, true)).toBe(false);
    expect(resolveTimed({ sets: [] }, true)).toBe(true);
    expect(resolveTimed({ sets: [{ reps: null, seconds: 30 }] }, null)).toBe(true);
    expect(resolveTimed({ sets: [{ reps: 8, seconds: null }] }, null)).toBe(false);
  });

  it('a replacement follows the new exercise, a plan and a routine carry their measure into the draft', () => {
    const replaced = replaceExercise(squat(), squat().exercises[0]!.key, { exerciseId: 'wall_sit', timed: true });
    expect(replaced.exercises[0]).toBeDefined();

    const planned = draftFromPlan('p:1:0', [{ exerciseId: 'plank', sets: 2, reps: 0, seconds: 40, restSec: 30 }], T0);
    expect(planned.exercises[0]).toMatchObject({ timed: true });
    expect(planned.exercises[0]!.sets[0]).toMatchObject({ seconds: 40, reps: null });

    const routine = {
      id: 'r1',
      name: 'Core',
      exercises: [
        { exerciseId: 'squat', timed: true, restSec: null, note: '', supersetGroup: null, sets: [{ type: 'normal' as const, weightKg: null, reps: null, seconds: 30 }] },
        { exerciseId: 'plank', restSec: null, note: '', supersetGroup: null, sets: [{ type: 'normal' as const, weightKg: null, reps: null, seconds: 30 }] },
      ],
    };
    const fromRoutine = draftFromRoutine(routine, T0);
    expect(fromRoutine.exercises[0]!.timed).toBe(true);
    expect('timed' in fromRoutine.exercises[1]!).toBe(false);
  });

  it('keeps the measure through finishing, repeating and saving as a routine', () => {
    let d = squat();
    const key = d.exercises[0]!.key;
    d = setExerciseTimed(d, key, true, false);
    d = updateSet(d, key, d.exercises[0]!.sets[0]!.id, { seconds: 50, weightKg: 10 });
    d = toggleSetDone(d, key, d.exercises[0]!.sets[0]!.id, T0 + 5, ctx).draft;
    const workout = finishDraft(d, T0 + 60_000, 'Core') as StrengthWorkout;
    expect(workout.exercises[0]!.timed).toBe(true);
    expect(workoutTotals(workout)).toMatchObject({ seconds: 50, reps: 0, sets: 1 });

    expect(draftFromWorkout(workout, T0, true).exercises[0]!.timed).toBe(true);
    const asRoutine = routineExercisesOf(workout);
    expect(asRoutine[0]).toMatchObject({ timed: true });
    expect(asRoutine[0]!.sets[0]).toMatchObject({ seconds: 50, reps: null, weightKg: 10 });
  });
});

describe('measure of an exercise in the routine editor', () => {
  const edit = addRoutineExercises(emptyEdit(), [
    { exerciseId: 'squat', timed: false },
    { exerciseId: 'plank', timed: true },
  ]);

  it('new exercises store their measure and start with its default amount', () => {
    expect(edit.exercises.map((e) => e.timed)).toEqual([false, true]);
    expect(edit.exercises[0]!.sets[0]).toMatchObject({ reps: DEFAULT_REPS, seconds: null });
    expect(edit.exercises[1]!.sets[0]).toMatchObject({ reps: null, seconds: DEFAULT_SECONDS });
  });

  it('switching converts every set to the default of the new measure and keeps weight and type', () => {
    const key = edit.exercises[0]!.key;
    const withWeight = { ...edit, exercises: edit.exercises.map((e) => (e.key === key ? { ...e, sets: e.sets.map((s) => ({ ...s, weightKg: 15, type: 'warmup' as const })) } : e)) };
    const next = setRoutineExerciseTimed(withWeight, key, true, false);
    expect(next.exercises[0]!.timed).toBe(true);
    expect(next.exercises[0]!.sets.every((s) => s.reps === null && s.seconds === DEFAULT_SECONDS && s.weightKg === 15 && s.type === 'warmup')).toBe(true);
    expect(setRoutineExerciseTimed(withWeight, key, false, false)).toBe(withWeight);
  });

  it('only amounts the person changed need a confirmation', () => {
    expect(hasCustomAmounts(edit.exercises[0]!)).toBe(false);
    const changed = { sets: [{ type: 'normal' as const, weightKg: null, reps: 8, seconds: null }] };
    expect(hasCustomAmounts(changed)).toBe(true);
  });

  it('the measure is stored with the routine and comes back into the logger', () => {
    const routine = routineFromEdit(null, { ...edit, name: 'Core' }, 0, T0);
    expect(routine.exercises.map((e) => e.timed)).toEqual([false, true]);
    expect(storedExercises(editFromRoutine(routine).exercises)[1]).toMatchObject({ timed: true });
    expect(draftFromRoutine(routine, T0).exercises.map((e) => e.timed)).toEqual([false, true]);
  });
});

describe('saved measure per exercise', () => {
  async function open() {
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
    await ensureStrengthSchema(db);
    return db;
  }

  it('remembers the last choice and forgets it on null', async () => {
    const db = await open();
    await setTimedPref(db, 'plank', false, 1);
    await setTimedPref(db, 'squat', true, 2);
    expect([...(await listTimedPrefs(db))].sort()).toEqual([['plank', false], ['squat', true]]);
    await setTimedPref(db, 'plank', true, 3);
    expect((await listTimedPrefs(db)).get('plank')).toBe(true);
    await setTimedPref(db, 'squat', null, 4);
    expect((await listTimedPrefs(db)).has('squat')).toBe(false);
  });

  it('shares the record with the saved rest timer: neither erases the other', async () => {
    const db = await open();
    await setRestPref(db, 'plank', 45, 1);
    await setTimedPref(db, 'plank', false, 2);
    expect((await listRestPrefs(db)).get('plank')).toBe(45);
    await setRestPref(db, 'plank', null, 3);
    expect((await listTimedPrefs(db)).get('plank')).toBe(false);
    expect((await listRestPrefs(db)).has('plank')).toBe(false);
    await setTimedPref(db, 'plank', null, 4);
    expect((await getExercisePref(db, 'plank'))?.deletedAt).not.toBeNull();
    // Choosing again after it was forgotten revives the record, newer than the tombstone.
    await setTimedPref(db, 'plank', true, 5);
    const revived = await getExercisePref(db, 'plank');
    expect(revived).toMatchObject({ timed: true, deletedAt: null });
    expect(revived!.updatedAt).toBeGreaterThan(4);
  });

  it('an old pref without the field reads as no choice', async () => {
    const db = await open();
    await setRestPref(db, 'squat', 120, 1);
    expect((await listTimedPrefs(db)).has('squat')).toBe(false);
    expect((await listRestPrefs(db)).get('squat')).toBe(120);
  });
});

describe('records of timed sets', () => {
  const doneSet = (id: string, seconds: number | null, reps: number | null = null, weightKg: number | null = null): StrengthSet => ({
    id,
    type: 'normal' as const,
    weightKg,
    reps,
    seconds,
    rpe: null,
    done: true,
    doneAt: 1,
  });
  const workoutOf = (startedAt: number, sets: StrengthSet[], timed?: boolean): StrengthWorkout => ({
    id: `w${startedAt}`,
    name: 'x',
    startedAt,
    endedAt: startedAt + 1000,
    durationSec: 60,
    note: '',
    routineId: null,
    planKey: null,
    exercises: [{ key: `k${startedAt}`, exerciseId: 'plank', note: '', restSec: null, supersetGroup: null, sets, ...(timed === undefined ? {} : { timed }) }],
    workoutStart: null,
    kcal: null,
    kcalSource: null,
    updatedAt: startedAt,
    deletedAt: null,
  });

  it('a longer hold than ever before is a time record', () => {
    const before = bestsByExercise([workoutOf(1, [doneSet('a', 40), doneSet('b', 55)], true)]);
    const records = findPersonalRecords(workoutOf(2, [doneSet('c', 60), doneSet('d', 58)], true), before);
    expect(records).toEqual([{ exerciseId: 'plank', kind: 'time', setId: 'c', value: 60, previous: 55 }]);
  });

  it('a shorter or equal hold is no record', () => {
    const before = bestsByExercise([workoutOf(1, [doneSet('a', 60)], true)]);
    expect(findPersonalRecords(workoutOf(2, [doneSet('b', 60), doneSet('c', 30)], true), before)).toEqual([]);
  });

  it('the first hold of an exercise that was counted in reps is no record of time', () => {
    const before = bestsByExercise([workoutOf(1, [doneSet('a', null, 12)], false)]);
    const records = findPersonalRecords(workoutOf(2, [doneSet('b', 45)], true), before);
    expect(records.some((r) => r.kind === 'time')).toBe(false);
  });

  it('totals count seconds of working sets only', () => {
    const w = workoutOf(1, [doneSet('a', 30), { ...doneSet('b', 20), type: 'warmup' as const }, { ...doneSet('c', 45), done: false }], true);
    expect(workoutTotals(w)).toMatchObject({ seconds: 30, reps: 0, sets: 1, warmupSets: 1 });
  });
});

describe('time entry', () => {
  it('digits fill from the right like a kitchen timer', () => {
    expect(digitsClock('1')).toBe('0:01');
    expect(digitsClock('13')).toBe('0:13');
    expect(digitsClock('130')).toBe('1:30');
    expect(digitsClock('')).toBe('');
    expect(secondsFromDigits('1')).toBe(1);
    expect(secondsFromDigits('45')).toBe(45);
    expect(secondsFromDigits('130')).toBe(90);
    expect(secondsFromDigits('1500')).toBe(900);
    expect(secondsFromDigits('90')).toBe(90);
    expect(secondsFromDigits('')).toBeNull();
    expect(secondsFromDigits('99999')).toBe(4 * 3600);
  });

  it('digits and seconds read back into each other', () => {
    for (const sec of [0, 5, 45, 60, 90, 600, 3725, 14400]) expect(secondsFromDigits(digitsFromSeconds(sec))).toBe(sec);
    expect(digitsFromSeconds(90)).toBe('130');
    expect(digitsFromSeconds(null)).toBe('');
  });

  it('a previous set is read in the measure being logged', () => {
    const prev = { weightKg: 20, reps: 8, seconds: 30 };
    expect(previousForMeasure(prev, true)).toEqual({ weightKg: 20, reps: null, seconds: 30 });
    expect(previousForMeasure(prev, false)).toEqual({ weightKg: 20, reps: 8, seconds: null });
  });
});

describe('stopwatch of a set', () => {
  it('counts up without a plan, or with the countdown option off', () => {
    const up = startSetTimer('k', 's', null, true, 1000);
    expect(up.targetSec).toBeNull();
    expect(startSetTimer('k', 's', 45, false, 1000).targetSec).toBeNull();
    expect(timerShownSec(up, 1000 + 12_400)).toBe(12);
    expect(timerFinished(up, 1000 + 999_999)).toBe(false);
    expect(timerResultSec(up, 1000 + 12_400)).toBe(12);
  });

  it('counts down from the planned seconds, ends at zero and stores at most the plan', () => {
    const down = startSetTimer('k', 's', 30, true, 1000);
    expect(down.targetSec).toBe(30);
    expect(timerShownSec(down, 1000)).toBe(30);
    expect(timerShownSec(down, 1000 + 29_100)).toBe(1);
    expect(timerFinished(down, 1000 + 29_999)).toBe(false);
    expect(timerFinished(down, 1000 + 30_000)).toBe(true);
    expect(timerShownSec(down, 1000 + 40_000)).toBe(0);
    expect(timerResultSec(down, 1000 + 40_000)).toBe(30);
    // Stopped early: what was held.
    expect(timerResultSec(down, 1000 + 18_000)).toBe(18);
  });

  it('a stop right after the start still stores one second, and the clock never goes backwards', () => {
    const up = startSetTimer('k', 's', null, true, 5000);
    expect(timerResultSec(up, 5000)).toBe(1);
    expect(timerElapsedSec(up, 4000)).toBe(0);
  });

  it('vibrates twice', () => {
    expect(COUNTDOWN_VIBRATION.filter((v, i) => i % 2 === 1 && v > 0)).toHaveLength(2);
  });
});

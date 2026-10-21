import { describe, expect, it } from 'bun:test';

import {
  addExercises,
  addSet,
  adjustRest,
  applyEdit,
  draftFromPlan,
  draftFromRoutine,
  draftFromWorkout,
  elapsedMs,
  emptyDraft,
  finishDraft,
  leaveSuperset,
  makeSuperset,
  moveExercise,
  pauseDraft,
  removeExercise,
  replaceExercise,
  restLeftSec,
  resumeDraft,
  setLabels,
  toggleSetDone,
  updateSet,
  type RestContext,
} from './draft';

const ctx: RestContext = { defaultRestSec: 90, autoRest: true, prefs: new Map([['squat', 120]]) };
const T0 = 1_000_000;

const withExercises = (...ids: string[]) => addExercises(emptyDraft(T0), ids.map((exerciseId) => ({ exerciseId, timed: false })));

describe('stopwatch', () => {
  it('runs from the start and stops while paused', () => {
    let d = emptyDraft(T0);
    expect(elapsedMs(d, T0 + 60_000)).toBe(60_000);
    d = pauseDraft(d, T0 + 60_000);
    expect(elapsedMs(d, T0 + 600_000)).toBe(60_000);
    d = resumeDraft(d, T0 + 120_000);
    expect(elapsedMs(d, T0 + 150_000)).toBe(90_000);
  });

  it('pushes a running rest timer by the pause', () => {
    let d = withExercises('squat');
    const e = d.exercises[0]!;
    d = updateSet(d, e.key, e.sets[0]!.id, { reps: 5 });
    d = toggleSetDone(d, e.key, e.sets[0]!.id, T0, ctx).draft;
    const ends = d.rest!.endsAt;
    d = resumeDraft(pauseDraft(d, T0 + 10_000), T0 + 40_000);
    expect(d.rest!.endsAt).toBe(ends + 30_000);
  });
});

describe('exercises and sets', () => {
  it('adds exercises with one set and keeps them in order; moves and removes', () => {
    let d = withExercises('a', 'b', 'c');
    expect(d.exercises.map((e) => e.exerciseId)).toEqual(['a', 'b', 'c']);
    expect(d.exercises.every((e) => e.sets.length === 1)).toBe(true);
    d = moveExercise(d, d.exercises[2]!.key, 0);
    expect(d.exercises.map((e) => e.exerciseId)).toEqual(['c', 'a', 'b']);
    d = removeExercise(d, d.exercises[0]!.key);
    expect(d.exercises.map((e) => e.exerciseId)).toEqual(['a', 'b']);
  });

  it('copies the last working set into a new set, but not into a warm-up', () => {
    let d = withExercises('bench');
    const key = d.exercises[0]!.key;
    d = updateSet(d, key, d.exercises[0]!.sets[0]!.id, { weightKg: 60, reps: 8 });
    d = addSet(d, key);
    d = addSet(d, key, 'warmup');
    const sets = d.exercises[0]!.sets;
    expect(sets[1]).toMatchObject({ weightKg: 60, reps: 8, done: false });
    expect(sets[2]).toMatchObject({ weightKg: null, reps: null, type: 'warmup' });
  });

  it('numbers working sets and marks warm-ups and drops', () => {
    expect(setLabels([{ type: 'warmup' }, { type: 'normal' }, { type: 'failure' }, { type: 'drop' }, { type: 'normal' }])).toEqual(['W', '1', '2', 'D', '3']);
  });

  it('replacing an exercise keeps weights and reps, clears the checks', () => {
    let d = withExercises('a');
    const e = d.exercises[0]!;
    d = updateSet(d, e.key, e.sets[0]!.id, { weightKg: 50, reps: 10 });
    d = toggleSetDone(d, e.key, e.sets[0]!.id, T0, ctx).draft;
    d = replaceExercise(d, e.key, { exerciseId: 'b', timed: false });
    expect(d.exercises[0]).toMatchObject({ exerciseId: 'b' });
    expect(d.exercises[0]!.sets[0]).toMatchObject({ weightKg: 50, reps: 10, done: false });
  });
});

describe('completing a set', () => {
  it('refuses a set with neither reps nor seconds, and fills from the previous values', () => {
    const d = withExercises('bench');
    const e = d.exercises[0]!;
    expect(toggleSetDone(d, e.key, e.sets[0]!.id, T0, ctx).refused).toBe(true);
    const filled = toggleSetDone(d, e.key, e.sets[0]!.id, T0, ctx, { weightKg: 60, reps: 8, seconds: null });
    expect(filled.refused).toBe(false);
    expect(filled.draft.exercises[0]!.sets[0]).toMatchObject({ weightKg: 60, reps: 8, done: true, doneAt: T0 });
  });

  it('starts the rest timer: the exercise own, else the saved, else the default', () => {
    let d = withExercises('squat', 'bench');
    const [squat, bench] = d.exercises as [(typeof d.exercises)[0], (typeof d.exercises)[0]];
    d = updateSet(d, squat.key, squat.sets[0]!.id, { reps: 5 });
    d = updateSet(d, bench.key, bench.sets[0]!.id, { reps: 5 });
    let r = toggleSetDone(d, squat.key, squat.sets[0]!.id, T0, ctx);
    expect(r.restStarted).toBe(true);
    expect(r.draft.rest).toMatchObject({ totalSec: 120, endsAt: T0 + 120_000 });
    r = toggleSetDone(r.draft, bench.key, bench.sets[0]!.id, T0, ctx);
    expect(r.draft.rest!.totalSec).toBe(90);
    const own = toggleSetDone({ ...d, exercises: d.exercises.map((e) => (e.key === bench.key ? { ...e, restSec: 45 } : e)) }, bench.key, bench.sets[0]!.id, T0, ctx);
    expect(own.draft.rest!.totalSec).toBe(45);
  });

  it('starts nothing with auto rest off, and undoing the check stops its timer', () => {
    let d = withExercises('bench');
    const e = d.exercises[0]!;
    d = updateSet(d, e.key, e.sets[0]!.id, { reps: 5 });
    expect(toggleSetDone(d, e.key, e.sets[0]!.id, T0, { ...ctx, autoRest: false }).draft.rest).toBeNull();
    const on = toggleSetDone(d, e.key, e.sets[0]!.id, T0, ctx).draft;
    expect(on.rest).not.toBeNull();
    expect(toggleSetDone(on, e.key, e.sets[0]!.id, T0 + 1000, ctx).draft.rest).toBeNull();
  });

  it('does not rest in the middle of a superset round, only after the last exercise of it', () => {
    let d = withExercises('curl', 'pushdown');
    d = makeSuperset(d, d.exercises.map((e) => e.key));
    const [a, b] = d.exercises as [(typeof d.exercises)[0], (typeof d.exercises)[0]];
    d = updateSet(updateSet(d, a.key, a.sets[0]!.id, { reps: 10 }), b.key, b.sets[0]!.id, { reps: 10 });
    const first = toggleSetDone(d, a.key, a.sets[0]!.id, T0, ctx);
    expect(first.restStarted).toBe(false);
    const second = toggleSetDone(first.draft, b.key, b.sets[0]!.id, T0 + 1000, ctx);
    expect(second.restStarted).toBe(true);
  });

  it('counts the rest timer down and reports nothing once it is over', () => {
    let d = withExercises('bench');
    const e = d.exercises[0]!;
    d = toggleSetDone(updateSet(d, e.key, e.sets[0]!.id, { reps: 5 }), e.key, e.sets[0]!.id, T0, ctx).draft;
    expect(restLeftSec(d, T0 + 30_000)).toBe(60);
    expect(restLeftSec(d, T0 + 90_000)).toBeNull();
    expect(adjustRest(d, 15, T0 + 30_000).rest!.endsAt).toBe(T0 + 105_000);
    expect(adjustRest(d, -200, T0 + 30_000).rest).toBeNull();
  });
});

describe('supersets', () => {
  it('groups exercises next to each other and ends a group left with one member', () => {
    let d = withExercises('a', 'b', 'c', 'd');
    d = makeSuperset(d, [d.exercises[0]!.key, d.exercises[3]!.key]);
    expect(d.exercises.map((e) => e.exerciseId)).toEqual(['a', 'd', 'b', 'c']);
    expect(d.exercises.map((e) => e.supersetGroup)).toEqual([1, 1, null, null]);
    expect(leaveSuperset(d, d.exercises[0]!.key).exercises.every((e) => e.supersetGroup === null)).toBe(true);
    expect(removeExercise(d, d.exercises[0]!.key).exercises.every((e) => e.supersetGroup === null)).toBe(true);
  });

  it('needs two exercises', () => {
    const d = withExercises('a', 'b');
    expect(makeSuperset(d, [d.exercises[0]!.key]).exercises.every((e) => e.supersetGroup === null)).toBe(true);
  });
});

describe('starting from a routine or a plan', () => {
  it('copies a routine without checks and forgets a built-in id', () => {
    const d = draftFromRoutine(
      {
        id: 'builtin:ppl-push',
        name: 'Push',
        exercises: [{ exerciseId: 'bench', restSec: 120, note: 'slow', supersetGroup: null, sets: [{ type: 'warmup', weightKg: 20, reps: 10, seconds: null }, { type: 'normal', weightKg: 60, reps: 8, seconds: null }] }],
      },
      T0,
    );
    expect(d.routineId).toBeNull();
    expect(d.name).toBe('Push');
    expect(d.exercises[0]).toMatchObject({ restSec: 120, note: 'slow' });
    expect(d.exercises[0]!.sets.map((s) => [s.type, s.weightKg, s.reps, s.done])).toEqual([['warmup', 20, 10, false], ['normal', 60, 8, false]]);
  });

  it('builds a plan session with the planned sets, reps, seconds and rest', () => {
    const d = draftFromPlan('p1:0:1', [{ exerciseId: 'squat', sets: 3, reps: 10, seconds: null, restSec: 75 }, { exerciseId: 'plank', sets: 2, reps: 0, seconds: 30, restSec: 45 }], T0);
    expect(d.planKey).toBe('p1:0:1');
    expect(d.exercises[0]!.sets).toHaveLength(3);
    expect(d.exercises[0]!.sets[0]).toMatchObject({ reps: 10, seconds: null });
    expect(d.exercises[0]!.restSec).toBe(75);
    expect(d.exercises[1]!.sets[0]).toMatchObject({ reps: null, seconds: 30 });
    // A planned hold opens as a Waktu exercise, a planned rep exercise as Repetisi.
    expect(d.exercises.map((e) => e.timed)).toEqual([false, true]);
  });
});

describe('finishing', () => {
  it('keeps done sets only and drops an exercise with none', () => {
    let d = withExercises('a', 'b');
    const [a, b] = d.exercises as [(typeof d.exercises)[0], (typeof d.exercises)[0]];
    d = addSet(updateSet(d, a.key, a.sets[0]!.id, { weightKg: 20, reps: 10 }), a.key);
    d = toggleSetDone(d, a.key, a.sets[0]!.id, T0 + 1000, ctx).draft;
    void b;
    const w = finishDraft({ ...d, name: ' ' }, T0 + 1_800_000, 'Workout')!;
    expect(w.exercises).toHaveLength(1);
    expect(w.exercises[0]!.sets).toHaveLength(1);
    expect(w).toMatchObject({ name: 'Workout', durationSec: 1800, startedAt: T0, endedAt: T0 + 1_800_000, workoutStart: null, kcal: null });
  });

  it('gives nothing to save when no set was done', () => {
    expect(finishDraft(withExercises('a'), T0 + 1000, 'x')).toBeNull();
  });

  it('does not count a pause that is still open', () => {
    let d = withExercises('a');
    const e = d.exercises[0]!;
    d = toggleSetDone(updateSet(d, e.key, e.sets[0]!.id, { reps: 5 }), e.key, e.sets[0]!.id, T0, { ...ctx, autoRest: false }).draft;
    d = pauseDraft(d, T0 + 600_000);
    expect(finishDraft(d, T0 + 1_200_000, 'x')!.durationSec).toBe(600);
  });
});

describe('editing and repeating', () => {
  const finished = () => {
    let d = withExercises('a');
    const e = d.exercises[0]!;
    d = toggleSetDone(updateSet(d, e.key, e.sets[0]!.id, { weightKg: 30, reps: 10 }), e.key, e.sets[0]!.id, T0, { ...ctx, autoRest: false }).draft;
    return finishDraft(d, T0 + 1_800_000, 'x')!;
  };

  it('repeat gives a new workout with the same sets, nothing done', () => {
    const w = finished();
    const d = draftFromWorkout(w, T0 + 9_000_000, true);
    expect(d.id).not.toBe(w.id);
    expect(d.startedAt).toBe(T0 + 9_000_000);
    expect(d.exercises[0]!.sets[0]).toMatchObject({ weightKg: 30, reps: 10, done: false });
  });

  it('edit keeps the id, start, end and duration, and changes the sets', () => {
    const w = finished();
    let d = draftFromWorkout(w, T0 + 9_000_000, false);
    d = updateSet(d, d.exercises[0]!.key, d.exercises[0]!.sets[0]!.id, { weightKg: 35 });
    const edited = applyEdit(w, d, T0 + 9_000_000)!;
    expect(edited).toMatchObject({ id: w.id, startedAt: w.startedAt, endedAt: w.endedAt, durationSec: w.durationSec, updatedAt: T0 + 9_000_000 });
    expect(edited.exercises[0]!.sets[0]!.weightKg).toBe(35);
  });
});

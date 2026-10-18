import { describe, expect, it } from 'bun:test';

import {
  addExercises,
  addSet,
  copyRoutine,
  editFromRoutine,
  editSnapshot,
  emptyEdit,
  linkedWithNext,
  moveExercise,
  moveRoutine,
  nextSortOrder,
  normalizeSupersets,
  parseAmount,
  parseCollapsed,
  removeExercise,
  removeSet,
  replaceExercise,
  routineFromEdit,
  routineSetCount,
  setExerciseRest,
  storedExercises,
  summarizeSets,
  toggleSupersetWithNext,
  updateSet,
  validateEdit,
  type EditRoutine,
} from './routineEdit';
import type { Routine, RoutineExercise } from './types';

const ex = (exerciseId: string, supersetGroup: number | null = null, sets = 3): RoutineExercise => ({
  exerciseId,
  restSec: 90,
  note: '',
  supersetGroup,
  sets: Array.from({ length: sets }, () => ({ type: 'normal' as const, weightKg: null, reps: 10, seconds: null })),
});

const routine = (id: string, sortOrder: number, folderId: string | null = null, createdAt = 0): Routine => ({
  id,
  name: id,
  folderId,
  note: '',
  exercises: [ex('push_up')],
  sortOrder,
  createdAt,
  updatedAt: 5,
  deletedAt: null,
});

const edit = (...exercises: RoutineExercise[]): EditRoutine => editFromRoutine({ name: 'A', folderId: null, note: '', exercises });
const order = (e: EditRoutine) => e.exercises.map((x) => x.exerciseId).join(',');
const groups = (e: EditRoutine) => e.exercises.map((x) => x.supersetGroup);

describe('editing a routine', () => {
  it('keeps the content through an edit and gives each exercise a unique key', () => {
    const e = edit(ex('a'), ex('b'));
    expect(new Set(e.exercises.map((x) => x.key)).size).toBe(2);
    expect(storedExercises(e.exercises)).toEqual([ex('a'), ex('b')]);
    expect(Object.keys(storedExercises(e.exercises)[0]!)).not.toContain('key');
  });

  it('requires a name and an exercise', () => {
    expect(validateEdit(emptyEdit())).toBe('name');
    expect(validateEdit({ ...emptyEdit(), name: '  ' })).toBe('name');
    expect(validateEdit({ ...emptyEdit(), name: 'Push' })).toBe('exercises');
    expect(validateEdit({ ...edit(ex('a')), name: 'Push' })).toBeNull();
  });

  it('tells a change from none, ignoring spaces around the name', () => {
    const e = edit(ex('a'));
    const before = editSnapshot(e);
    expect(editSnapshot({ ...e, name: ' A ' })).toBe(before);
    expect(editSnapshot({ ...e, name: 'B' })).not.toBe(before);
    expect(editSnapshot(addSet(e, e.exercises[0]!.key))).not.toBe(before);
    expect(editSnapshot(setExerciseRest(e, e.exercises[0]!.key, 60))).not.toBe(before);
  });

  it('adds exercises with three sets of reps, or seconds when timed, and respects a saved rest', () => {
    const e = addExercises(emptyEdit(), [{ exerciseId: 'squat', timed: false }, { exerciseId: 'plank', timed: true }], (id) => (id === 'squat' ? 120 : null));
    expect(e.exercises).toHaveLength(2);
    expect(e.exercises[0]!.sets).toEqual(Array(3).fill({ type: 'normal', weightKg: null, reps: 10, seconds: null }));
    expect(e.exercises[1]!.sets).toEqual(Array(3).fill({ type: 'normal', weightKg: null, reps: null, seconds: 30 }));
    expect(e.exercises.map((x) => x.restSec)).toEqual([120, null]);
  });

  it('stops adding at 40 exercises', () => {
    const full = addExercises(emptyEdit(), Array.from({ length: 50 }, (_, i) => ({ exerciseId: `e${i}`, timed: false })));
    expect(full.exercises).toHaveLength(40);
    expect(addExercises(full, [{ exerciseId: 'x', timed: false }])).toBe(full);
  });

  it('clamps rest and clears it with null', () => {
    const e = edit(ex('a'));
    const key = e.exercises[0]!.key;
    expect(setExerciseRest(e, key, 1).exercises[0]!.restSec).toBe(5);
    expect(setExerciseRest(e, key, 100000).exercises[0]!.restSec).toBe(900);
    expect(setExerciseRest(e, key, null).exercises[0]!.restSec).toBeNull();
  });

  it('replaces an exercise and converts reps and seconds', () => {
    const e = edit(ex('a'));
    const key = e.exercises[0]!.key;
    const timed = replaceExercise(e, key, { exerciseId: 'plank', timed: true });
    expect(timed.exercises[0]!.exerciseId).toBe('plank');
    expect(timed.exercises[0]!.sets[0]).toEqual({ type: 'normal', weightKg: null, reps: null, seconds: 30 });
    const back = replaceExercise(timed, key, { exerciseId: 'b', timed: false });
    expect(back.exercises[0]!.sets[0]).toEqual({ type: 'normal', weightKg: null, reps: 10, seconds: null });
  });
});

describe('sets', () => {
  it('adds a set that copies the last working set, a warm-up copies the reps but no weight', () => {
    let e = edit({ ...ex('a', null, 0), sets: [{ type: 'warmup', weightKg: 20, reps: 12, seconds: null }, { type: 'normal', weightKg: 60, reps: 8, seconds: null }] });
    const key = e.exercises[0]!.key;
    e = addSet(e, key);
    expect(e.exercises[0]!.sets[2]).toEqual({ type: 'normal', weightKg: 60, reps: 8, seconds: null });
    e = addSet(e, key, 'warmup');
    expect(e.exercises[0]!.sets[3]).toEqual({ type: 'warmup', weightKg: null, reps: 8, seconds: null });
  });

  it('adds a first set to an exercise with none', () => {
    const own = edit(ex('a', null, 0));
    expect(own.exercises[0]!.sets).toHaveLength(0);
    expect(addSet(own, own.exercises[0]!.key).exercises[0]!.sets).toEqual([{ type: 'normal', weightKg: null, reps: null, seconds: null }]);
  });

  it('caps sets at 30', () => {
    let e = edit(ex('a', null, 30));
    const key = e.exercises[0]!.key;
    e = addSet(e, key);
    expect(e.exercises[0]!.sets).toHaveLength(30);
  });

  it('removes and updates a set by position', () => {
    let e = edit(ex('a'));
    const key = e.exercises[0]!.key;
    e = updateSet(e, key, 1, { weightKg: 50, type: 'drop' });
    expect(e.exercises[0]!.sets[1]).toEqual({ type: 'drop', weightKg: 50, reps: 10, seconds: null });
    expect(e.exercises[0]!.sets[0]!.weightKg).toBeNull();
    e = removeSet(e, key, 0);
    expect(e.exercises[0]!.sets).toHaveLength(2);
    expect(e.exercises[0]!.sets[0]!.type).toBe('drop');
  });

  it('counts working sets only', () => {
    const r = { exercises: [{ ...ex('a'), sets: [{ type: 'warmup' as const, weightKg: null, reps: 10, seconds: null }, ...ex('a', null, 2).sets] }, ex('b', null, 3)] };
    expect(routineSetCount(r)).toBe(5);
  });
});

describe('supersets', () => {
  it('keeps only adjacent runs of two or more and numbers them from 1', () => {
    expect(groups(edit(ex('a', 5), ex('b', 5), ex('c', null), ex('d', 9), ex('e', 9), ex('f', 9)))).toEqual([1, 1, null, 2, 2, 2]);
    expect(groups(edit(ex('a', 1), ex('b', null), ex('c', 1)))).toEqual([null, null, null]);
    expect(groups(edit(ex('a', 1), ex('b', 1), ex('c', 2), ex('d', 1), ex('e', 1)))).toEqual([1, 1, null, 2, 2]);
    expect(normalizeSupersets([])).toEqual([]);
  });

  it('joins an exercise with the next one and splits them again', () => {
    let e = edit(ex('a'), ex('b'), ex('c'));
    const [a, b] = e.exercises.map((x) => x.key) as [string, string];
    e = toggleSupersetWithNext(e, a);
    expect(groups(e)).toEqual([1, 1, null]);
    expect(linkedWithNext(e.exercises, 0)).toBe(true);
    expect(linkedWithNext(e.exercises, 1)).toBe(false);
    e = toggleSupersetWithNext(e, b);
    expect(groups(e)).toEqual([1, 1, 1]);
    e = toggleSupersetWithNext(e, a);
    expect(groups(e)).toEqual([null, 1, 1]);
  });

  it('joins two groups into one', () => {
    let e = edit(ex('a', 1), ex('b', 1), ex('c', 2), ex('d', 2));
    e = toggleSupersetWithNext(e, e.exercises[1]!.key);
    expect(groups(e)).toEqual([1, 1, 1, 1]);
  });

  it('does nothing for the last exercise', () => {
    const e = edit(ex('a'), ex('b'));
    expect(toggleSupersetWithNext(e, e.exercises[1]!.key)).toBe(e);
  });

  it('removing an exercise dissolves a group left with one', () => {
    let e = edit(ex('a', 1), ex('b', 1), ex('c', null));
    e = removeExercise(e, e.exercises[0]!.key);
    expect(order(e)).toBe('b,c');
    expect(groups(e)).toEqual([null, null]);
  });

  it('removing from the middle of three keeps the other two together', () => {
    let e = edit(ex('a', 1), ex('b', 1), ex('c', 1));
    e = removeExercise(e, e.exercises[1]!.key);
    expect(groups(e)).toEqual([1, 1]);
  });

  it('moves inside a group by swapping with the partner', () => {
    let e = edit(ex('a', 1), ex('b', 1), ex('c'));
    e = moveExercise(e, e.exercises[0]!.key, 1);
    expect(order(e)).toBe('b,a,c');
    expect(groups(e)).toEqual([1, 1, null]);
  });

  it('leaves the group at its edge and jumps over a whole neighbouring group', () => {
    let e = edit(ex('a', 1), ex('b', 1), ex('c', 2), ex('d', 2), ex('e'));
    e = moveExercise(e, e.exercises[1]!.key, 1);
    expect(order(e)).toBe('a,c,d,b,e');
    expect(groups(e)).toEqual([null, 1, 1, null, null]);
  });

  it('moves a lone exercise over a group without splitting it', () => {
    let e = edit(ex('a'), ex('b', 1), ex('c', 1), ex('d'));
    e = moveExercise(e, e.exercises[0]!.key, 1);
    expect(order(e)).toBe('b,c,a,d');
    expect(groups(e)).toEqual([1, 1, null, null]);
    e = moveExercise(e, e.exercises[2]!.key, -1);
    expect(order(e)).toBe('a,b,c,d');
    expect(groups(e)).toEqual([null, 1, 1, null]);
  });

  it('does not move past the ends', () => {
    const e = edit(ex('a'), ex('b'));
    expect(moveExercise(e, e.exercises[0]!.key, -1)).toBe(e);
    expect(moveExercise(e, e.exercises[1]!.key, 1)).toBe(e);
    expect(moveExercise(e, 'missing', 1)).toBe(e);
  });
});

describe('saving', () => {
  it('builds a new routine with an r id, trimmed name and the given order', () => {
    const e: EditRoutine = { ...edit(ex('a'), ex('b', 1), ex('c', 1)), name: '  Push day  ', note: ' x ' };
    const r = routineFromEdit(null, e, 4, 1000);
    expect(r.id.startsWith('r')).toBe(true);
    expect(r).toMatchObject({ name: 'Push day', note: 'x', folderId: null, sortOrder: 4, createdAt: 1000, updatedAt: 1000, deletedAt: null });
    expect(r.exercises.map((x) => x.supersetGroup)).toEqual([null, 1, 1]);
    expect(Object.keys(r.exercises[0]!)).not.toContain('key');
  });

  it('keeps the id, order and creation of an edited routine and moves updatedAt forward', () => {
    const base: Routine = { ...routine('r1', 7, 'f1', 100), updatedAt: 500 };
    const r = routineFromEdit(base, { ...edit(ex('a')), name: 'New', folderId: null }, 99, 300);
    expect(r).toMatchObject({ id: 'r1', sortOrder: 7, createdAt: 100, name: 'New', folderId: null, updatedAt: 501 });
  });

  it('truncates an over-long name', () => {
    expect(routineFromEdit(null, { ...edit(ex('a')), name: 'x'.repeat(100) }, 0, 1).name).toHaveLength(60);
  });

  it('copies a routine to a new id with its content and the given name and place', () => {
    const source: Routine = { ...routine('builtin:push', 0), note: 'n', exercises: [ex('a', 1), ex('b', 1)] };
    const copy = copyRoutine(source, ' Push (copy) ', null, 3, 2000);
    expect(copy.id).not.toBe(source.id);
    expect(copy.id.startsWith('r')).toBe(true);
    expect(copy).toMatchObject({ name: 'Push (copy)', folderId: null, note: 'n', sortOrder: 3, createdAt: 2000, updatedAt: 2000, deletedAt: null });
    expect(copy.exercises).toEqual(source.exercises);
    expect(copy.exercises[0]).not.toBe(source.exercises[0]);
  });
});

describe('number fields', () => {
  it('reads comma and point decimals, rounds to the places, caps at max', () => {
    expect(parseAmount('12', 999, 1)).toBe(12);
    expect(parseAmount('12,5', 999, 1)).toBe(12.5);
    expect(parseAmount('12.5', 999, 1)).toBe(12.5);
    expect(parseAmount('12.56', 999, 1)).toBe(12.6);
    expect(parseAmount(' 7 ', 999, 0)).toBe(7);
    expect(parseAmount('1,', 999, 1)).toBe(1);
    expect(parseAmount('.5', 999, 1)).toBe(0.5);
    expect(parseAmount('5000', 999, 1)).toBe(999);
  });

  it('reads nothing from text that is not a plain number', () => {
    for (const text of ['', ' ', 'abc', '-3', '1e3', '1.2.3', '1,2,3', '--', '12kg']) expect(parseAmount(text, 999, 1)).toBeNull();
  });
});

describe('the routine list', () => {
  it('puts a new routine last', () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([routine('a', 0), routine('b', 4)])).toBe(5);
  });

  it('moves a routine inside its folder only and renumbers the folder', () => {
    const list = [routine('a', 0), routine('b', 1), routine('c', 2), routine('x', 0, 'f1'), routine('y', 1, 'f1')];
    const changed = moveRoutine(list, 'a', 1, 99);
    expect(changed.map((r) => [r.id, r.sortOrder])).toEqual([['b', 0], ['a', 1]]);
    expect(changed.every((r) => r.updatedAt >= 99)).toBe(true);
    expect(moveRoutine(list, 'y', -1, 99).map((r) => [r.id, r.sortOrder])).toEqual([['y', 0], ['x', 1]]);
  });

  it('cannot move past the ends and ignores unknown ids', () => {
    const list = [routine('a', 0), routine('b', 1)];
    expect(moveRoutine(list, 'a', -1, 1)).toEqual([]);
    expect(moveRoutine(list, 'b', 1, 1)).toEqual([]);
    expect(moveRoutine(list, 'zz', 1, 1)).toEqual([]);
  });

  it('moves despite equal or gappy sort orders (newer first on a tie)', () => {
    const list = [routine('a', 3, null, 10), routine('b', 3, null, 20), routine('c', 9, null, 5)];
    // order: b (newer), a, c
    const changed = moveRoutine(list, 'c', -1, 50);
    expect(changed.map((r) => [r.id, r.sortOrder]).sort()).toEqual([['a', 2], ['b', 0], ['c', 1]].sort());
  });
});

describe('preview summary', () => {
  it('summarises working sets: count, repetition range, heaviest weight', () => {
    const sets = [
      { type: 'warmup' as const, weightKg: 20, reps: 15, seconds: null },
      { type: 'normal' as const, weightKg: 60, reps: 8, seconds: null },
      { type: 'normal' as const, weightKg: 70, reps: 12, seconds: null },
      { type: 'drop' as const, weightKg: null, reps: 10, seconds: null },
    ];
    expect(summarizeSets(sets)).toEqual({ sets: 3, reps: { min: 8, max: 12 }, seconds: null, weightKg: 70 });
  });

  it('summarises a timed exercise by seconds', () => {
    const sets = Array.from({ length: 3 }, () => ({ type: 'normal' as const, weightKg: null, reps: null, seconds: 45 }));
    expect(summarizeSets(sets)).toEqual({ sets: 3, reps: null, seconds: { min: 45, max: 45 }, weightKg: null });
  });

  it('has nothing for no sets or only warm-ups', () => {
    expect(summarizeSets([])).toEqual({ sets: 0, reps: null, seconds: null, weightKg: null });
    expect(summarizeSets([{ type: 'warmup', weightKg: null, reps: 10, seconds: null }]).sets).toBe(0);
  });
});

describe('folded lists', () => {
  it('folds the starters by default once the person has routines, and not before', () => {
    expect(parseCollapsed(null, true)).toEqual(['starters']);
    expect(parseCollapsed(null, false)).toEqual([]);
  });

  it('reads what was saved, even an empty choice, and ignores anything broken', () => {
    expect(parseCollapsed('["f1","starters"]', false)).toEqual(['f1', 'starters']);
    expect(parseCollapsed('[]', true)).toEqual([]);
    expect(parseCollapsed('["f1",3,null]', true)).toEqual(['f1']);
    expect(parseCollapsed('{"a":1}', true)).toEqual([]);
    expect(parseCollapsed('not json', true)).toEqual([]);
  });
});

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  EXERCISES,
  exerciseById,
  exerciseImageUrl,
  exerciseName,
  exercisesByPattern,
  muscleList,
  searchExercises,
} from './index';
import { EXERCISE_IMAGE_BASE, type ExercisePattern } from './types';

const PATTERNS: ExercisePattern[] = ['squat', 'hinge', 'lunge', 'push_h', 'push_v', 'pull_h', 'pull_v', 'core', 'glute', 'calf', 'arms', 'cardio'];
const IMAGE_DIR = join(import.meta.dir, '../../../../site/public/exercises');

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('exercise library', () => {
  test('ids are unique and slug-shaped', () => {
    const ids = EXERCISES.map((exercise) => exercise.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]+$/);
  });

  test('ranks are unique and consecutive inside a pattern', () => {
    for (const pattern of PATTERNS) {
      const ranks = EXERCISES.filter((exercise) => exercise.pattern === pattern).map((exercise) => exercise.rank).sort((a, b) => a - b);
      expect(ranks).toEqual(ranks.map((_, index) => index + 1));
    }
  });

  test('every pattern has at least 3 home and 3 gym options (cardio: home only is enough)', () => {
    for (const pattern of PATTERNS) {
      expect(exercisesByPattern(pattern, 'home').length).toBeGreaterThanOrEqual(3);
      if (pattern !== 'cardio') expect(exercisesByPattern(pattern, 'gym').length).toBeGreaterThanOrEqual(3);
    }
  });

  test('the first three of every pattern and setting are never advanced, and the first is a beginner movement', () => {
    for (const pattern of PATTERNS) {
      for (const setting of ['home', 'gym'] as const) {
        const top = exercisesByPattern(pattern, setting).slice(0, 3);
        for (const exercise of top) expect(`${exercise.id} ${exercise.level}`).not.toBe(`${exercise.id} advanced`);
        expect(`${top[0].id} ${top[0].level}`).toBe(`${top[0].id} beginner`);
      }
    }
  });

  test('exercisesByPattern is sorted by rank and only returns that pattern and setting', () => {
    const list = exercisesByPattern('squat', 'home');
    expect(list.every((exercise) => exercise.pattern === 'squat' && exercise.home)).toBe(true);
    expect(list.map((exercise) => exercise.rank)).toEqual(list.map((exercise) => exercise.rank).sort((a, b) => a - b));
  });

  test('every exercise has at least 3 steps and 2 mistakes in both languages', () => {
    for (const exercise of EXERCISES) {
      for (const locale of ['id', 'en'] as const) {
        expect(exercise.steps[locale].length).toBeGreaterThanOrEqual(3);
        expect(exercise.mistakes[locale].length).toBeGreaterThanOrEqual(2);
      }
      expect(exercise.steps.id.length).toBe(exercise.steps.en.length);
      expect(exercise.mistakes.id.length).toBe(exercise.mistakes.en.length);
    }
  });

  test('no empty strings, no emojis', () => {
    for (const exercise of EXERCISES) {
      for (const text of strings(exercise)) {
        expect(text.trim()).not.toBe('');
        expect(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(text)).toBe(false);
      }
      expect(exercise.primary.length).toBeGreaterThan(0);
    }
  });

  test('muscles are known and secondary never repeats primary', () => {
    for (const exercise of EXERCISES) {
      for (const muscle of [...exercise.primary, ...exercise.secondary]) expect(muscleList).toContain(muscle);
      for (const muscle of exercise.secondary) expect(exercise.primary).not.toContain(muscle);
    }
    expect(new Set(muscleList).size).toBe(muscleList.length);
    expect(muscleList.length).toBe(17);
  });

  test('the image count matches the files on disk, at most 2, and no stray folders', () => {
    for (const exercise of EXERCISES) {
      expect(exercise.images).toBeLessThanOrEqual(2);
      const folder = join(IMAGE_DIR, exercise.id);
      const files = existsSync(folder) ? readdirSync(folder).sort() : [];
      expect(files).toEqual(Array.from({ length: exercise.images }, (_, i) => `${i}.webp`));
    }
    const known = new Set(EXERCISES.map((exercise) => exercise.id));
    const folders = readdirSync(IMAGE_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    for (const folder of folders) expect(known.has(folder.name)).toBe(true);
  });

  test('every image is credited in ATTRIBUTION.txt', () => {
    const credits = readFileSync(join(IMAGE_DIR, 'ATTRIBUTION.txt'), 'utf8');
    for (const exercise of EXERCISES) {
      for (let i = 0; i < exercise.images; i += 1) expect(credits).toContain(`${exercise.id}/${i}.webp`);
    }
  });

  test('timed exercises are the holds', () => {
    expect(EXERCISES.filter((exercise) => exercise.timed).map((exercise) => exercise.id).sort()).toEqual(['plank', 'side_plank', 'wall_sit']);
  });

  test('required movements are present', () => {
    for (const id of ['plank', 'wall_sit', 'push_up', 'bodyweight_squat', 'glute_bridge', 'barbell_deadlift', 'burpee', 'mountain_climber', 'jumping_jacks', 'dead_bug', 'bird_dog']) {
      expect(exerciseById(id)).toBeDefined();
    }
  });
});

describe('lookups', () => {
  test('exerciseById and exerciseName', () => {
    const def = exerciseById('push_up');
    expect(def).toBeDefined();
    expect(exerciseName(def!, 'id')).toBe('Push-up');
    expect(exerciseName(exerciseById('wall_sit')!, 'en')).toBe('Wall sit');
    expect(exerciseById('nope')).toBeUndefined();
  });

  test('exerciseImageUrl points at the site assets', () => {
    expect(exerciseImageUrl('push_up', 1)).toBe(`${EXERCISE_IMAGE_BASE}/push_up/1.webp`);
    expect(EXERCISE_IMAGE_BASE).toBe('https://fit.joyorogo.com/exercises');
  });

  test('searchExercises matches both languages, folds punctuation, ranks prefix matches first', () => {
    expect(searchExercises('push up', 'id').map((exercise) => exercise.id)).toContain('push_up');
    expect(searchExercises('PUSH-UP', 'en')[0]?.name.en.toLowerCase()).toContain('push-up');
    expect(searchExercises('lari', 'id').map((exercise) => exercise.id)).toContain('running_treadmill');
    expect(searchExercises('treadmill', 'id').map((exercise) => exercise.id)).toContain('running_treadmill');
    expect(searchExercises('zzzz', 'en')).toEqual([]);
    expect(searchExercises('squat', 'en')[0]?.name.en.toLowerCase()).toContain('squat');
  });

  test('searchExercises filters by pattern, setting, muscle, equipment and level', () => {
    const all = searchExercises('', 'en');
    expect(all.length).toBe(EXERCISES.length);
    expect(searchExercises('', 'en', { pattern: 'core' }).every((exercise) => exercise.pattern === 'core')).toBe(true);
    expect(searchExercises('', 'en', { setting: 'home' }).every((exercise) => exercise.home)).toBe(true);
    expect(searchExercises('', 'en', { muscle: 'calves' }).every((exercise) => exercise.primary.includes('calves') || exercise.secondary.includes('calves'))).toBe(true);
    expect(searchExercises('', 'en', { equipment: 'band' }).every((exercise) => exercise.equipment === 'band')).toBe(true);
    expect(searchExercises('', 'en', { level: 'advanced' }).every((exercise) => exercise.level === 'advanced')).toBe(true);
    expect(searchExercises('row', 'en', { pattern: 'pull_h', setting: 'home' }).length).toBeGreaterThan(0);
  });
});

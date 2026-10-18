import { describe, expect, it } from 'bun:test';

import { exerciseById } from '@/features/coach/exercises';

import { getStarterRoutine, isStarterId, starterRoutines } from './starterRoutines';
import { normalizeSupersets, routineSetCount } from './routineEdit';

const LOCALES = ['id', 'en'] as const;

describe('starter routines', () => {
  it('has the planned slugs, in order, with builtin ids', () => {
    expect(starterRoutines('en').map((r) => r.id)).toEqual([
      'builtin:full-body-a',
      'builtin:full-body-b',
      'builtin:push',
      'builtin:pull',
      'builtin:legs',
      'builtin:home-bodyweight',
      'builtin:home-dumbbell',
    ]);
  });

  it('looks one up by id and language, and knows nothing else', () => {
    expect(getStarterRoutine('builtin:push', 'id')?.name).toBe('Push (dorong)');
    expect(getStarterRoutine('builtin:push', 'en')?.name).toBe('Push');
    expect(getStarterRoutine('builtin:nope', 'en')).toBeNull();
    expect(getStarterRoutine('r123', 'en')).toBeNull();
    expect(isStarterId('builtin:push')).toBe(true);
    expect(isStarterId('r123')).toBe(false);
  });

  it('is shaped like a stored routine: no folder, list order, no timestamps, not deleted', () => {
    starterRoutines('en').forEach((r, i) => {
      expect(r.folderId).toBeNull();
      expect(r.sortOrder).toBe(i);
      expect(r.createdAt).toBe(0);
      expect(r.updatedAt).toBe(0);
      expect(r.deletedAt).toBeNull();
    });
  });

  for (const locale of LOCALES) {
    describe(locale, () => {
      const routines = starterRoutines(locale);

      it('has a name and a note for each', () => {
        for (const r of routines) {
          expect(r.name.length).toBeGreaterThan(1);
          expect(r.note.length).toBeGreaterThan(10);
        }
        expect(new Set(routines.map((r) => r.name)).size).toBe(routines.length);
      });

      it('uses only exercises of the library', () => {
        for (const r of routines) {
          for (const e of r.exercises) expect(exerciseById(e.exerciseId)).toBeDefined();
          expect(new Set(r.exercises.map((e) => e.exerciseId)).size).toBe(r.exercises.length);
        }
      });

      it('counts timed exercises in seconds and the others in repetitions', () => {
        for (const r of routines) {
          for (const e of r.exercises) {
            const timed = exerciseById(e.exerciseId)!.timed;
            for (const s of e.sets) {
              if (timed) {
                expect(s.reps).toBeNull();
                expect(s.seconds).toBeGreaterThanOrEqual(15);
                expect(s.seconds).toBeLessThanOrEqual(120);
              } else {
                expect(s.seconds).toBeNull();
                expect(s.reps).toBeGreaterThanOrEqual(5);
                expect(s.reps).toBeLessThanOrEqual(20);
              }
              expect(s.weightKg).toBeNull();
            }
          }
        }
      });

      it('has sane sets and rest', () => {
        for (const r of routines) {
          expect(r.exercises.length).toBeGreaterThanOrEqual(4);
          expect(r.exercises.length).toBeLessThanOrEqual(10);
          for (const e of r.exercises) {
            const working = e.sets.filter((s) => s.type === 'normal');
            expect(working.length).toBeGreaterThanOrEqual(2);
            expect(working.length).toBeLessThanOrEqual(5);
            expect(e.sets.filter((s) => s.type !== 'normal' && s.type !== 'warmup')).toHaveLength(0);
            expect(e.restSec).toBeGreaterThanOrEqual(30);
            expect(e.restSec).toBeLessThanOrEqual(180);
          }
          expect(routineSetCount(r)).toBeGreaterThanOrEqual(12);
        }
      });

      it('opens every gym routine with a warm-up on its first big lift, and puts it first only', () => {
        for (const slug of ['full-body-a', 'full-body-b', 'push', 'pull', 'legs']) {
          const r = getStarterRoutine(`builtin:${slug}`, locale)!;
          expect(r.exercises[0]!.sets[0]!.type).toBe('warmup');
          expect(r.exercises[0]!.sets[0]!.weightKg).toBeNull();
          expect(r.exercises.slice(1).some((e) => e.sets.some((s) => s.type === 'warmup'))).toBe(false);
        }
      });

      it('keeps supersets adjacent and in pairs or more', () => {
        for (const r of routines) expect(normalizeSupersets(r.exercises)).toEqual(r.exercises.map((e) => ({ ...e, supersetGroup: e.supersetGroup })));
      });
    });
  }

  it('home routines need no gym equipment', () => {
    const gymOnly = (id: string) => !exerciseById(id)!.home;
    for (const slug of ['home-bodyweight', 'home-dumbbell']) {
      expect(getStarterRoutine(`builtin:${slug}`, 'en')!.exercises.filter((e) => gymOnly(e.exerciseId))).toHaveLength(0);
    }
    const bodyweight = getStarterRoutine('builtin:home-bodyweight', 'en')!;
    expect(bodyweight.exercises.every((e) => exerciseById(e.exerciseId)!.equipment === 'bodyweight')).toBe(true);
  });

  it('returns the same list on every call (callers must not change it)', () => {
    expect(starterRoutines('en')).toBe(starterRoutines('en'));
  });
});

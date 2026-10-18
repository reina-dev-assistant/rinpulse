/**
 * Throwaway-grade walkthrough of a fresh install with no watch, end to end, over the app's real schema in memory (bun:sqlite):
 * first launch -> the guide's no-watch route -> Today decides "no watch" -> a strength workout is logged and finished -> it is in the
 * strength history and in the Workouts list with a MET-based energy -> Today still says "no watch" -> Coach reacts to "how you feel"
 * with no readiness -> a hand-typed run lands in the Workouts list too.
 */
import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import migrationsJson from '../../../modules/huawei-wear/schema/joyofit-db-migrations.json';
import { hasStoredWatch, hasWatchData, listWorkouts } from '@/db/queries';
import { suggest, type SuggestionInput } from '@/features/coach/suggest';
import { presenceOf, showsWatchUi } from '@/features/device/presence';
import { advance, chooseNoWatch, currentStep, resolveLaunch, visibleSteps, type StepContext } from '@/features/onboarding/flow';
import { manualRow } from '@/features/workouts/manual';
import { saveManualWorkout } from '@/features/workouts/manualStore';

import { estimateKcal, workoutTotals } from './calc';
import { addExercises, emptyDraft, finishDraft, toggleSetDone, updateSet, type RestContext } from './draft';
import { attachWorkoutRow } from './link';
import { ensureStrengthSchema, listStrengthWorkouts, saveWorkout } from './store';

async function open() {
  const raw = new Database(':memory:');
  for (const statements of migrationsJson) raw.exec(statements.join(';\n'));
  const db = {
    execAsync: async (sql: string) => void raw.exec(sql),
    runAsync: async (sql: string, ...params: unknown[]) => {
      const r = raw.query(sql).run(...(params as never[]));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes };
    },
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

const ANDROID: StepContext = { platform: 'android', cloudConfigured: true };
const T0 = 1_792_058_016_000;
const REST: RestContext = { defaultRestSec: 90, autoRest: true, prefs: new Map() };

const presence = async (db: SQLiteDatabase) =>
  presenceOf({ linked: false, remembered: false, stored: await hasStoredWatch(db), hasData: await hasWatchData(db) });

describe('a fresh install with no watch', () => {
  it('gets through the guide, logs a strength workout and a run, and Today stays a no-watch Today', async () => {
    const db = await open();

    // 1. First launch: the guide opens; the person picks "no watch" and walks to the end without a single watch step.
    expect(await presence(db)).toBe('none');
    const launch = resolveLaunch({ stored: null, hasPairedWatch: false });
    expect(launch.show?.status).toBe('active');
    let guide = chooseNoWatch(launch.show!, ANDROID);
    const seen: string[] = [];
    while (guide.status === 'active') {
      seen.push(currentStep(guide, ANDROID));
      guide = advance(guide, ANDROID);
    }
    expect(seen).toEqual(['phone', 'account', 'pro', 'cloud', 'done']);
    expect(guide.status).toBe('completed');
    expect(visibleSteps(guide, ANDROID)).not.toContain('pair');

    // 2. Today: no watch -> the strength-first Today, not the watch's empty cards.
    expect(showsWatchUi(await presence(db))).toBe(false);

    // 3. Log a workout: two exercises, tick the sets, finish.
    let draft = addExercises(emptyDraft(T0, 'Home, dumbbells'), [
      { exerciseId: 'goblet-squat', timed: false },
      { exerciseId: 'floor-press', timed: false },
    ]);
    for (const exercise of draft.exercises) {
      for (const set of exercise.sets) {
        draft = updateSet(draft, exercise.key, set.id, { weightKg: 12, reps: 10 });
        draft = toggleSetDone(draft, exercise.key, set.id, T0 + 60_000, REST).draft;
      }
    }
    const finished = finishDraft(draft, T0 + 35 * 60_000, 'Latihan');
    expect(finished).not.toBeNull();
    const attached = await attachWorkoutRow(db, finished!, 70);
    await saveWorkout(db, attached);

    // 4. It is in the strength history, with a MET-based energy and the logger's own `workouts` row (no heart rate anywhere).
    const history = await listStrengthWorkouts(db);
    expect(history).toHaveLength(1);
    expect(workoutTotals(history[0]!).sets).toBeGreaterThan(0);
    expect(history[0]!.kcalSource).toBe('estimate');
    expect(history[0]!.kcal).toBe(estimateKcal(finished!, 70));
    expect(history[0]!.kcal).toBeGreaterThan(50);
    const rows = await listWorkouts(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.imported).toBe(true);
    expect(rows[0]!.avgHr).toBeNull();

    // 5. Today is still the no-watch Today: the logger's own row is not watch data.
    expect(await presence(db)).toBe('none');

    // 6. Coach with no readiness at all: a general suggestion that does not send a lifter for a run; then "tired" is heard.
    const none: SuggestionInput = {
      readiness: null,
      feel: null,
      load: null,
      hrv: null,
      lastNightMin: null,
      sleepDebtMin: null,
      strainYesterday: null,
      strainDayBefore: null,
      activeStreak: 0,
      recoveryHoursLeft: null,
      trainedToday: null,
      usualSport: 'strength',
      planned: null,
      plannedDone: false,
      missed: null,
      planState: 'none',
    };
    expect(suggest(none).effective?.type).toBe('strength');
    expect(suggest({ ...none, feel: 'wrecked' }).kind).toBe('activeRest');

    // 7. Phone-only cardio: a hand-typed run shows up in the same list, still without a watch.
    const id = await saveManualWorkout(db, manualRow({ sport: 'run', start: Math.floor(T0 / 1000) + 86_400, minutes: 30, km: 5, kcal: null, weightKg: 70 }));
    expect(id).toBeGreaterThan(0);
    const after = await listWorkouts(db);
    expect(after.map((w) => w.sportName).sort()).toEqual(['Run', 'Strength Training']);
    expect(await presence(db)).toBe('none');
  });
});

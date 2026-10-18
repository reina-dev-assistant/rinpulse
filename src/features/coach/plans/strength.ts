import { EXERCISES } from '../exercises';
import type { Equipment, ExerciseDef, ExercisePattern } from '../exercises/types';
import type { PlanLevel, StrengthSetting } from '../doc';
import type { PlannedExercise, StrengthSpec, WeekPhase } from './types';

/**
 * Full-body strength plans, 2 or 3 sessions a week for 8 weeks. JoyoFit's own scheme from common coaching practice, not
 * a published programme; every rule is a constant here and is listed in `docs/coach.md`.
 *
 *  - Session A: squat, horizontal push, horizontal pull, hinge, core. B: lunge, vertical push, vertical pull, glute, core.
 *    C: hinge, push, pull and squat again with other exercises, and a calf raise. Two sessions a week are A and B.
 *  - Exercises come from the library (`exercises/`) by pattern: at home the ones with no equipment first (a pattern without any,
 *    like rows, falls back to a resistance band, then a dumbbell); in the gym machines, dumbbells, barbells and cables
 *    first. Beginners get beginner exercises only, intermediate the beginner and intermediate ones, advanced all of them.
 *    Within a pattern the order is the library's `rank`; the sessions take different ranks so no two sessions repeat.
 *  - Sets: beginner 2, then 3 from week 3; intermediate 3, 4 from week 5; advanced 3, 4 from week 3. Reps at home grow by 1
 *    every 2 weeks (12 / 15 / 15 to start by level, 4 more at most); in the gym 12 / 10 / 8 with the load going up in the
 *    logger. Timed exercises start at 20 / 30 / 40 seconds and add 5 seconds every 2 weeks.
 *  - Rest: 90 seconds after a compound lift (120 for advanced), 60 after core, calf and arm work, 45 after a plank.
 *  - Week 4 is a cut-back (80 % of the sets); the weekly adaptation scales the sets of its week on top.
 */

export const STRENGTH_WEEKS = 8;
const CUTBACK_WEEK = 3;
const CUTBACK_SCALE = 0.8;

const ALLOWED: Record<PlanLevel, readonly ExerciseDef['level'][]> = {
  beginner: ['beginner'],
  intermediate: ['beginner', 'intermediate'],
  advanced: ['beginner', 'intermediate', 'advanced'],
};

const SESSION_SLOTS: Record<'A' | 'B' | 'C', { pattern: ExercisePattern; offset: number }[]> = {
  A: [
    { pattern: 'squat', offset: 0 },
    { pattern: 'push_h', offset: 0 },
    { pattern: 'pull_h', offset: 0 },
    { pattern: 'hinge', offset: 0 },
    { pattern: 'core', offset: 0 },
  ],
  B: [
    { pattern: 'lunge', offset: 0 },
    { pattern: 'push_v', offset: 0 },
    { pattern: 'pull_v', offset: 0 },
    { pattern: 'glute', offset: 0 },
    { pattern: 'core', offset: 1 },
  ],
  C: [
    { pattern: 'hinge', offset: 1 },
    { pattern: 'push_h', offset: 1 },
    { pattern: 'pull_h', offset: 1 },
    { pattern: 'squat', offset: 1 },
    { pattern: 'calf', offset: 0 },
  ],
};

const HOME_PRIORITY: Partial<Record<Equipment, number>> = { bodyweight: 0, band: 1, dumbbell: 2 };
const GYM_FREE_WEIGHT: readonly Equipment[] = ['bodyweight', 'band'];
/** Patterns the gym does not need equipment for. */
const GYM_ANY: readonly ExercisePattern[] = ['core', 'calf'];
const COMPOUND: readonly ExercisePattern[] = ['squat', 'hinge', 'lunge', 'push_h', 'push_v', 'pull_h', 'pull_v'];

/** The exercises of a pattern for the setting and level, in the order a session takes them. */
export function candidates(pattern: ExercisePattern, setting: StrengthSetting, level: PlanLevel): ExerciseDef[] {
  const inSetting = EXERCISES.filter((e) => e.pattern === pattern && e[setting]);
  const byLevel = inSetting.filter((e) => ALLOWED[level].includes(e.level));
  const pool = byLevel.length > 0 ? byLevel : inSetting;
  const byRank = (a: ExerciseDef, b: ExerciseDef) => a.rank - b.rank;
  if (setting === 'home') {
    const priority = (e: ExerciseDef) => HOME_PRIORITY[e.equipment] ?? 3;
    const best = Math.min(...pool.map(priority));
    return pool.filter((e) => priority(e) === best).sort(byRank);
  }
  if (GYM_ANY.includes(pattern)) return [...pool].sort(byRank);
  const weighted = pool.filter((e) => !GYM_FREE_WEIGHT.includes(e.equipment));
  return (weighted.length > 0 ? weighted : pool).sort(byRank);
}

export function setsFor(level: PlanLevel, week: number): number {
  switch (level) {
    case 'beginner':
      return week >= 2 ? 3 : 2;
    case 'intermediate':
      return week >= 4 ? 4 : 3;
    default:
      return week >= 2 ? 4 : 3;
  }
}

export function repsFor(level: PlanLevel, setting: StrengthSetting, week: number): number {
  if (setting === 'gym') return level === 'beginner' ? 12 : level === 'intermediate' ? 10 : 8;
  return (level === 'beginner' ? 12 : 15) + Math.min(4, Math.floor(week / 2));
}

export function secondsFor(level: PlanLevel, week: number): number {
  return (level === 'beginner' ? 20 : level === 'intermediate' ? 30 : 40) + 5 * Math.floor(week / 2);
}

function restFor(def: ExerciseDef, level: PlanLevel): number {
  if (def.timed) return 45;
  if (!COMPOUND.includes(def.pattern)) return 60;
  return level === 'advanced' ? 120 : 90;
}

/** Work time of one set, seconds, for the length estimate. */
const SET_WORK_SEC = 45;
const WARMUP_MIN = 5;

export interface StrengthSession {
  spec: StrengthSpec;
  minutes: number;
}

export function strengthPhase(week: number): WeekPhase {
  return week === CUTBACK_WEEK ? 'cutback' : 'build';
}

/** The sessions in a week, in slot order: `A, B` or `A, B, C`. */
export function focusOf(slot: number): 'A' | 'B' | 'C' {
  return slot === 0 ? 'A' : slot === 1 ? 'B' : 'C';
}

/** One strength session: the library's exercises for the focus, with sets, reps or seconds and rest. `scale` is the weekly adaptation (1 = as planned). */
export function strengthSession(
  plan: { level: PlanLevel; setting: StrengthSetting | null },
  week: number,
  slot: number,
  scale: number,
): StrengthSession {
  const setting = plan.setting ?? 'home';
  const focus = focusOf(slot);
  const factor = (week === CUTBACK_WEEK ? CUTBACK_SCALE : 1) * scale;
  const baseSets = setsFor(plan.level, week);
  const used = new Set<string>();
  const exercises: PlannedExercise[] = [];
  for (const slotDef of SESSION_SLOTS[focus]) {
    const list = candidates(slotDef.pattern, setting, plan.level);
    if (list.length === 0) continue;
    // Take the offset-th one; skip an exercise this session already has (core appears twice across sessions, never twice in one).
    let index = slotDef.offset % list.length;
    for (let tries = 0; tries < list.length && used.has(list[index]!.id); tries++) index = (index + 1) % list.length;
    const def = list[index]!;
    used.add(def.id);
    exercises.push({
      exerciseId: def.id,
      sets: Math.max(1, Math.round(baseSets * factor)),
      reps: def.timed ? 0 : repsFor(plan.level, setting, week),
      seconds: def.timed ? secondsFor(plan.level, week) : null,
      restSec: restFor(def, plan.level),
    });
  }
  const sec = exercises.reduce((sum, e) => sum + e.sets * ((e.seconds ?? SET_WORK_SEC) + e.restSec), 0);
  const minutes = Math.max(15, Math.round((sec / 60 + WARMUP_MIN) / 5) * 5);
  return { spec: { focus, exercises }, minutes };
}

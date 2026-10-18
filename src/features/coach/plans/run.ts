import type { CoachPlan, PlanGoal, PlanLevel, RunGoal } from '../doc';
import type { HrZone, RunSpec, SessionType, WeekPhase } from './types';

/**
 * Running plans. JoyoFit's own progression, built from the usual coaching rules and not copied from a published
 * programme; every rule is a constant below, and `docs/coach.md` lists them.
 *
 *  - Three to five sessions a week in this order of slots: easy, quality, (recovery), (easy), long. The long run is the
 *    last slot, so it falls on the last weekday you picked.
 *  - Volume grows linearly from the first week's minutes to the peak, rounded to 5 minutes; every fourth week is a
 *    cut-back at 80 %; race goals end with a taper week at 60 % whose last session is the distance itself.
 *  - Beginners start with walk/run intervals (a brisk walk, then alternating running and walking: the familiar
 *    couch-to-5K idea) and move to continuous running after `walkRunWeeks`.
 *  - Quality alternates tempo (a steady comfortably hard stretch, zone 3-4) and intervals (3 min hard, 2 min easy jog)
 *    from the intermediate level up; beginners have no quality session, theirs is an easy run.
 *  - Easy means zone 2 (60-70 % of the maximum heart rate), so you can talk. Long runs are zone 2 too.
 */

const CUTBACK_EVERY = 4;
const CUTBACK_SCALE = 0.8;
const TAPER_SCALE = 0.6;
const MIN_CONTINUOUS_MIN = 15;
const WARMUP_MIN = 10;
const COOLDOWN_MIN = 5;
const INTERVAL_WORK_SEC = 180;
const INTERVAL_REST_SEC = 120;
const MIN_INTERVAL_REPS = 3;
const MAX_INTERVAL_REPS = 8;
const MIN_WALKRUN_REPS = 3;

interface Span {
  /** Minutes of the first and of the last build week. */
  from: number;
  to: number;
}

interface Recipe {
  weeks: number;
  /** Weeks of walk/run before continuous running; 0 = none. */
  walkRunWeeks: number;
  /** Where in `WALK_RUN` the first walk/run week starts (a beginner aiming at 10 km starts further on). */
  walkRunFrom: number;
  easy: Span;
  long: Span;
  /** Main minutes of the quality session (tempo block, or the hard part of intervals). */
  quality: Span;
  /** Distance the last session covers, metres; null for open plans. */
  raceM: number | null;
  /** Planned minutes of that last session. */
  raceMin: number;
}

const span = (from: number, to: number): Span => ({ from, to });

export const RECIPES: Record<RunGoal, Partial<Record<PlanLevel, Recipe>>> = {
  run5k: {
    beginner: { weeks: 8, walkRunWeeks: 6, walkRunFrom: 0, easy: span(20, 30), long: span(25, 40), quality: span(0, 0), raceM: 5000, raceMin: 35 },
    intermediate: { weeks: 8, walkRunWeeks: 0, walkRunFrom: 0, easy: span(25, 35), long: span(35, 50), quality: span(12, 20), raceM: 5000, raceMin: 30 },
    advanced: { weeks: 8, walkRunWeeks: 0, walkRunFrom: 0, easy: span(30, 40), long: span(45, 60), quality: span(20, 30), raceM: 5000, raceMin: 25 },
  },
  run10k: {
    beginner: { weeks: 12, walkRunWeeks: 4, walkRunFrom: 2, easy: span(25, 40), long: span(35, 65), quality: span(0, 0), raceM: 10000, raceMin: 75 },
    intermediate: { weeks: 10, walkRunWeeks: 0, walkRunFrom: 0, easy: span(30, 40), long: span(45, 75), quality: span(15, 25), raceM: 10000, raceMin: 60 },
    advanced: { weeks: 10, walkRunWeeks: 0, walkRunFrom: 0, easy: span(35, 45), long: span(60, 90), quality: span(20, 35), raceM: 10000, raceMin: 50 },
  },
  runHalf: {
    beginner: { weeks: 14, walkRunWeeks: 4, walkRunFrom: 2, easy: span(25, 45), long: span(40, 100), quality: span(0, 0), raceM: 21097, raceMin: 160 },
    intermediate: { weeks: 12, walkRunWeeks: 0, walkRunFrom: 0, easy: span(30, 45), long: span(55, 110), quality: span(15, 30), raceM: 21097, raceMin: 130 },
    advanced: { weeks: 12, walkRunWeeks: 0, walkRunFrom: 0, easy: span(40, 50), long: span(75, 125), quality: span(25, 40), raceM: 21097, raceMin: 110 },
  },
  runRoutine: {
    beginner: { weeks: 8, walkRunWeeks: 4, walkRunFrom: 0, easy: span(20, 30), long: span(25, 40), quality: span(0, 0), raceM: null, raceMin: 0 },
    intermediate: { weeks: 8, walkRunWeeks: 0, walkRunFrom: 0, easy: span(30, 40), long: span(40, 55), quality: span(0, 0), raceM: null, raceMin: 0 },
    advanced: { weeks: 8, walkRunWeeks: 0, walkRunFrom: 0, easy: span(35, 45), long: span(50, 65), quality: span(15, 25), raceM: null, raceMin: 0 },
  },
};

/** Run seconds, walk seconds and repetitions of the walk/run weeks, easiest first. The last step is 3 x 8 min. */
export const WALK_RUN: readonly { runSec: number; walkSec: number; reps: number }[] = [
  { runSec: 60, walkSec: 120, reps: 8 },
  { runSec: 90, walkSec: 120, reps: 7 },
  { runSec: 120, walkSec: 90, reps: 7 },
  { runSec: 180, walkSec: 90, reps: 5 },
  { runSec: 300, walkSec: 90, reps: 4 },
  { runSec: 480, walkSec: 90, reps: 3 },
];

export function recipeFor(goal: PlanGoal, level: PlanLevel): Recipe {
  const recipe = (RECIPES as Partial<Record<PlanGoal, Partial<Record<PlanLevel, Recipe>>>>)[goal]?.[level];
  if (!recipe) throw new Error(`no run recipe for ${goal} ${level}`); // i18n-ok: developer error
  return recipe;
}

/** Plan length in weeks for a run goal and level. */
export function runWeeks(goal: PlanGoal, level: PlanLevel): number {
  return recipeFor(goal, level).weeks;
}

/** The slots of a week: which session each preferred day carries, in order. */
export function slotTypes(goal: PlanGoal, level: PlanLevel, daysPerWeek: number): SessionType[] {
  const quality: SessionType = level === 'beginner' ? 'easy' : goal === 'runRoutine' && level === 'intermediate' ? 'easy' : 'tempo';
  switch (daysPerWeek) {
    case 3:
      return ['easy', quality, 'long'];
    case 4:
      return ['easy', quality, 'recovery', 'long'];
    default:
      return ['easy', quality, 'recovery', 'easy', 'long'];
  }
}

export function weekPhase(week: number, weeks: number, raceGoal: boolean): WeekPhase {
  if (raceGoal && week === weeks - 1) return 'taper';
  if (week % CUTBACK_EVERY === CUTBACK_EVERY - 1 && week < weeks - 1) return 'cutback';
  return 'build';
}

const lerp = (s: Span, t: number): number => s.from + (s.to - s.from) * t;
const roundTo5 = (minutes: number): number => Math.max(MIN_CONTINUOUS_MIN, Math.round(minutes / 5) * 5);

export interface RunSession {
  type: SessionType;
  minutes: number;
  hard: boolean;
  run: RunSpec;
}

const NO_STRUCTURE = { walkRun: null, tempo: null, intervals: null } as const;

function walkRunSession(step: number, extraReps: number, scale: number): RunSession {
  const entry = WALK_RUN[Math.min(WALK_RUN.length - 1, Math.max(0, step))]!;
  const reps = Math.max(MIN_WALKRUN_REPS, Math.round((entry.reps + extraReps) * scale));
  const walkRun = { warmupMin: 5, runSec: entry.runSec, walkSec: entry.walkSec, reps, cooldownMin: 5 };
  const minutes = 10 + Math.round((reps * (entry.runSec + entry.walkSec)) / 60);
  return { type: 'walkrun', minutes, hard: false, run: { type: 'walkrun', zone: 2, distanceM: null, ...NO_STRUCTURE, walkRun } };
}

function continuous(type: 'easy' | 'recovery' | 'long', minutes: number, hard: boolean): RunSession {
  return { type, minutes, hard, run: { type, zone: type === 'recovery' ? 1 : 2, distanceM: null, ...NO_STRUCTURE } };
}

/**
 * One planned running session before dates and adaptation scaling are attached. `scale` is the weekly adaptation
 * (1 = as planned); `phaseScale` is the cut-back or taper factor of the week.
 */
export function runSession(plan: Pick<CoachPlan, 'goal' | 'level' | 'daysPerWeek'>, week: number, slot: number, scale: number): RunSession {
  const recipe = recipeFor(plan.goal, plan.level);
  const phase = weekPhase(week, recipe.weeks, recipe.raceM !== null);
  const types = slotTypes(plan.goal, plan.level, plan.daysPerWeek);
  const type = types[slot] ?? 'easy';
  const buildWeeks = Math.max(1, recipe.weeks - (recipe.raceM !== null ? 2 : 1));
  const t = Math.min(1, week / buildWeeks);
  const phaseScale = phase === 'taper' ? TAPER_SCALE : phase === 'cutback' ? CUTBACK_SCALE : 1;
  const factor = phaseScale * scale;

  if (recipe.raceM !== null && phase === 'taper' && slot === types.length - 1) {
    return {
      type: 'race',
      minutes: recipe.raceMin,
      hard: true,
      run: { type: 'race', zone: 3, distanceM: recipe.raceM, ...NO_STRUCTURE },
    };
  }

  if (week < recipe.walkRunWeeks && (type === 'easy' || type === 'long' || type === 'recovery')) {
    const step = recipe.walkRunFrom + week;
    return walkRunSession(step, type === 'long' ? 1 : type === 'recovery' ? -1 : 0, factor);
  }

  switch (type) {
    case 'long': {
      const minutes = roundTo5(lerp(recipe.long, t) * factor);
      return continuous('long', minutes, minutes >= 60);
    }
    case 'recovery':
      return continuous('recovery', roundTo5(Math.min(30, lerp(recipe.easy, t)) * factor), false);
    case 'tempo': {
      const main = Math.max(8, Math.round((lerp(recipe.quality, t) * factor) / 5) * 5);
      if (week % 2 === 1) {
        const reps = Math.min(MAX_INTERVAL_REPS, Math.max(MIN_INTERVAL_REPS, Math.round((main * 60) / INTERVAL_WORK_SEC / 1.5)));
        const intervals = { warmupMin: WARMUP_MIN, reps, workSec: INTERVAL_WORK_SEC, restSec: INTERVAL_REST_SEC, cooldownMin: COOLDOWN_MIN, workZone: 4 as HrZone };
        const minutes = WARMUP_MIN + COOLDOWN_MIN + Math.round((reps * (INTERVAL_WORK_SEC + INTERVAL_REST_SEC)) / 60);
        return { type: 'intervals', minutes, hard: true, run: { type: 'intervals', zone: 4, distanceM: null, walkRun: null, tempo: null, intervals } };
      }
      const tempo = { warmupMin: WARMUP_MIN, mainMin: main, cooldownMin: COOLDOWN_MIN };
      return { type: 'tempo', minutes: WARMUP_MIN + COOLDOWN_MIN + main, hard: true, run: { type: 'tempo', zone: 3, distanceM: null, walkRun: null, tempo, intervals: null } };
    }
    default:
      return continuous('easy', roundTo5(lerp(recipe.easy, t) * factor), false);
  }
}

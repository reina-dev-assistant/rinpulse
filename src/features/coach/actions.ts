import type { SQLiteDatabase } from 'expo-sqlite';

import { liveDone, type CoachDoc, type CoachPlan, type DoneEntry, type PlanGoal, type PlanKind, type PlanLevel, type StrengthSetting } from './doc';
import { decideWeeks, type AdaptSignals } from './plans/adapt';
import { sessionsOf } from './plans/adapt';
import { runWeeks } from './plans/run';
import { STRENGTH_WEEKS } from './plans/strength';
import { matchWorkouts, type MatchWorkout } from './match';
import { updateCoachDoc } from './store';
import { localDay, mondayOf } from './time';

/** A session the strength logger finished for a plan session (`StrengthWorkout.planKey`): plan session key to the workout's start, unix seconds. */
export type SessionLinks = Readonly<Record<string, number>>;

export interface PlanChoice {
  kind: PlanKind;
  goal: PlanGoal;
  level: PlanLevel;
  daysPerWeek: number;
  setting: StrengthSetting | null;
  /** 0 = Monday, ascending, `daysPerWeek` of them. */
  weekdays: number[];
}

/** Sensible weekdays for `days` sessions: spread out, the last one on the weekend (the long run). */
export function defaultWeekdays(days: number): number[] {
  switch (days) {
    case 2:
      return [1, 4];
    case 3:
      return [1, 3, 5];
    case 4:
      return [0, 2, 4, 6];
    default:
      return [0, 1, 3, 4, 6];
  }
}

export function planWeeks(choice: Pick<PlanChoice, 'kind' | 'goal' | 'level'>): number {
  return choice.kind === 'run' ? runWeeks(choice.goal, choice.level) : STRENGTH_WEEKS;
}

/** The plan document for a choice, starting in the week of `nowMs`. */
export function buildPlan(choice: PlanChoice, nowMs: number): CoachPlan {
  return {
    id: `p${nowMs}`,
    kind: choice.kind,
    goal: choice.goal,
    level: choice.level,
    daysPerWeek: choice.daysPerWeek,
    setting: choice.kind === 'strength' ? choice.setting : null,
    weekdays: [...choice.weekdays].sort((a, b) => a - b),
    startDay: mondayOf(localDay(Math.floor(nowMs / 1000))),
    weeks: planWeeks(choice),
    createdAt: nowMs,
    updatedAt: nowMs,
    adjust: {},
  };
}

/** Starts a plan; the previous plan and its progress are dropped. */
export function startPlan(db: SQLiteDatabase, plan: CoachPlan): Promise<CoachDoc> {
  return updateCoachDoc(db, () => ({ version: 1, plan, planUpdatedAt: plan.createdAt, done: {}, logs: {} }));
}

/** Ends the plan (the end is synced like any change); what was done stays in the watch workouts. */
export function endPlan(db: SQLiteDatabase, nowMs = Date.now()): Promise<CoachDoc> {
  return updateCoachDoc(db, (doc) => (doc.plan === null ? null : { ...doc, plan: null, planUpdatedAt: nowMs, done: {}, logs: {} }));
}

export type Mark = 'done' | 'skipped' | 'undo';

/** Marks a session done or skipped by hand, or takes the mark back. */
export function markSession(db: SQLiteDatabase, key: string, mark: Mark, nowMs = Date.now()): Promise<CoachDoc> {
  return updateCoachDoc(db, (doc) => {
    const existing = doc.done[key];
    if (mark === 'undo') {
      if (!existing || existing.cleared) return null;
      return { ...doc, done: { ...doc.done, [key]: { ...existing, at: nowMs, cleared: true } } };
    }
    return { ...doc, done: { ...doc.done, [key]: { workoutStart: null, at: nowMs, manual: true, skipped: mark === 'skipped' } } };
  });
}

/**
 * Matches new workouts to plan sessions and decides the weeks that have started. One serialised change; returns the
 * stored document and does not write when nothing changed.
 */
export function reconcileCoach(
  db: SQLiteDatabase,
  workouts: readonly MatchWorkout[],
  signals: AdaptSignals,
  links: SessionLinks = {},
  nowMs = Date.now(),
): Promise<CoachDoc> {
  return updateCoachDoc(db, (doc) => {
    const plan = doc.plan;
    if (!plan) return null;
    const today = localDay(Math.floor(nowMs / 1000));
    let next: CoachDoc = doc;

    const sessions = sessionsOf(plan);
    // Sessions the strength logger ran for a plan key are done by that link, not by guessing from the sport.
    const linked: Record<string, DoneEntry> = {};
    for (const session of sessions) {
      const start = links[session.key];
      if (start !== undefined && !liveDone(doc.done)[session.key]) linked[session.key] = { workoutStart: start, at: nowMs, manual: false, skipped: false };
    }
    if (Object.keys(linked).length > 0) next = { ...next, done: { ...next.done, ...linked } };

    const matched = matchWorkouts(sessions, next.done, workouts, nowMs);
    if (Object.keys(matched).length > 0) next = { ...next, done: { ...next.done, ...matched } };

    const adjust = decideWeeks(plan, next.done, today, signals, nowMs);
    if (adjust) next = { ...next, planUpdatedAt: nowMs, plan: { ...plan, adjust, updatedAt: nowMs } };
    return next === doc ? null : next;
  });
}

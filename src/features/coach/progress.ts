import { liveDone, type CoachPlan, type DoneEntry } from './doc';
import { allSessions, generatePlan, weekIndexAt } from './plans/generate';
import type { PlannedSession, PlannedWeek } from './plans/types';
import { daysBetween } from './time';

export type PlanState = 'upcoming' | 'active' | 'finished';

export interface PlanProgress {
  plan: CoachPlan;
  weeks: PlannedWeek[];
  state: PlanState;
  /** Week index of today, clamped to the plan. */
  weekIndex: number;
  /** The session on `today` (done or not), null on a rest day. */
  today: PlannedSession | null;
  todayDone: DoneEntry | null;
  /** The oldest session of this week before today that was neither done nor skipped. */
  missed: PlannedSession | null;
  /** Counted sessions of this week (the days before the plan was made left out) and how many are done. */
  plannedThisWeek: number;
  doneThisWeek: number;
  /** Counted sessions of the whole plan up to today, and how many are done. */
  plannedSoFar: number;
  doneSoFar: number;
  /** Not yet done sessions from today on, in date order. */
  upcoming: PlannedSession[];
}

const isDone = (done: Record<string, DoneEntry>, session: PlannedSession): boolean => {
  const entry = done[session.key];
  return entry !== undefined && !entry.skipped;
};

/** Where the person is in the plan on `today` (`YYYY-MM-DD`). */
export function planProgress(plan: CoachPlan, rawDone: Record<string, DoneEntry>, today: string): PlanProgress {
  const done = liveDone(rawDone);
  const weeks = generatePlan(plan);
  const sessions = allSessions(weeks);
  const counted = sessions.filter((s) => !s.beforeStart);
  const rawWeek = weekIndexAt(plan, today);
  const lastDay = sessions[sessions.length - 1]?.day ?? plan.startDay;
  const state: PlanState = rawWeek < 0 ? 'upcoming' : daysBetween(lastDay, today) > 0 ? 'finished' : 'active';
  const weekIndex = Math.min(plan.weeks - 1, Math.max(0, rawWeek));
  const thisWeek = counted.filter((s) => s.week === weekIndex);
  const todaySession = sessions.find((s) => s.day === today && !s.beforeStart) ?? null;
  const missed = state === 'active' ? (thisWeek.find((s) => daysBetween(s.day, today) > 0 && !done[s.key]) ?? null) : null;
  const upTo = counted.filter((s) => daysBetween(s.day, today) >= 0);
  return {
    plan,
    weeks,
    state,
    weekIndex,
    today: todaySession,
    todayDone: todaySession ? (done[todaySession.key] ?? null) : null,
    missed,
    plannedThisWeek: thisWeek.length,
    doneThisWeek: thisWeek.filter((s) => isDone(done, s)).length,
    plannedSoFar: upTo.length,
    doneSoFar: upTo.filter((s) => isDone(done, s)).length,
    upcoming: counted.filter((s) => daysBetween(s.day, today) >= 0 && !done[s.key]),
  };
}

export type SessionStatus = 'done' | 'skipped' | 'today' | 'missed' | 'upcoming' | 'beforeStart';

/** Where one session stands on `today`. */
export function sessionStatus(session: PlannedSession, rawDone: Record<string, DoneEntry>, today: string): SessionStatus {
  if (session.beforeStart) return 'beforeStart';
  const entry = liveDone(rawDone)[session.key];
  if (entry) return entry.skipped ? 'skipped' : 'done';
  const offset = daysBetween(session.day, today);
  return offset === 0 ? 'today' : offset > 0 ? 'missed' : 'upcoming';
}

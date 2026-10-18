import { liveDone, type CoachPlan, type DoneEntry, type WeekAdjust } from '../doc';
import { allSessions, generatePlan, weekIndexAt } from './generate';
import type { ReadinessWord } from '../suggest';
import type { TrainingStatus } from '@/features/fitness/trainingLoad';

/**
 * Weekly adaptation. On the first look at a new week the plan decides how much of that week's planned volume to keep
 * (`WeekAdjust.scalePct`), from last week's sessions and from the state of the body now. The first matching rule wins:
 *
 *  1. Training status overreaching (load ratio over 1.5): 75 %, reason `overreaching`.
 *  2. Fewer than half of last week's sessions done: 80 %, reason `missed` (no ramp after a lost week).
 *  3. Low recovery now: HRV status low, or readiness Run down, or Strained with 3 h or more of sleep debt: 85 %, `low_recovery`.
 *  4. Every session done and the load productive or maintaining: 10 points back toward 100 %, `strong`.
 *  5. Otherwise: not lower than 90 % and not higher than 100 %, `steady`.
 *
 * Weeks that passed while the app was closed are decided from their completion alone (rules 2, 4 and 5); only the
 * current week also reads the body's signals. The decision is stored in the plan, so every phone shows the same volume.
 */

export interface AdaptSignals {
  load: { status: TrainingStatus; ratio: number } | null;
  hrv: 'balanced' | 'unbalanced' | 'low' | null;
  readiness: ReadinessWord | null;
  sleepDebtMin: number | null;
}

export const NO_SIGNALS: AdaptSignals = { load: null, hrv: null, readiness: null, sleepDebtMin: null };

export interface WeekResult {
  planned: number;
  done: number;
}

export function adaptWeek(prev: WeekResult, prevScalePct: number, signals: AdaptSignals): Omit<WeekAdjust, 'at'> {
  if (signals.load?.status === 'overreaching') return { scalePct: 75, reason: 'overreaching' };
  if (prev.planned >= 2 && prev.done / prev.planned < 0.5) return { scalePct: 80, reason: 'missed' };
  const lowRecovery =
    signals.hrv === 'low' ||
    signals.readiness === 'Run down' ||
    (signals.readiness === 'Strained' && (signals.sleepDebtMin ?? 0) >= 180);
  if (lowRecovery) return { scalePct: 85, reason: 'low_recovery' };
  const load = signals.load?.status;
  if (prev.planned > 0 && prev.done >= prev.planned && (load === 'productive' || load === 'maintaining')) {
    return { scalePct: Math.min(100, prevScalePct + 10), reason: 'strong' };
  }
  return { scalePct: Math.min(100, Math.max(90, prevScalePct)), reason: 'steady' };
}

/** What last week held: the sessions that counted (after the plan was made) and how many were really done. */
export function weekResult(plan: CoachPlan, done: Record<string, DoneEntry>, week: number): WeekResult {
  const sessions = (generatePlan(plan)[week]?.sessions ?? []).filter((s) => !s.beforeStart);
  const live = liveDone(done);
  return { planned: sessions.length, done: sessions.filter((s) => live[s.key] && !live[s.key]!.skipped).length };
}

/**
 * Decides every week up to the one that contains `today` that has no decision yet. Returns the new `adjust` map, or null
 * when nothing was added. Week 0 is never adapted (no history).
 */
export function decideWeeks(plan: CoachPlan, done: Record<string, DoneEntry>, today: string, signals: AdaptSignals, nowMs: number): Record<string, WeekAdjust> | null {
  const current = Math.min(plan.weeks - 1, weekIndexAt(plan, today));
  if (current < 1) return null;
  const adjust = { ...plan.adjust };
  let added = false;
  // Decisions of earlier weeks change the sessions of later weeks, so weekResult must see the plan as adapted so far.
  let working: CoachPlan = { ...plan, adjust };
  for (let week = 1; week <= current; week++) {
    if (adjust[String(week)]) continue;
    const prevScale = adjust[String(week - 1)]?.scalePct ?? 100;
    const decided = adaptWeek(weekResult(working, done, week - 1), prevScale, week === current ? signals : NO_SIGNALS);
    adjust[String(week)] = { ...decided, at: nowMs };
    working = { ...plan, adjust: { ...adjust } };
    added = true;
  }
  return added ? adjust : null;
}

/** The sessions of the plan in date order, for callers that only need the list. */
export function sessionsOf(plan: CoachPlan) {
  return allSessions(generatePlan(plan));
}

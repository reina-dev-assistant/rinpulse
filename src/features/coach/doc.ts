/**
 * The coach's synced state: one JSON document per account (`CoachDoc`), stored on the phone in `coach_doc` and in
 * JoyoRogo's D1 (`coach_doc`, Pro writes) with an optimistic revision, exactly like the gear document. The plan itself is
 * never stored: it is generated from the parameters below by `plans/generate.ts`, so two phones with the same parameters
 * show the same sessions. What is stored is the person's choices and what happened.
 *
 * The JoyoRogo server validates this shape (`packages/api/src/lib/coach-doc.ts` there); change both together.
 */

export type PlanKind = 'run' | 'strength';
export type RunGoal = 'run5k' | 'run10k' | 'runHalf' | 'runRoutine';
export type PlanGoal = RunGoal | 'strengthFull';
export type PlanLevel = 'beginner' | 'intermediate' | 'advanced';
export type StrengthSetting = 'home' | 'gym';

export interface CoachPlan {
  /** `p<ms>`; part of every session key, so a new plan never inherits the old one's progress. */
  id: string;
  kind: PlanKind;
  goal: PlanGoal;
  level: PlanLevel;
  /** Sessions per week: 2 or 3 for strength, 3 to 5 for running. */
  daysPerWeek: number;
  /** Strength only. */
  setting: StrengthSetting | null;
  /** Preferred weekdays, 0 = Monday .. 6 = Sunday, ascending, `daysPerWeek` of them. */
  weekdays: number[];
  /** Local date `YYYY-MM-DD` of the Monday of week 1. */
  startDay: string;
  weeks: number;
  createdAt: number;
  updatedAt: number;
  /** Weekly adaptation, by week index (0-based): the share of the planned volume kept and why (see `plans/adapt.ts`). */
  adjust: Record<string, WeekAdjust>;
}

export type AdjustReason = 'low_recovery' | 'missed' | 'overreaching' | 'strong' | 'steady';

export interface WeekAdjust {
  /** Percent of the planned minutes/sets kept: 100 = as planned. */
  scalePct: number;
  reason: AdjustReason;
  /** When the adaptation was decided, ms. */
  at: number;
}

/** A session of the plan that is finished or skipped. Key: `<planId>:<week>:<slot>` (week 0-based, slot 0-based). */
export interface DoneEntry {
  /** The matched watch workout (`workouts.start`, unix seconds), null when ticked by hand or skipped. */
  workoutStart: number | null;
  /** When it was marked, ms. */
  at: number;
  /** Marked by hand rather than matched from a watch workout. */
  manual: boolean;
  skipped: boolean;
  /** The mark was taken back. Kept (not deleted) so the undo wins over the copy on another phone; read as "not done". */
  cleared?: boolean;
}

export interface LoggedSet {
  reps: number;
  /** Seconds for a timed exercise (reps is then 0). */
  seconds: number | null;
  weightKg: number | null;
}

export interface LoggedExercise {
  exerciseId: string;
  sets: LoggedSet[];
}

/** Reps logged by hand while doing a strength session (the watch does not report them). Same key as `DoneEntry`. */
export interface StrengthLog {
  at: number;
  exercises: LoggedExercise[];
}

export interface CoachDoc {
  version: 1;
  /** The active plan; null when none or when it was ended. */
  plan: CoachPlan | null;
  /** When `plan` last changed (ms), also for an end (`plan: null`): the newer value wins in a merge. */
  planUpdatedAt: number;
  done: Record<string, DoneEntry>;
  logs: Record<string, StrengthLog>;
}

export const EMPTY_COACH_DOC: CoachDoc = { version: 1, plan: null, planUpdatedAt: 0, done: {}, logs: {} };

export const sessionKey = (planId: string, week: number, slot: number): string => `${planId}:${week}:${slot}`;

/** The entries that count: a cleared one is a taken-back mark. */
export function liveDone(done: Record<string, DoneEntry>): Record<string, DoneEntry> {
  return Object.fromEntries(Object.entries(done).filter(([, entry]) => !entry.cleared));
}

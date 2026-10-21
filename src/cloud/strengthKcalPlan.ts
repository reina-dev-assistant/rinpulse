import { isImported } from '@/features/strength/link';
import { rogoDay } from './rogoZone';
import type { StrengthWorkout } from '@/features/strength/types';

/**
 * What JoyoRogo's diary should hold for a strength workout, and what to do to get there. Pure; `strengthKcal.ts` runs it.
 * One `exercise_log` row per workout (source `joyofit`, external id `strength:<workout id>`), only for workouts whose energy is
 * JoyoFit's own figure (`estimate`: MET, `hr`: from a heart rate strap) on the logger's own `workouts` row. A workout merged with a
 * watch workout reaches JoyoRogo through Health Connect / Apple Health like every watch workout; pushing it as well would count it twice.
 */

/** `exercise.upsertJoyofit` limits (packages/api lib/exercise-edit.ts). */
export const MAX_KCAL = 10_000;
export const MIN_DURATION_MIN = 1;
export const MAX_DURATION_MIN = 1440;
export const MAX_EXTERNAL_ID = 100;
/** `exercise.upsertJoyofit` name limit; the workout's own name is cut to leave room for the prefix. */
export const MAX_NAME = 200;

export interface KcalPayload {
  externalId: string;
  /** JoyoRogo day (its profile zone), `YYYY-MM-DD`. */
  date: string;
  name: string;
  durationMin: number;
  kcal: number;
}

/** A row of `strength_kcal_sent`: what JoyoRogo was last told for a workout. */
export interface KcalSentRow {
  workoutId: string;
  externalId: string;
  date: string;
  kcal: number;
  sentAt: number;
}

export type KcalAction = { type: 'none' } | { type: 'send'; payload: KcalPayload } | { type: 'remove'; externalId: string };

export const externalIdFor = (workoutId: string): string => `strength:${workoutId}`.slice(0, MAX_EXTERNAL_ID);

/**
 * The row JoyoRogo should have, or null when it should have none. `ownRow` says the workout's `workouts` row is the logger's
 * own (`imported = 1`); `label` is the localized diary name (`Strength: Push`).
 */
export function desiredKcal(workout: StrengthWorkout, ownRow: boolean, label: (name: string) => string): KcalPayload | null {
  if (workout.deletedAt !== null || isImported(workout)) return null;
  if ((workout.kcalSource !== 'estimate' && workout.kcalSource !== 'hr') || !ownRow || workout.kcal === null) return null;
  const kcal = Math.min(MAX_KCAL, Math.round(workout.kcal));
  if (!(kcal > 0)) return null;
  return {
    externalId: externalIdFor(workout.id),
    date: rogoDay(workout.startedAt),
    name: label(workout.name.trim()).slice(0, MAX_NAME),
    durationMin: Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, Math.round(workout.durationSec / 60))),
    kcal,
  };
}

/** Send when nothing was sent or the energy or day changed, remove when something was sent that should not stand any more. */
export function planKcal(desired: KcalPayload | null, sent: KcalSentRow | null): KcalAction {
  if (desired === null) return sent === null ? { type: 'none' } : { type: 'remove', externalId: sent.externalId };
  if (sent === null || sent.date !== desired.date || sent.kcal !== desired.kcal || sent.externalId !== desired.externalId) {
    return { type: 'send', payload: desired };
  }
  return { type: 'none' };
}

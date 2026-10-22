/**
 * The daily step goal as the app holds it: whole steps, 1000 to 100000 (the range the watch accepts: `WearRuntime` and
 * `ActivityGoalsCodec` reject the rest). Pure, so the forms, the Today ring and the sync agree on one number. Unit tested with `bun test`.
 */

/** Goal shown before a profile has been saved; the same default the profile form starts from. */
export const DEFAULT_STEP_GOAL = 8000;
export const MIN_STEP_GOAL = 1000;
export const MAX_STEP_GOAL = 100_000;

/** "10000", "10.000" and "10,000" (a keyboard or a paste may bring the separator), nothing else. */
const GROUPED = /^\d{1,3}([.,\u00a0\u202f ]\d{3})+$/;
const PLAIN = /^\d+$/;

/** The goal typed into a form, or null when it is not a whole number of steps in range. "1e4", "0x10", "-5", "12.5" and "" are not. */
export function parseStepGoal(text: string): number | null {
  const trimmed = text.trim();
  if (!PLAIN.test(trimmed) && !GROUPED.test(trimmed)) return null;
  const value = Number(trimmed.replace(/\D/g, ''));
  return Number.isSafeInteger(value) && value >= MIN_STEP_GOAL && value <= MAX_STEP_GOAL ? value : null;
}

export interface StepGoal {
  goal: number;
  /** No profile has been saved, so `goal` is the default and not something the person set. */
  isDefault: boolean;
}

/**
 * The goal to draw from what the saved profile holds. Nothing, zero, a negative or a number that is not one is the default (a ring
 * against a goal of 0 or NaN is not a ring); a goal above the watch's maximum, left by an older version, is held to it.
 */
export function stepGoalOf(saved: number | undefined | null): StepGoal {
  if (typeof saved !== 'number' || !Number.isFinite(saved) || saved <= 0) return { goal: DEFAULT_STEP_GOAL, isDefault: true };
  return { goal: Math.min(MAX_STEP_GOAL, Math.round(saved)), isDefault: false };
}

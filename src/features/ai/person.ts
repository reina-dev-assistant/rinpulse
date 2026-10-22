/**
 * Who the chat is talking to, as far as the phone and the JoyoRogo profile say. Everything is optional: unknown is null, never a guess.
 * Pregnancy and breastfeeding mode (a JoyoRogo profile field) is deliberately NOT here: the owner's rule is that it is never read for
 * the AI and never sent to a provider. Only what the person types in the chat can switch the conservative prompt block on.
 */

export interface Person {
  ageYears: number | null;
  sex: 'm' | 'f' | null;
  heightCm: number | null;
  goal: 'lose' | 'maintain' | 'gain' | null;
  weightGoalKg: number | null;
  weightGoalDate: string | null;
  eatKcal: number | null;
}

/** BYOK is for adults: provider terms set their own age limits and the minor prompt block is a backstop, not a substitute. */
export const MIN_ADULT_AGE = 18;

export const EMPTY_PERSON: Person = {
  ageYears: null,
  sex: null,
  heightCm: null,
  goal: null,
  weightGoalKg: null,
  weightGoalDate: null,
  eatKcal: null,
};

/** Age from a birth year the way JoyoRogo counts it (this year minus the birth year); null for a missing or implausible year. */
export function ageFromBirthYear(birthYear: number | null | undefined, nowYear: number): number | null {
  if (typeof birthYear !== 'number' || !Number.isFinite(birthYear) || birthYear < 1900 || birthYear > nowYear) return null;
  return nowYear - birthYear;
}

/** The lowest age any source gives: one source saying under 18 is enough to keep BYOK off. */
export function lowestAge(...ages: (number | null)[]): number | null {
  const known = ages.filter((a): a is number => a !== null);
  return known.length === 0 ? null : Math.min(...known);
}

/** The kv-store entry that caches the last JoyoRogo profile read (birth year, goal, targets) so the age gate works offline. */
export const PERSON_CACHE_KEY = 'joyofit.ai.person';

/** A cached JoyoRogo profile younger than this is used without asking the server, so a slow or missing connection never delays a question. */
export const PROFILE_FRESH_SEC = 12 * 3600;
/** How long a refresh may take before the cached profile is used instead. */
export const PROFILE_REFRESH_MS = 5_000;

export const profileIsFresh = (at: number, nowSec: number): boolean => at <= nowSec && nowSec - at < PROFILE_FRESH_SEC;

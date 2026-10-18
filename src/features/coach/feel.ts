import type { ReadinessWord } from './suggest';

/**
 * "How do you feel today": the readiness a person can give Coach by hand. A watch measures readiness (HRV, resting heart rate, sleep);
 * with no watch, or one that has not produced a night yet, this answer stands in for it, so the daily suggestion still reacts to a
 * tired body. It is kept for one calendar day on the phone and never synced.
 */
export const FEELS = ['great', 'good', 'tired', 'wrecked'] as const;
export type Feel = (typeof FEELS)[number];

/** The readiness word a feeling counts as. The suggestion treats it like the watch's word (see the table in `suggest.ts`). */
export function feelReadiness(feel: Feel): ReadinessWord {
  switch (feel) {
    case 'great':
      return 'Primed';
    case 'good':
      return 'Balanced';
    case 'tired':
      return 'Strained';
    case 'wrecked':
      return 'Run down';
  }
}

export function serializeFeel(day: string, feel: Feel): string {
  return JSON.stringify({ day, feel });
}

/** The stored answer when it was given on `day`; yesterday's answer, a corrupt record or nothing is null. */
export function parseFeel(raw: string | null, day: string): Feel | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { day?: unknown; feel?: unknown } | null;
    if (!value || value.day !== day) return null;
    return FEELS.includes(value.feel as Feel) ? (value.feel as Feel) : null;
  } catch {
    return null;
  }
}

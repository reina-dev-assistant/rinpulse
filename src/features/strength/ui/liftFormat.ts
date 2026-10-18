/**
 * Text for lift numbers on the history, exercise and heat-map screens: kg, volume, a set as `60 × 8`, seconds. Functions, not constants,
 * so they follow the language at the moment they are called.
 */
import { roundKg } from '@/features/strength/calc';
import { fmtInt, fmtNumber, t } from '@/i18n';

/** `62,5` / `62.5`, whole kg from 100 up (`roundKg`), no trailing zero. */
export const kgNumber = (kg: number): string => fmtNumber(roundKg(kg), 1);

/** `62,5 kg`. */
export const kgText = (kg: number): string => t('lifts:unit.kg', { value: kgNumber(kg) });

/** Volume in whole kg with separators: `12.450 kg`. */
export const volumeText = (kg: number): string => t('lifts:unit.kg', { value: fmtInt(kg) });

/** `45 s` under a minute, `1:05` from a minute up (seconds in). */
export function secondsText(seconds: number): string {
  if (seconds < 60) return t('lifts:unit.sec', { value: fmtInt(seconds) });
  const total = Math.round(seconds);
  return `${fmtInt(Math.floor(total / 60))}:${String(total % 60).padStart(2, '0')}`;
}

/** A set as it is read in a gym: `60 × 8`, `8 reps` (bodyweight), `60 kg`, `45 s`; null for an empty set. */
export function setText(set: { weightKg: number | null; reps: number | null; seconds: number | null }): string | null {
  if (set.seconds !== null && set.seconds > 0) {
    return set.weightKg !== null && set.weightKg > 0
      ? t('lifts:set.weightSeconds', { weight: kgNumber(set.weightKg), time: secondsText(set.seconds) })
      : secondsText(set.seconds);
  }
  if (set.reps !== null && set.reps > 0) {
    return set.weightKg !== null && set.weightKg > 0
      ? t('lifts:set.weightReps', { weight: kgNumber(set.weightKg), reps: fmtInt(set.reps) })
      : t('lifts:set.reps', { count: set.reps, value: fmtInt(set.reps) });
  }
  return set.weightKg !== null && set.weightKg > 0 ? kgText(set.weightKg) : null;
}

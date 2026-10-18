/**
 * Small pure helpers of the logger screens: number entry, labels of the "previous" column, rest choices, the default workout name.
 * No React and no database, so they are tested once (`logFormat.test.ts`).
 */
import { fmtInt, fmtNumber, getLocale, t } from '@/i18n';

import { roundKg } from './calc';
import { clampRest, MAX_REST_SEC, MIN_REST_SEC } from './draft';
import type { PrKind } from './calc';
import type { SetType, StrengthDraft, StrengthExercise, StrengthSet } from './types';

export const MAX_WEIGHT_KG = 1000;
export const MAX_REPS = 999;
export const MAX_SECONDS = 4 * 3600;

/** Parses what the person typed: "7,5" and "7.5" are both 7.5; empty, negative or not a number is null. */
export function parseNumber(text: string): number | null {
  const clean = text.trim().replace(/\s/g, '').replace(',', '.');
  if (clean === '' || clean === '.') return null;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Seconds from "90" or "1:30" (minutes:seconds); null when it is neither. */
export function parseSeconds(text: string): number | null {
  const clean = text.trim();
  if (!clean.includes(':')) return parseNumber(clean);
  const [m, s, ...rest] = clean.split(':');
  const minutes = parseNumber(m ?? '');
  const seconds = s === undefined || s === '' ? 0 : parseNumber(s);
  return rest.length > 0 || minutes === null || seconds === null ? null : minutes * 60 + seconds;
}

/** A weight as the field shows it: up to two decimals, the language's decimal separator, no grouping. */
export function inputText(n: number | null, separator: string = getLocale() === 'id' ? ',' : '.'): string {
  if (n === null) return '';
  return String(Math.round(n * 100) / 100).replace('.', separator);
}

export const clampWeight = (n: number | null): number | null => (n === null ? null : Math.min(MAX_WEIGHT_KG, Math.round(n * 100) / 100));
export const clampReps = (n: number | null): number | null => (n === null ? null : Math.min(MAX_REPS, Math.round(n)));
export const clampSeconds = (n: number | null): number | null => (n === null ? null : Math.min(MAX_SECONDS, Math.round(n)));

/** `m:ss`, or `h:mm:ss` from an hour on. Seconds in. */
export function timerText(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export function partOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/** "Morning workout" and so on, from the local time of `nowMs`. */
export function defaultWorkoutName(nowMs: number): string {
  switch (partOfDay(new Date(nowMs).getHours())) {
    case 'morning':
      return t('strength:defaultName.morning');
    case 'afternoon':
      return t('strength:defaultName.afternoon');
    case 'evening':
      return t('strength:defaultName.evening');
    default:
      return t('strength:defaultName.night');
  }
}

export const weightText = (kg: number): string => t('strength:unit.kg', { value: fmtNumber(roundKg(kg), 1) });

export const secondsText = (sec: number): string => t('strength:unit.sec', { value: fmtInt(sec) });

/** What an earlier set was: "60 kg x 8", "8" (bodyweight), "0:45" (timed), "60 kg x 0:45". Null for a set with nothing in it. */
export function previousLabel(set: Pick<StrengthSet, 'weightKg' | 'reps' | 'seconds'>, timed: boolean): string | null {
  const weight = set.weightKg !== null && set.weightKg > 0 ? set.weightKg : null;
  const amount = timed && set.seconds !== null ? timerText(set.seconds) : set.reps !== null ? fmtInt(set.reps) : set.seconds !== null ? timerText(set.seconds) : null;
  if (amount === null) return weight === null ? null : weightText(weight);
  return weight === null ? amount : t('strength:previous.weightBy', { weight: weightText(weight), amount });
}

export interface PreviousSet {
  type: string;
  weightKg: number | null;
  reps: number | null;
  seconds: number | null;
}

/** The previous set at the position of set `index` of the exercise being logged (what ticking an empty row copies), or null. */
export function previousAt(previous: readonly PreviousSet[] | null | undefined, index: number): PreviousSet | null {
  return previous?.[index] ?? null;
}

/** Superset groups get the letters A, B, ... in the order they first appear. */
export function supersetLetters(exercises: readonly Pick<StrengthExercise, 'supersetGroup'>[]): Map<number, string> {
  const letters = new Map<number, string>();
  for (const e of exercises) {
    if (e.supersetGroup !== null && !letters.has(e.supersetGroup)) letters.set(e.supersetGroup, String.fromCharCode(65 + (letters.size % 26)));
  }
  return letters;
}

/** Rest choices of the exercise menu in seconds; 0 is "off". */
export const REST_CHOICES: readonly number[] = [0, 30, 45, 60, 90, 120, 180, 300];

export const restLabel = (sec: number): string => (sec <= 0 ? t('strength:rest.off') : sec < 60 ? secondsText(sec) : timerText(sec));

/** `setExerciseRest` of `draft.ts` clamps to the timer's range; this one also accepts 0 (no rest timer for this exercise). */
export function setExerciseRestOrOff(draft: StrengthDraft, key: string, restSec: number | null): StrengthDraft {
  const value = restSec === null ? null : restSec <= 0 ? 0 : clampRest(restSec);
  return { ...draft, exercises: draft.exercises.map((e) => (e.key === key ? { ...e, restSec: value } : e)) };
}

/** A custom rest the person typed, in seconds inside the timer's range; null when it is not a positive number. */
export function clampRestChoice(sec: number): number | null {
  return Number.isFinite(sec) && sec > 0 ? clampRest(sec) : null;
}

/** Moves the default rest by one step of 15 s inside 30 s to 5 min. */
export function stepRest(current: number, direction: 1 | -1): number {
  return Math.min(300, Math.max(30, Math.round(current / 15) * 15 + direction * 15));
}

export { MAX_REST_SEC, MIN_REST_SEC };

/** RPE choices 6, 6.5, ... 10. */
export const RPE_CHOICES: readonly number[] = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

export const rpeText = (rpe: number): string => fmtNumber(rpe, 1);

/** A record's value: kg, reps or mm:ss. */
export function prValueText(kind: PrKind, value: number): string {
  if (kind === 'reps') return t('strength:unit.reps', { count: Math.round(value), value: fmtInt(value) });
  if (kind === 'time') return timerText(value);
  return weightText(value);
}

/** Badge letter of a set type, or null for a normal one. */
export const SET_BADGE: Record<SetType, string | null> = { normal: null, warmup: 'W', drop: 'D', failure: 'F' };

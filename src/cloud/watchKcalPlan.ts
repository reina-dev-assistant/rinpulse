import { wibDay } from '@/features/strength/calc';

import { MAX_DURATION_MIN, MAX_EXTERNAL_ID, MAX_KCAL, MAX_NAME, MIN_DURATION_MIN } from './strengthKcalPlan';

/**
 * What JoyoRogo's diary should hold for a workout the watch recorded: one `exercise_log` row per workout through
 * `exercise.upsertJoyofit` (source `joyofit`), external id `watch:<start>`. The same workout also reaches JoyoRogo through Health
 * Connect / Apple Health when JoyoRogo may read it; JoyoRogo's server stores the two as one (`import-dedupe.ts`, both ways), so
 * sending it here as well never counts it twice, and the diary no longer depends on JoyoRogo's access to the health store.
 * Pure; `watchKcal.ts` runs it.
 */

/** JoyoRogo's activity type keys (packages/api lib/met.ts) by the watch's sport type; an unknown sport is `latihan`, a neutral key. */
const TYPE_BY_SPORT: Readonly<Record<number, string>> = {
  1: 'lari',
  11: 'lari',
  5: 'lari', // Treadmill run
  2: 'jalan_cepat',
  13: 'jalan_cepat',
  4: 'jalan_cepat', // Hike
  14: 'jalan_cepat',
  3: 'sepeda',
  213: 'sepeda',
  7: 'sepeda', // Indoor ride
  141: 'sepeda',
  6: 'berenang',
  8: 'berenang',
  137: 'yoga',
  140: 'angkat_beban',
  129: 'badminton',
  181: 'badminton',
  131: 'futsal',
  187: 'futsal',
};

/** Workouts of the last 30 days are looked at, like the other diary pushes: a long history on a new phone does not flood the diary. */
export const WATCH_KCAL_WINDOW_S = 30 * 86_400;
/** Requests per pass: a long backlog does not hold a sync up; the next pass continues. */
export const WATCH_KCAL_MAX_PER_PASS = 40;

/** A `workouts` row as the push reads it. Seconds for `start`, `end` (0 when unknown) and `duration`. */
export interface WatchWorkoutRow {
  start: number;
  end: number;
  duration: number;
  calories: number;
  sportType: number;
  sportName: string;
  imported: number;
  complete: number;
  /** `cloud_workout.hash` of the row, null when the workout has no cloud row. */
  cloudHash: string | null;
}

export interface WatchKcalPayload {
  externalId: string;
  /** WIB day, `YYYY-MM-DD`. */
  date: string;
  name: string;
  durationMin: number;
  kcal: number;
  type: string;
}

/** What was last sent for a workout, and to which JoyoRogo account. */
export interface WatchKcalSent {
  accountId: string;
  externalId: string;
  date: string;
  kcal: number;
}

export const externalIdForWatch = (start: number): string => `watch:${start}`.slice(0, MAX_EXTERNAL_ID);

/**
 * Whether a stored workout belongs in the diary: recorded by the watch (`imported = 0`: imports, FIT files and phone recordings
 * have their own ways or none), downloaded completely, recent enough, and not kept apart from the signed-in account
 * (`hash = 'detached'`: "Simpan terpisah" marked it as never to be sent to the account that signed in afterwards).
 */
export function watchKcalEligible(row: WatchWorkoutRow, detachedHash: string, nowSec: number): boolean {
  return row.imported === 0 && row.complete !== 0 && row.start >= nowSec - WATCH_KCAL_WINDOW_S && row.cloudHash !== detachedHash;
}

/** The diary row of an eligible workout; null without energy (the watch reported none). `name` is the localized sport name. */
export function watchKcalPayload(row: WatchWorkoutRow, name: string): WatchKcalPayload | null {
  const kcal = Math.min(MAX_KCAL, Math.round(row.calories));
  if (!(kcal > 0)) return null;
  // The session Health Connect gets is start..end, so the length matches the import JoyoRogo pairs this row with.
  const seconds = row.end > row.start ? row.end - row.start : row.duration;
  return {
    externalId: externalIdForWatch(row.start),
    date: wibDay(row.start * 1000),
    name: name.slice(0, MAX_NAME),
    durationMin: Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, Math.round(seconds / 60))),
    kcal,
    type: TYPE_BY_SPORT[row.sportType] ?? 'latihan',
  };
}

/** Send when nothing was sent to this account, or the energy, day or id changed. */
export function needsWatchKcalSend(desired: WatchKcalPayload, sent: WatchKcalSent | null, accountId: string): boolean {
  return (
    sent === null ||
    sent.accountId !== accountId ||
    sent.kcal !== desired.kcal ||
    sent.date !== desired.date ||
    sent.externalId !== desired.externalId
  );
}

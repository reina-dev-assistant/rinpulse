import { rogoDay } from './rogoZone';

import { MAX_DURATION_MIN, MAX_EXTERNAL_ID, MAX_KCAL, MAX_NAME, MIN_DURATION_MIN } from './strengthKcalPlan';

/**
 * What JoyoRogo's diary should hold for a workout the phone recorded (`source: 'phone'` in its summary): one `exercise_log` row per
 * workout through the same procedure the strength logger uses (`exercise.upsertJoyofit`, source `joyofit`), external id
 * `phone:<start>`. These workouts are `imported = 1` rows, so the native Health Connect / Apple Health export never sends them: this
 * is the only way their energy reaches the diary, nothing is counted twice. Pure; `phoneKcal.ts` runs it.
 */

/** JoyoRogo's activity type keys (packages/api lib/met.ts); an unknown key shows with a flame icon and the workout's name. */
const TYPE_BY_SPORT: Readonly<Record<number, string>> = {
  1: 'lari', // Run
  2: 'jalan_cepat', // Walk
  3: 'sepeda', // Ride
  5: 'lari', // Treadmill run
  7: 'sepeda', // Indoor ride
  14: 'jalan_cepat', // Hike
};

export interface PhoneKcalWorkout {
  start: number;
  /** Seconds. */
  duration: number;
  calories: number;
  sportType: number;
  /** Localized name for the diary. */
  name: string;
}

export interface PhoneKcalPayload {
  externalId: string;
  date: string;
  name: string;
  durationMin: number;
  kcal: number;
  type: string;
}

export const externalIdForPhone = (start: number): string => `phone:${start}`.slice(0, MAX_EXTERNAL_ID);

export function phoneKcalPayload(w: PhoneKcalWorkout): PhoneKcalPayload | null {
  const kcal = Math.min(MAX_KCAL, Math.round(w.calories));
  if (!(kcal > 0)) return null;
  return {
    externalId: externalIdForPhone(w.start),
    date: rogoDay(w.start * 1000),
    name: w.name.slice(0, MAX_NAME),
    durationMin: Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, Math.round(w.duration / 60))),
    kcal,
    type: TYPE_BY_SPORT[w.sportType] ?? 'latihan',
  };
}

/** What was last sent for a workout. */
export interface PhoneKcalSent {
  externalId: string;
  date: string;
  kcal: number;
}

/** Send when nothing was sent or the energy or day changed. */
export function needsPhoneKcalSend(desired: PhoneKcalPayload, sent: PhoneKcalSent | null): boolean {
  return sent === null || sent.kcal !== desired.kcal || sent.date !== desired.date || sent.externalId !== desired.externalId;
}

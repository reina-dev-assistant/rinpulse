/**
 * A workout typed in by hand: the cardio of someone with no watch (a run or a ride the phone did not record). It lands in the same
 * `workouts` table as watch and FIT rows (`imported = 1`, so the watch-only exports and the automatic Strava upload leave it alone),
 * with no heart rate and no route. Energy is an estimate: MET x body weight x hours, unless the person typed their own figure.
 */
import { SPORT } from '@/features/fitimport/parseFit';

export const MANUAL_SPORTS = ['run', 'walk', 'ride', 'hike', 'treadmill', 'indoorRide', 'other'] as const;
export type ManualSport = (typeof MANUAL_SPORTS)[number];

interface SportRow {
  /** Huawei sport type byte, as in `workouts.sport_type`. */
  type: number;
  /** Gadgetbridge `ActivityKind`, as watch rows carry in `summary_json.kind`. */
  kind: string;
  /** The English name the database keeps (it drives the sport kind and the translated label). */
  name: string;
  /** Compendium of Physical Activities, moderate effort. */
  met: number;
  /** Pace (min/km) is the natural figure. */
  foot: boolean;
}

export const SPORT_ROWS: Readonly<Record<ManualSport, SportRow>> = {
  run: { type: SPORT.running, kind: 'RUNNING', name: 'Run', met: 9.8, foot: true },
  walk: { type: SPORT.walking, kind: 'WALKING', name: 'Walk', met: 3.8, foot: true },
  ride: { type: SPORT.cycling, kind: 'CYCLING', name: 'Ride', met: 7.5, foot: false },
  hike: { type: SPORT.hiking, kind: 'HIKING', name: 'Hike', met: 6, foot: true },
  treadmill: { type: SPORT.indoorRunning, kind: 'INDOOR_RUNNING', name: 'Treadmill run', met: 9, foot: true },
  indoorRide: { type: SPORT.indoorCycling, kind: 'INDOOR_CYCLING', name: 'Indoor ride', met: 6.8, foot: false },
  other: { type: SPORT.other, kind: 'EXERCISE', name: 'Workout', met: 5, foot: false },
};

export const MAX_MINUTES = 24 * 60;
export const MAX_KM = 500;
export const MAX_KCAL = 10_000;

export interface ManualInput {
  sport: ManualSport;
  /** Unix seconds. */
  start: number;
  minutes: number;
  km: number | null;
  /** The person's own figure; null estimates it. */
  kcal: number | null;
  weightKg: number;
}

export interface ManualRow {
  start: number;
  end: number;
  type: number;
  name: string;
  /** Seconds. */
  duration: number;
  /** Metres. */
  distance: number;
  calories: number;
  summary: string;
}

/** MET x kg x hours, rounded. */
export function estimateManualKcal(sport: ManualSport, minutes: number, weightKg: number): number {
  return Math.round((SPORT_ROWS[sport].met * weightKg * minutes) / 60);
}

/** The `workouts` row for `input`. */
export function manualRow(input: ManualInput): ManualRow {
  const row = SPORT_ROWS[input.sport];
  const duration = Math.round(input.minutes * 60);
  const meters = input.km === null ? 0 : Math.round(input.km * 1000);
  const speed = meters > 0 ? meters / duration : undefined;
  const summary: Record<string, unknown> = {
    kind: row.kind,
    gps: 'none',
    gpsPoints: 0,
    manual: true,
    avgSpeed: speed,
    avgPaceSecPerKm: row.foot && speed ? 1000 / speed : undefined,
  };
  return {
    start: input.start,
    end: input.start + duration,
    type: row.type,
    name: row.name,
    duration,
    distance: meters,
    calories: input.kcal ?? estimateManualKcal(input.sport, input.minutes, input.weightKg),
    summary: JSON.stringify(summary),
  };
}

function positive(text: string, max: number): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return Number.isFinite(value) && value > 0 && value <= max ? value : null;
}

/** Whole minutes from a text field; null when it is not 1 to 1440. */
export function parseMinutes(text: string): number | null {
  const value = positive(text, MAX_MINUTES);
  return value === null ? null : Math.round(value);
}

/** Kilometres (comma or dot); an empty field is "no distance" (null with `ok`), anything else must be 0.01 to 500. */
export function parseKm(text: string): { ok: true; km: number | null } | { ok: false } {
  if (text.trim() === '') return { ok: true, km: null };
  const value = positive(text, MAX_KM);
  return value === null ? { ok: false } : { ok: true, km: Math.round(value * 100) / 100 };
}

/** Whole kilocalories; an empty field is "estimate it" (null with `ok`). */
export function parseKcal(text: string): { ok: true; kcal: number | null } | { ok: false } {
  if (text.trim() === '') return { ok: true, kcal: null };
  const value = positive(text, MAX_KCAL);
  return value === null ? { ok: false } : { ok: true, kcal: Math.round(value) };
}

/** `7:05`, `07.05` or `0705`: hours 0 to 23, minutes 0 to 59. */
export function parseClock(text: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/** The start (unix seconds) of a workout that began at `clock` on the day `daysAgo` before `now`, in the phone's time zone. */
export function startAt(now: Date, daysAgo: number, clock: { hour: number; minute: number }): number {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, clock.hour, clock.minute, 0, 0);
  return Math.floor(day.getTime() / 1000);
}

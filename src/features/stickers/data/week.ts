import type { WorkoutRow } from '@/db/queries';
import type { StrengthWorkout } from '@/features/strength/types';
import { workoutTotals } from '@/features/strength/calc';
import type { JsonObject, StickerKind, StickerSubject } from '@/features/stickers/subject';
import { startOfLocalDay } from '@/features/today/stats';
import { workoutTimes } from '@/features/workouts/times';
import { fmtDay, fmtDistance, getT, type Locale } from '@/i18n';

export interface WeekSubjectInput {
  /** Unix seconds of the local Monday 00:00 of the week. */
  weekStartSec: number;
  /** Watch workouts of that week (a strength workout stored as its own row may be among them). */
  workouts: readonly WorkoutRow[];
  /** Strength workouts of that week. One merged with a watch row (or stored as its own row) counts once. */
  strength: readonly StrengthWorkout[];
  /** Strain 0..21 per day, Monday first (7 entries); null/NaN = no data for that day. */
  dayStrain: readonly (number | null | undefined)[];
  /** Steps per day, Monday first (7 entries). Optional. */
  steps?: readonly number[];
  /** Acute load and the chronic weekly load (same unit as the sum of weekly strain); both optional. */
  acute?: number;
  chronicWeekly?: number;
  /** Epoch ms of "now": gives `week.todayIndex` when it falls inside the week. Left out = never the current week. */
  nowMs?: number;
}

/** Ratio below this is "down", above {@link RATIO_HIGH} is "up", anything in between is "balanced" (both ends balanced). */
export const RATIO_LOW = 0.8;
export const RATIO_HIGH = 1.3;
const EPS = 1e-9;
const DAY_SEC = 86_400;
const STRAIN_MAX = 21;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const pos = (n: unknown): n is number => finite(n) && n > 0;
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Local weekday labels, Monday first, from the app's date formatter ("Sen".."Min" / "Mon".."Sun"). */
function dayLabels(locale: Locale): string[] {
  // 2024-01-01 is a Monday; fmtDay formats a calendar day in UTC so it never shifts.
  return Array.from({ length: 7 }, (_, i) => fmtDay(`2024-01-0${i + 1}`, 'dayShort', locale));
}

type LoadStatus = 'up' | 'balanced' | 'down';

function statusOf(ratio: number): LoadStatus {
  if (ratio < RATIO_LOW - EPS) return 'down';
  if (ratio > RATIO_HIGH + EPS) return 'up';
  return 'balanced';
}

interface Session {
  startSec: number;
  movingSec: number;
  kcal: number;
}

/**
 * The week of a person as a sticker subject. Returns `null` when there is nothing to draw: no session in the week and no
 * strain data. A week with sessions offers `week`; a week with strain data offers `load` (so a rest week with strain still
 * gives a load sticker, and a week with sessions but no strain gives no load).
 */
export function buildWeekSubject(input: WeekSubjectInput, locale: Locale): StickerSubject | null {
  const { weekStartSec } = input;
  if (!finite(weekStartSec)) return null;

  const end = new Date(weekStartSec * 1000);
  end.setDate(end.getDate() + 7);
  const weekEndMs = end.getTime();
  const startMs = weekStartSec * 1000;

  const dayOf = (sec: number): number => Math.round((startOfLocalDay(sec) - weekStartSec) / DAY_SEC);
  const inWeek = (sec: number): boolean => {
    if (!finite(sec)) return false;
    const i = dayOf(sec);
    return i >= 0 && i <= 6;
  };

  const sessions: Session[] = [];
  const watchStarts = new Set<number>();
  let distanceM = 0;
  let longestM = 0;
  for (const w of input.workouts) {
    if (!inWeek(w.start)) continue;
    watchStarts.add(w.start);
    const { movingSec } = workoutTimes(w);
    sessions.push({ startSec: w.start, movingSec: finite(movingSec) ? Math.max(0, movingSec) : 0, kcal: pos(w.calories) ? w.calories : 0 });
    if (pos(w.distance)) {
      distanceM += w.distance;
      longestM = Math.max(longestM, w.distance);
    }
  }

  let strengthSessions = 0;
  let volumeKg = 0;
  for (const s of input.strength) {
    if (s.deletedAt !== null && s.deletedAt !== undefined) continue;
    const startSec = s.startedAt / 1000;
    if (!inWeek(startSec)) continue;
    strengthSessions += 1;
    const volume = workoutTotals(s).volume;
    if (pos(volume)) volumeKg += volume;
    // Merged with (or stored as) a watch row: that row already carries the time and the kcal.
    if (s.workoutStart !== null && watchStarts.has(s.workoutStart)) continue;
    sessions.push({ startSec, movingSec: pos(s.durationSec) ? s.durationSec : 0, kcal: pos(s.kcal) ? s.kcal : 0 });
  }

  const strain = Array.from({ length: 7 }, (_, i) => {
    const v = input.dayStrain[i];
    return finite(v) ? Math.min(STRAIN_MAX, Math.max(0, v)) : null;
  });
  const hasStrain = strain.some((v) => v !== null);
  if (sessions.length === 0 && !hasStrain) return null;

  const t = getT(locale, 'stickerdata');
  const labels = dayLabels(locale);
  const kinds: StickerKind[] = [];
  const data: JsonObject = {};

  const dayStrain = strain.map((v) => round1(v ?? 0));

  if (sessions.length > 0) {
    kinds.push('week');
    const dayMin = new Array<number>(7).fill(0);
    const activeDays = new Set<number>();
    let movingSec = 0;
    let kcal = 0;
    for (const s of sessions) {
      const d = dayOf(s.startSec);
      activeDays.add(d);
      dayMin[d] = (dayMin[d] ?? 0) + s.movingSec / 60;
      movingSec += s.movingSec;
      kcal += s.kcal;
    }

    const week: JsonObject = {
      rangeStart: startMs,
      rangeEnd: weekEndMs - 1,
      workouts: sessions.length,
      activeDays: activeDays.size,
      dayLabels: labels,
    };
    // `workouts` counts a merged strength workout once: `sessions` already holds it as its watch row.
    if (distanceM > 0) week.distanceM = Math.round(distanceM);
    if (movingSec > 0) week.movingSec = Math.round(movingSec);
    if (kcal > 0) week.kcal = Math.round(kcal);
    if (dayMin.some((m) => m > 0)) week.dayMin = dayMin.map((m) => Math.round(m));
    if (hasStrain) week.dayStrain = dayStrain;
    if (longestM > 0) {
      week.longestM = Math.round(longestM);
      week.bestLabel = t('week.longest', { distance: fmtDistance(longestM, locale) });
    }
    if (strengthSessions > 0) week.strengthSessions = strengthSessions;
    if (volumeKg > 0) week.volumeKg = Math.round(volumeKg);
    data.week = week;
  }

  const stepDays = (input.steps ?? []).slice(0, 7).filter(pos);
  const stepTotal = stepDays.reduce((a, b) => a + b, 0);
  if (stepTotal > 0 && data.week) (data.week as JsonObject).steps = Math.round(stepTotal);

  if (hasStrain) {
    kinds.push('load');
    const load: JsonObject = {
      dayStrain,
      dayLabels: labels,
      sessions: data.week ? ((data.week as JsonObject).workouts as number) : sessions.length,
      totalStrain: round1(dayStrain.reduce((a, b) => a + b, 0)),
    };
    if (finite(input.acute) && input.acute >= 0) load.acute = round1(input.acute);
    if (pos(input.chronicWeekly)) {
      load.chronicWeekly = round1(input.chronicWeekly);
      if (finite(input.acute) && input.acute >= 0) {
        const ratio = input.acute / input.chronicWeekly;
        load.ratio = Math.round(ratio * 100) / 100;
        load.status = t(`load.status.${statusOf(ratio)}`);
      }
    }
    data.load = load;
  }

  if (data.week && finite(input.nowMs) && input.nowMs >= startMs && input.nowMs < weekEndMs) {
    (data.week as JsonObject).todayIndex = Math.min(6, Math.max(0, dayOf(input.nowMs / 1000)));
  }

  return {
    id: `week:${weekStartSec}`,
    kinds,
    heading: t(kinds[0] === 'week' ? 'week.heading' : 'load.heading'),
    caption: getT(locale, 'sharing')('share.caption'),
    date: startMs,
    data,
  };
}

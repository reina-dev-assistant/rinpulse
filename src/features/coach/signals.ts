import { buildNights } from '@/features/sleep/nights';
import { hrvStatus } from '@/features/fitness/hrvStatus';
import { recoveryLeft } from '@/features/fitness/recoveryTime';
import { recentNightsAsleep } from '@/features/fitness/sleepNeed';
import { loadBalance, type TrainingStatus } from '@/features/fitness/trainingLoad';
import type { FitnessData } from '@/features/fitness/useFitnessData';
import type { NightHrvAvailability } from '@/features/today/nightHrv';
import { readiness, sleepDebtSec } from '@/features/today/readiness';
import { recovery } from '@/features/today/recovery';
import { lastSleepSession } from '@/features/today/stats';
import { sportKind } from '@/features/workouts/analysis/sport';
import { isStrengthWorkout } from './match';
import type { ReadinessWord, SuggestionInput } from './suggest';

const DAY_SEC = 86400;
/** Last night's sleep is the latest night that ended within this long ago. */
const LAST_NIGHT_SEC = 36 * 3600;
/** A day with at least this strain counts as an active day. */
const ACTIVE_STRAIN = 8;
/** A workout today shorter than this does not make it a training day. */
const MIN_WORKOUT_SEC = 20 * 60;
const MAX_STREAK = 14;
const USUAL_SPORT_DAYS = 14;

/** The body signals the coach reads, as plain values. The same numbers feed the suggestion, the weekly adaptation and the chat snapshot. */
export interface CoachSignals {
  readiness: ReadinessWord | null;
  load: { status: TrainingStatus; ratio: number; acute: number; chronic: number } | null;
  hrv: { state: 'balanced' | 'unbalanced' | 'low'; recentMs: number; baselineMs: number } | null;
  lastNightMin: number | null;
  sleepDebtMin: number | null;
  strainYesterday: number | null;
  strainDayBefore: number | null;
  strainToday: number | null;
  /** Mean strain of the last 7 days before today, null with no day on record. */
  strain7: number | null;
  activeStreak: number;
  recoveryHoursLeft: number | null;
  restingHr: number | null;
  vo2max: number | null;
  trainedToday: { strain: number | null } | null;
  usualSport: SuggestionInput['usualSport'];
}

export function computeSignals(d: FitnessData, availability: NightHrvAvailability | null): CoachSignals {
  const { nowSec, dayStart } = d;
  const strainOf = (day: number): number | null => d.strain.find((s) => s.day === day)?.strain ?? null;

  const scored = readiness({
    dayStart,
    resting: d.resting,
    strain: d.strain,
    sleep: lastSleepSession(d.sleep),
    hrv: recovery(d.hrv, nowSec, availability),
    availability,
  });

  const load = loadBalance(d.strain, dayStart);
  const hrv = hrvStatus(d.hrv, nowSec);
  const nights = buildNights(d.sleep, []);
  const last = nights.find((n) => !n.nap && n.end <= nowSec && n.end >= nowSec - LAST_NIGHT_SEC) ?? null;
  const debt = sleepDebtSec(recentNightsAsleep(d.sleep, nowSec));

  let activeStreak = 0;
  for (let day = dayStart - DAY_SEC; activeStreak < MAX_STREAK; day -= DAY_SEC) {
    if ((strainOf(day) ?? 0) < ACTIVE_STRAIN) break;
    activeStreak += 1;
  }

  const week = d.strain.filter((s) => s.day < dayStart && s.day >= dayStart - 7 * DAY_SEC);
  const left = recoveryLeft({
    nowSec,
    dayStart,
    workouts: d.workouts.map(({ workout, summary }) => ({ end: workout.end, recoveryHours: summary.recoveryHours })),
    strain: d.strain,
  });
  const todays = d.workouts.find(({ workout }) => workout.start >= dayStart && workout.duration >= MIN_WORKOUT_SEC);
  const counts = { run: 0, walk: 0, ride: 0, strength: 0 };
  for (const { workout, summary } of d.workouts) {
    if (workout.start < nowSec - USUAL_SPORT_DAYS * DAY_SEC) continue;
    if (isStrengthWorkout(workout.sportName, summary.kind)) counts.strength += 1;
    else {
      const kind = sportKind(workout.sportName, summary.kind);
      if (kind === 'run' || kind === 'walk' || kind === 'ride') counts[kind] += 1;
    }
  }
  const usual = (Object.entries(counts) as [keyof typeof counts, number][]).sort((a, b) => b[1] - a[1])[0];
  const latestVo2 = d.workouts.find(({ summary }) => (summary.vo2max ?? 0) > 0)?.summary.vo2max ?? null;

  return {
    readiness: scored.headline,
    load: load.kind === 'ok' ? { status: load.status, ratio: load.ratio, acute: load.acute, chronic: load.chronic } : null,
    hrv: 'status' in hrv ? { state: hrv.status.state, recentMs: hrv.status.recentMs, baselineMs: hrv.status.baselineMs } : null,
    lastNightMin: last ? Math.round(last.asleepSeconds / 60) : null,
    sleepDebtMin: debt === null ? null : Math.round(debt / 60),
    strainYesterday: strainOf(dayStart - DAY_SEC),
    strainDayBefore: strainOf(dayStart - 2 * DAY_SEC),
    strainToday: strainOf(dayStart),
    strain7: week.length > 0 ? week.reduce((a, s) => a + s.strain, 0) / week.length : null,
    activeStreak,
    recoveryHoursLeft: left ? left.hoursLeft : null,
    restingHr: d.resting.get(dayStart) ?? null,
    vo2max: latestVo2,
    trainedToday: todays ? { strain: strainOf(dayStart) } : null,
    usualSport: usual && usual[1] > 0 ? usual[0] : null,
  };
}

import type { RogoScoreDay, RogoScoreMetrics } from '@/cloud/rogo';
import { computeDailyFitness, computeFitnessOverview } from '@/features/fitness/compute';
import type { FitnessData } from '@/features/fitness/useFitnessData';
import { localDate } from '@/features/meals/mealMap';
import { buildNights, sleepByDay } from '@/features/sleep/nights';
import { cleanActiveKcal } from '@/features/today/rogoActive';
import type { Scores } from '@/features/today/scores';
import { dayStarts } from '@/features/trends/series';

/** Today and the days before it that are sent, so a day whose strain grew after the last push is corrected. */
export const ROGO_SCORE_DAYS = 3;
/** JoyoRogo's limit of days per `fitness.upsertScores` call. */
export const ROGO_MAX_DAYS_PER_CALL = 14;

/**
 * The scores JoyoRogo gets, oldest first. Earlier days carry strain and the day's active energy only: recovery, sleep, the readiness word and the
 * body metrics are computed for today and are not recomputed for past days, and JoyoRogo keeps what it already stored for
 * them. Days are the phone's calendar days, the same key the meals sync uses; for Indonesian time zones that is JoyoRogo's
 * WIB day. Values are rounded as the Today card shows them. Empty when there is nothing to send.
 *
 * `metrics` are today's body metrics from {@link rogoDailyMetrics}; they are sent as given, so a metric that is missing
 * there is missing here (JoyoRogo keeps its stored value instead of getting a zero).
 *
 * `activeKcal` is the watch's all-day active energy per date (`activeKcalByDate`). Today and every earlier day of the window
 * carry it, so a day whose total grew after the last push is corrected; a past day with energy but no strain still gets an
 * entry. Dates outside the window and totals that are 0 or invalid are left out.
 */
export function rogoScoreDays(
  scores: Scores,
  dayStart: number,
  metrics: RogoScoreMetrics = {},
  activeKcal: ReadonlyMap<string, number> = new Map(),
): RogoScoreDay[] {
  const days: RogoScoreDay[] = [];
  for (const entry of scores.strain) {
    if (entry.day >= dayStart || entry.day <= dayStart - ROGO_SCORE_DAYS * 86400) continue;
    days.push({ date: localDate(entry.day * 1000), strain: roundStrain(entry.strain) });
  }

  const todayDate = localDate(dayStart * 1000);
  for (const start of dayStarts(dayStart, ROGO_SCORE_DAYS)) {
    const date = localDate(start * 1000);
    const kcal = date === todayDate ? null : cleanActiveKcal(activeKcal.get(date));
    if (kcal === null) continue;
    const day = days.find((d) => d.date === date);
    if (day) day.activeKcal = kcal;
    else days.push({ date, activeKcal: kcal });
  }

  const sleep = scores.readiness.signals.find((s) => s.key === 'sleep');
  const today: RogoScoreDay = { date: todayDate };
  const todayKcal = cleanActiveKcal(activeKcal.get(todayDate));
  if (todayKcal !== null) today.activeKcal = todayKcal;
  if (scores.today) today.strain = roundStrain(scores.today.strain);
  if (scores.readiness.recovery) today.recoveryPct = scores.readiness.recovery.percent;
  if (sleep) today.sleepPct = Math.min(300, Math.max(0, Math.round(sleep.amount * 100)));
  if (scores.readiness.headline) today.readiness = scores.readiness.headline;
  Object.assign(today, cleanMetrics(metrics));
  if (Object.keys(today).length > 1) days.push(today);

  return days.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-ROGO_MAX_DAYS_PER_CALL);
}

/**
 * Today's body metrics from what the Kebugaran screen works from (`computeDailyFitness`, `computeFitnessOverview`), for
 * JoyoRogo. Empty for data read for another day (the clock passed midnight between two reads), so yesterday's resting
 * heart rate never lands on today.
 */
export function rogoDailyMetrics(data: FitnessData, dayStart: number): RogoScoreMetrics {
  if (data.dayStart !== dayStart) return {};
  const daily = computeDailyFitness(data);
  const overview = computeFitnessOverview(data, []);

  // Today's sleep (the night that ended today plus today's naps; no night on record, no value) and its overnight HRV, the newest night reading that ended today.
  const sleepToday = sleepByDay(buildNights(data.sleep, []).filter((n) => n.end >= dayStart && n.end <= data.nowSec)).get(dayStart);
  const sleep = sleepToday?.hasNight ? sleepToday : null;
  const nightHrv = data.hrv.filter((r) => r.source === 'night' && r.rmssd > 0 && r.end >= dayStart && r.end <= data.nowSec).at(-1);

  return cleanMetrics({
    sleepHours: sleep ? sleep.asleepSeconds / 3600 : undefined,
    restingHr: data.resting.get(dayStart),
    hrvMs: nightHrv?.rmssd,
    hrvStatus: 'status' in overview.hrv ? overview.hrv.status.state : undefined,
    vo2max: overview.vo2?.value,
    trainingStatus: overview.load.kind === 'ok' ? overview.load.status : undefined,
    loadRatio: overview.load.kind === 'ok' ? overview.load.ratio : undefined,
    recoveryHours: daily.recovery?.hoursLeft,
  });
}

const HRV_STATUSES = ['balanced', 'unbalanced', 'low'] as const;
const TRAINING_STATUSES = ['productive', 'maintaining', 'recovery', 'overreaching', 'detraining'] as const;

/**
 * Rounds every metric the way JoyoRogo stores it and leaves out what it would reject: a missing or non-finite value, a
 * heart rate, HRV or VO2max outside the range a person can have (a wrong reading is dropped, not bent into range), an
 * unknown status. Hours and the load ratio past their ends are pinned to them.
 */
export function cleanMetrics(m: RogoScoreMetrics): RogoScoreMetrics {
  const out: RogoScoreMetrics = {};
  const sleepHours = finite(m.sleepHours);
  if (sleepHours !== null && sleepHours >= 0) out.sleepHours = Math.min(24, round(sleepHours, 1));
  const restingHr = finite(m.restingHr);
  if (restingHr !== null && Math.round(restingHr) >= 25 && Math.round(restingHr) <= 220) out.restingHr = Math.round(restingHr);
  const hrvMs = finite(m.hrvMs);
  if (hrvMs !== null && round(hrvMs, 1) >= 1 && round(hrvMs, 1) <= 500) out.hrvMs = round(hrvMs, 1);
  if (m.hrvStatus && (HRV_STATUSES as readonly string[]).includes(m.hrvStatus)) out.hrvStatus = m.hrvStatus;
  const vo2max = finite(m.vo2max);
  if (vo2max !== null && round(vo2max, 1) >= 10 && round(vo2max, 1) <= 90) out.vo2max = round(vo2max, 1);
  if (m.trainingStatus && (TRAINING_STATUSES as readonly string[]).includes(m.trainingStatus)) out.trainingStatus = m.trainingStatus;
  const loadRatio = finite(m.loadRatio);
  if (loadRatio !== null && loadRatio >= 0) out.loadRatio = Math.min(10, round(loadRatio, 2));
  const recoveryHours = finite(m.recoveryHours);
  if (recoveryHours !== null && recoveryHours >= 0) out.recoveryHours = Math.min(240, Math.round(recoveryHours));
  return out;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function roundStrain(strain: number): number {
  return Math.min(21, Math.max(0, Math.round(strain * 10) / 10));
}

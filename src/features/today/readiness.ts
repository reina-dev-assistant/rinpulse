import type { NightHrvAvailability } from '@/features/today/nightHrv';
import type { Recovery, RecoveryState, RecoveryWait } from '@/features/today/recovery';
import { type SleepSummary } from '@/features/today/stats';
import type { DayStrain } from '@/features/today/strain';
import { loadBalance, MIN_LOAD_DAYS } from '@/features/fitness/trainingLoad';
import { fmtDecimal, fmtDuration, fmtInt, fmtPercent, t } from '@/i18n';

/**
 * "Should you push today?" from your own history. Each signal is shown with its numbers, and a signal without enough
 * history is left out instead of guessed.
 *
 *  - HRV against your 30-day baseline (see `recovery.ts`), from the watch's own RMSSD during last night's sleep or a 1-minute reading.
 *  - Resting heart rate against your own 30-day average (Lamberts: a resting heart rate a few beats above baseline
 *    goes with fatigue or illness).
 *  - The day's sleep (night plus naps) against a need of 7 h 30 min plus up to 1 h after a hard day (yesterday's strain / 21).
 *  - Training load balance: the mean daily TRIMP of the last 7 days against the last 28 (acute:chronic workload ratio,
 *    Gabbett 2016; above 1.5 raises injury risk, below 0.8 is detraining). `fitness/trainingLoad.ts` computes it.
 */
export const BASE_SLEEP_NEED_SEC = 7.5 * 3600;
const EXTRA_NEED_SEC = 3600;
/** Days of history the resting heart rate needs before it is compared. */
const MIN_BASELINE_DAYS = 7;

export type SignalTone = 'good' | 'neutral' | 'bad';
export interface Signal {
  key: 'hrv' | 'rhr' | 'sleep' | 'load';
  title: string;
  value: string;
  detail: string;
  tone: SignalTone;
  /** The number behind `value`: HRV z-score, bpm above baseline, share of sleep need (0..), or the load ratio. */
  amount: number;
}

export type ReadinessHeadline = 'Primed' | 'Balanced' | 'Strained' | 'Run down';

export interface Readiness {
  headline: ReadinessHeadline | null;
  signals: Signal[];
  /** Signals that could not be computed yet, with the reason. */
  missing: string[];
  /** HRV against your baseline, when there is a reading and a baseline. */
  recovery: Recovery | null;
  /** Why `recovery` is null (baseline filling up, night HRV off, ...); null when there is one. */
  recoveryWait: RecoveryWait | null;
  /** Says HRV is not a night reading in this readiness; null when it is, or nothing is known. */
  hrvNote: string | null;
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Share of the 7-night sleep debt asked back each night, and the most it adds to one night. */
const DEBT_REPAY_SHARE = 0.25;
const MAX_DEBT_EXTRA_SEC = 3600;
/** Nights with a sleep record the debt needs before it counts. */
export const MIN_DEBT_NIGHTS = 3;

/**
 * The sleep a night needs: 7 h 30 min, plus up to 1 h after a hard day (`strain` / 21), plus a quarter of the sleep debt
 * (at most 1 h more). The debt term is JoyoFit's own heuristic and has no published source; leave `debtSec` out for
 * the plain need used to judge a night already slept.
 */
export function sleepNeedSec(yesterdayStrain: number | null, debtSec = 0): number {
  const strainExtra = EXTRA_NEED_SEC * Math.min(1, Math.max(0, (yesterdayStrain ?? 0) / 21));
  const debtExtra = Math.min(MAX_DEBT_EXTRA_SEC, Math.max(0, debtSec) * DEBT_REPAY_SHARE);
  return BASE_SLEEP_NEED_SEC + strainExtra + debtExtra;
}

/**
 * Sleep debt over the last nights: how far each night fell short of the 7 h 30 min base, summed. Nights without a
 * record are not counted as zero sleep; fewer than `MIN_DEBT_NIGHTS` records give null. Oversleeping does not pay debt back.
 */
export function sleepDebtSec(asleepSecondsPerNight: readonly number[]): number | null {
  if (asleepSecondsPerNight.length < MIN_DEBT_NIGHTS) return null;
  return asleepSecondsPerNight.reduce((sum, s) => sum + Math.max(0, BASE_SLEEP_NEED_SEC - s), 0);
}

const HEADLINE_KEY = { Primed: 'primed', Balanced: 'balanced', Strained: 'strained', 'Run down': 'runDown' } as const;

/** The headline word in the UI language; the `ReadinessHeadline` value itself is the stable identifier JoyoRogo receives. */
export function headlineLabel(headline: ReadinessHeadline): string {
  return t(`today:readiness.headline.${HEADLINE_KEY[headline]}`);
}

export function headlineHint(headline: ReadinessHeadline): string {
  return t(`today:readiness.hint.${HEADLINE_KEY[headline]}`);
}

/** `+1,5` / `-0,5` with one decimal. */
function signed(n: number): string {
  return `${n >= 0 ? '+' : ''}${fmtDecimal(n, 1)}`;
}

export function readiness(input: {
  dayStart: number;
  /** The watch's resting heart rate per local day (the lowest it reported that day; `listRestingHeartRateByDay`). */
  resting: ReadonlyMap<number, number>;
  strain: readonly DayStrain[];
  sleep: SleepSummary | null;
  hrv: RecoveryState;
  /** Why night HRV is or is not arriving; leaves the HRV note out when not given. */
  availability?: NightHrvAvailability | null;
}): Readiness {
  const { dayStart, resting, strain, sleep, hrv, availability } = input;
  const signals: Signal[] = [];
  const missing: string[] = [];

  if ('recovery' in hrv) {
    const r = hrv.recovery;
    signals.push({
      key: 'hrv',
      title: t(r.source === 'night' ? 'today:readiness.signal.hrvNightTitle' : 'today:readiness.signal.hrvSpotTitle'),
      value: `${fmtInt(r.rmssd)} ms`,
      detail: t(r.source === 'night' ? 'today:readiness.signal.hrvNightDetail' : 'today:readiness.signal.hrvSpotDetail', {
        z: signed(r.z),
        baseline: fmtInt(r.baselineRmssd),
        count: r.baselineCount,
      }),
      tone: r.z >= 0.5 ? 'good' : r.z <= -1 ? 'bad' : 'neutral',
      amount: r.z,
    });
  } else {
    missing.push(hrv.missing);
  }

  const today = resting.get(dayStart);
  const history = [...resting.entries()].filter(([day]) => day < dayStart && day >= dayStart - 30 * 86400).map(([, v]) => v);
  if (today === undefined) {
    missing.push(t('today:readiness.missing.rhrNone'));
  } else if (history.length < MIN_BASELINE_DAYS) {
    missing.push(t('today:readiness.missing.rhrShort', { have: history.length, need: MIN_BASELINE_DAYS }));
  } else {
    const baseline = mean(history);
    const delta = today - baseline;
    signals.push({
      key: 'rhr',
      title: t('today:readiness.signal.rhrTitle'),
      value: `${fmtInt(today)} bpm`,
      detail: t('today:readiness.signal.rhrDetail', { delta: signed(delta), count: history.length, baseline: fmtInt(baseline) }),
      tone: delta >= 5 ? 'bad' : delta <= -2 ? 'good' : 'neutral',
      amount: delta,
    });
  }

  const yesterday = strain.find((d) => d.day < dayStart && d.day >= dayStart - 26 * 3600)?.strain ?? null;
  if (!sleep) {
    missing.push(t('today:readiness.missing.sleepNone'));
  } else {
    const slept = sleep.dayAsleepSeconds;
    const need = sleepNeedSec(yesterday);
    const share = slept / need;
    signals.push({
      key: 'sleep',
      title: t('today:readiness.signal.sleepTitle'),
      value: fmtPercent(share * 100),
      detail:
        yesterday !== null
          ? t('today:readiness.signal.sleepDetailStrain', { slept: fmtDuration(slept), need: fmtDuration(need), strain: fmtDecimal(yesterday, 1) })
          : t('today:readiness.signal.sleepDetail', { slept: fmtDuration(slept), need: fmtDuration(need) }),
      tone: share >= 0.9 ? 'good' : share >= 0.75 ? 'neutral' : 'bad',
      amount: share,
    });
  }

  const load = loadBalance(strain, dayStart);
  if (load.kind === 'short') {
    missing.push(t('today:readiness.missing.loadShort', { have: load.daysWithData, need: MIN_LOAD_DAYS }));
  } else if (load.kind === 'none') {
    missing.push(t('today:readiness.missing.loadNone'));
  } else {
    const { acute, chronic, ratio } = load;
    signals.push({
      key: 'load',
      title: t('today:readiness.signal.loadTitle'),
      value: fmtDecimal(ratio, 2),
      detail: t(
        ratio > 1.5 ? 'today:readiness.signal.loadDetailRise' : ratio < 0.8 ? 'today:readiness.signal.loadDetailLight' : 'today:readiness.signal.loadDetail',
        { acute: fmtInt(acute), chronic: fmtInt(chronic) },
      ),
      tone: ratio > 1.5 ? 'bad' : ratio < 0.8 ? 'neutral' : 'good',
      amount: ratio,
    });
  }

  return {
    headline: headline(signals),
    signals,
    missing,
    recovery: 'recovery' in hrv ? hrv.recovery : null,
    recoveryWait: 'wait' in hrv ? hrv.wait : null,
    hrvNote: hrvNote(hrv, availability),
  };
}

/**
 * One line saying HRV is not a night reading in this readiness, so the headline is not mistaken for one that had it.
 * Null when a night reading is in, or when night HRV is expected and only the baseline is still short.
 */
export function hrvNote(hrv: RecoveryState, availability: NightHrvAvailability | null | undefined): string | null {
  const why = availability && availability.state !== 'available' ? availability.message : null;
  if ('recovery' in hrv) {
    if (hrv.recovery.source === 'night') return null;
    return why ? t('today:readiness.note.spotWhy', { why }) : t('today:readiness.note.spot');
  }
  return why ? t('today:readiness.note.noNight', { why }) : null;
}

function headline(signals: readonly Signal[]): ReadinessHeadline | null {
  if (signals.length === 0) return null;
  const bad = signals.filter((s) => s.tone === 'bad').length;
  const good = signals.filter((s) => s.tone === 'good').length;
  if (bad >= 2) return 'Run down';
  if (bad === 1) return 'Strained';
  if (good === signals.length && signals.length >= 2) return 'Primed';
  return 'Balanced';
}

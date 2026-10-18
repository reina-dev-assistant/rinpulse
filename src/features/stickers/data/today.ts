import type { DayShareInput } from '@/features/share/dayShareStats';
import type { ReadinessHeadline } from '@/features/today/readiness';
import { STRAIN_MAX } from '@/features/today/strain';
import type { JsonObject, StickerSubject } from '@/features/stickers/subject';
import { getT, type Locale } from '@/i18n';

export interface TodaySubjectInput extends DayShareInput {
  stepGoal: number | null;
  restingHr: number | null;
  nowMs: number;
}

const SLEEP_TARGET_SEC = 8 * 3600;
const MAX_TEXT = 60;
const MAX_SIGNALS = 4;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Trimmed, non-empty, at most 60 characters (cut with `...`); null when nothing is left. */
function clip(text: string): string | null {
  const s = typeof text === 'string' ? text.trim() : '';
  if (!s) return null;
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 3).trimEnd()}...` : s;
}

function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const HEADLINE_KEY: Record<ReadinessHeadline, string> = {
  Primed: 'readiness.headline.primed',
  Balanced: 'readiness.headline.balanced',
  Strained: 'readiness.headline.strained',
  'Run down': 'readiness.headline.runDown',
};

export function buildTodaySubject(input: TodaySubjectInput, locale: Locale): StickerSubject {
  const { steps, sleep, readiness, strain, stepGoal, restingHr, nowMs } = input;
  const t = getT(locale, 'stickerdata');

  /** Values both namespaces repeat. */
  const shared: JsonObject = {};
  // 0 steps is what a day without step data reads as; it is left out rather than shown as a real zero.
  if (finite(steps) && steps > 0) shared.steps = Math.round(steps);
  const goal = finite(stepGoal) && stepGoal > 0 ? Math.round(stepGoal) : null;
  if (goal !== null && goal > 0) {
    shared.stepGoal = goal;
    if (finite(steps) && steps > 0) shared.stepPct = steps / goal;
  }
  if (strain && finite(strain.strain)) {
    const value = round1(clamp(strain.strain, 0, STRAIN_MAX));
    shared.strain = value;
    shared.strainPct = value / STRAIN_MAX;
  }
  const recovery = readiness.recovery;
  if (recovery && finite(recovery.percent)) shared.recovery = clamp(Math.round(recovery.percent), 0, 100);
  if (sleep) {
    const sec = sleep.dayAsleepSeconds; // the day's sleep, naps included
    if (finite(sec) && sec > 0) {
      shared.sleepSec = Math.round(sec);
      shared.sleepPct = clamp(sec / SLEEP_TARGET_SEC, 0, 1.2);
    }
  }
  if (finite(restingHr) && restingHr > 0) shared.rhr = Math.round(restingHr);

  const ready: JsonObject = { ...shared };
  if (readiness.headline && HEADLINE_KEY[readiness.headline]) {
    ready.headline = getT(locale, 'today')(HEADLINE_KEY[readiness.headline] as never) as string;
    ready.headlineKey = readiness.headline;
  }
  if (recovery && finite(recovery.rmssd) && recovery.rmssd > 0) ready.hrvMs = Math.round(recovery.rmssd);
  const signals = readiness.signals.flatMap((signal) => {
    const title = clip(signal.title);
    const value = clip(signal.value);
    return title && value ? [{ title, value, tone: signal.tone }] : [];
  });
  if (signals.length > 0) ready.signals = signals.slice(0, MAX_SIGNALS);

  return {
    id: `today:${localDayKey(nowMs)}`,
    kinds: ['ready', 'watch'],
    heading: t('ready.heading'),
    caption: getT(locale, 'sharing')('share.caption'),
    date: nowMs,
    data: { ready, watch: { ...shared } },
  };
}

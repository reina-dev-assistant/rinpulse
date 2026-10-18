import { nightHasStages, type Night, type NightStage } from '@/features/sleep/nights';
import type { JsonObject, StickerSubject } from '@/features/stickers/subject';
import { getT, type Locale } from '@/i18n';

export interface SleepSubjectInput {
  night: Night;
  /** Asleep seconds of the other recent nights (not this one); `vsAvgSec` needs at least {@link MIN_HISTORY_NIGHTS}. */
  recentAsleepSec: readonly number[];
}

export const HYPNO_BUCKETS = 48;
export const MIN_HISTORY_NIGHTS = 3;

/** Bar height per stage, and the app's stage colors (SleepSummaryView). */
const DEPTH: Record<NightStage, number> = { deep: 4, light: 3, asleep: 3, rem: 2, awake: 1 };
const STAGE_COLOR: Record<NightStage, string> = {
  deep: '#4B57B5',
  rem: '#C09CF5',
  light: '#8F9BE3',
  asleep: '#8F9BE3',
  awake: '#F0A23C',
};

const HOUR = 3600;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** One bar per equal slice of the night, each holding the stage that covers most of the slice (no record counts as awake). */
function hypnogram(night: Night): { depth: number[]; colors: string[] } | null {
  const span = night.end - night.start;
  if (!finite(span) || span <= 0) return null;
  const size = span / HYPNO_BUCKETS;
  const depth: number[] = [];
  const colors: string[] = [];
  let p = 0;
  for (let i = 0; i < HYPNO_BUCKETS; i++) {
    const from = night.start + i * size;
    const to = i === HYPNO_BUCKETS - 1 ? night.end : from + size;
    const seconds: Partial<Record<NightStage, number>> = {};
    while (p < night.periods.length && night.periods[p].end <= from) p++;
    for (let q = p; q < night.periods.length && night.periods[q].start < to; q++) {
      const period = night.periods[q];
      const overlap = Math.min(period.end, to) - Math.max(period.start, from);
      // An unstaged span stands as light, so it adds to a neighbouring light span instead of splitting its vote.
      const stage = period.stage === 'asleep' ? 'light' : period.stage;
      if (overlap > 0) seconds[stage] = (seconds[stage] ?? 0) + overlap;
    }
    let best: NightStage = 'awake';
    let bestSec = 0;
    for (const stage of Object.keys(seconds) as NightStage[]) {
      const sec = seconds[stage] ?? 0;
      if (sec > bestSec) {
        best = stage;
        bestSec = sec;
      }
    }
    depth.push(DEPTH[best]);
    colors.push(STAGE_COLOR[best]);
  }
  return { depth, colors };
}

function verdictKey(asleepSec: number): 'short' | 'fair' | 'good' | 'long' {
  if (asleepSec < 6 * HOUR) return 'short';
  if (asleepSec < 7 * HOUR) return 'fair';
  if (asleepSec <= 9 * HOUR) return 'good';
  return 'long';
}

export function buildSleepSubject({ night, recentAsleepSec }: SleepSubjectInput, locale: Locale): StickerSubject {
  const t = getT(locale, 'stickerdata');
  const sleep: JsonObject = {};

  const score = night.score?.score;
  if (finite(score)) sleep.score = Math.min(100, Math.max(0, Math.round(score)));

  const asleep = night.asleepSeconds;
  const hasAsleep = finite(asleep) && asleep > 0;
  if (hasAsleep) sleep.asleepSec = Math.round(asleep);

  const staged = nightHasStages(night);
  if (staged) {
    const sec = night.seconds;
    const deep = sec.deep ?? 0;
    const rem = sec.rem ?? 0;
    const light = (sec.light ?? 0) + (sec.asleep ?? 0);
    const awake = sec.awake ?? 0;
    const parts = { deep, rem, light, awake };
    if (Object.values(parts).every((v) => finite(v) && v >= 0)) {
      const total = deep + rem + light + awake;
      sleep.deepSec = Math.round(deep);
      sleep.remSec = Math.round(rem);
      sleep.lightSec = Math.round(light);
      sleep.awakeSec = Math.round(awake);
      if (total > 0) {
        sleep.deepPct = deep / total;
        sleep.remPct = rem / total;
        sleep.lightPct = light / total;
        sleep.awakePct = awake / total;
      }
    }
  }

  if (finite(night.start)) sleep.bedtime = Math.round(night.start * 1000);
  if (finite(night.end)) sleep.wakeTime = Math.round(night.end * 1000);
  if (finite(night.start) && finite(night.end) && night.end > night.start) sleep.inBedSec = Math.round(night.end - night.start);

  if (finite(night.awakenings) && (night.awakenings > 0 || staged)) sleep.awakenings = Math.round(night.awakenings);

  const history = recentAsleepSec.filter((s) => finite(s) && s > 0);
  if (hasAsleep && history.length >= MIN_HISTORY_NIGHTS) {
    sleep.vsAvgSec = Math.round(asleep - history.reduce((a, b) => a + b, 0) / history.length);
  }

  if (staged) {
    const h = hypnogram(night);
    if (h) {
      sleep.hypno = h.depth;
      sleep.hypnoColors = h.colors;
    }
  }

  if (night.nap) sleep.nap = true;
  else if (hasAsleep) sleep.verdict = t(`sleep.verdict.${verdictKey(asleep)}`);

  return {
    id: `sleep:${night.day}`,
    kinds: ['sleep'],
    heading: t('sleep.heading'),
    caption: getT(locale, 'sharing')('share.caption'),
    date: Math.round(night.end * 1000),
    data: { sleep },
  };
}

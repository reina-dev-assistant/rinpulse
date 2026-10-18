import { addDays, daysBetween } from '@/features/coach/time';
import type { JsonObject, StickerSubject } from '@/features/stickers/subject';
import { fmtInt, getT, type Locale } from '@/i18n';

export type BadgeKind = 'distance' | 'workouts' | 'time' | 'streak';

/** Thresholds per ladder: km, workouts, hours, days. */
export const DISTANCE_KM = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000] as const;
export const WORKOUTS = [1, 10, 25, 50, 100, 250, 500] as const;
export const HOURS = [10, 25, 50, 100, 250, 500] as const;
export const STREAK_DAYS = [3, 7, 14, 30, 60, 100] as const;

const LADDER: Record<BadgeKind, readonly number[]> = {
  distance: DISTANCE_KM,
  workouts: WORKOUTS,
  time: HOURS,
  streak: STREAK_DAYS,
};
/** Tie-break order between ladders of equal rank. */
const ORDER: readonly BadgeKind[] = ['distance', 'workouts', 'time', 'streak'];

export interface MilestoneTotals {
  /** All-time metres. */
  totalDistanceM: number;
  /** All-time number of workouts. */
  workoutCount: number;
  /** All-time moving seconds. */
  totalMovingSec: number;
  /** Current streak in days ({@link currentStreakDays}). */
  streakDays: number;
  /** The ladder the latest workout just pushed over a threshold: only that one is considered (and listed first). */
  justCrossed?: BadgeKind;
  /** Epoch ms for `date`; defaults to now (the only impure input). */
  nowMs?: number;
  /** Longest streak in days ({@link longestStreak}); `streak.best` is left out without it. */
  bestStreakDays?: number;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

interface Crossed {
  kind: BadgeKind;
  threshold: number;
  /** Position in the ladder as a share (1/len .. 1): lets ladders of different length compete. */
  rank: number;
}

/** The highest threshold crossed in one ladder, or null. */
function crossedIn(kind: BadgeKind, amount: number): Crossed | null {
  if (!finite(amount)) return null;
  const ladder = LADDER[kind];
  let index = -1;
  for (let i = 0; i < ladder.length; i++) if (amount >= ladder[i]!) index = i;
  return index < 0 ? null : { kind, threshold: ladder[index]!, rank: (index + 1) / ladder.length };
}

function allCrossed(totals: MilestoneTotals): Crossed[] {
  const found = [
    crossedIn('distance', totals.totalDistanceM / 1000),
    crossedIn('workouts', totals.workoutCount),
    crossedIn('time', totals.totalMovingSec / 3600),
    crossedIn('streak', totals.streakDays),
  ].filter((c): c is Crossed => c !== null);
  // Highest rank first, ladder order on ties, the just-crossed ladder before everything.
  return found.sort((a, b) => {
    if (totals.justCrossed) {
      if (a.kind === totals.justCrossed && b.kind !== totals.justCrossed) return -1;
      if (b.kind === totals.justCrossed && a.kind !== totals.justCrossed) return 1;
    }
    return b.rank - a.rank || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind);
  });
}

function subjectOf(crossed: Crossed, totals: MilestoneTotals, locale: Locale): StickerSubject {
  const t = getT(locale, 'stickerdata');
  const { kind, threshold } = crossed;
  const value = String(fmtInt(threshold, locale));
  const first = kind === 'workouts' && threshold === 1;
  const raw = kind === 'distance' ? threshold * 1000 : kind === 'time' ? threshold * 3600 : threshold;

  const data: JsonObject = {
    milestone: {
      kind,
      title: first ? t('badge.title.firstWorkout') : t(`badge.title.${kind}`, { value }),
      subtitle: t(first ? 'badge.subtitle.firstWorkout' : `badge.subtitle.${kind}`),
      value: raw,
      valueText: t(`badge.value.${kind}`, { value }),
      unit: t(`badge.unit.${kind}`),
    },
  };
  if (finite(totals.streakDays) && totals.streakDays >= 1) {
    const streak: JsonObject = { days: Math.floor(totals.streakDays), unit: t('badge.streakUnit') };
    if (finite(totals.bestStreakDays) && totals.bestStreakDays >= 1) streak.best = Math.floor(totals.bestStreakDays);
    data.streak = streak;
  }

  return {
    id: `badge:${kind}:${threshold}`,
    kinds: ['badge'],
    heading: t('badge.heading'),
    caption: getT(locale, 'sharing')('share.caption'),
    date: finite(totals.nowMs) ? totals.nowMs : Date.now(),
    data,
  };
}

/**
 * The single best milestone: across ladders the highest rank wins (a threshold's position in its own ladder, so 100 km
 * [4 of 9] beats 10 workouts [2 of 7]); with `justCrossed` only that ladder counts. `null` when nothing is crossed.
 */
export function milestoneFromTotals(totals: MilestoneTotals, locale: Locale): StickerSubject | null {
  const crossed = allCrossed(totals).filter((c) => !totals.justCrossed || c.kind === totals.justCrossed);
  const best = crossed[0];
  return best ? subjectOf(best, totals, locale) : null;
}

/** One badge per ladder with a crossed threshold (its highest), best first, `justCrossed` leading. Empty when none. */
export function buildBadgeSubjects(totals: MilestoneTotals, locale: Locale): StickerSubject[] {
  return allCrossed(totals).map((c) => subjectOf(c, totals, locale));
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Unique valid keys, ascending (YYYY-MM-DD sorts lexicographically). */
function uniqueSorted(days: readonly string[]): string[] {
  return [...new Set(days.filter((d) => DAY_KEY.test(d)))].sort();
}

/**
 * Consecutive active days ending today; a streak survives when today has no activity yet but yesterday does.
 * `todayKey` and the days are local `YYYY-MM-DD`.
 */
export function currentStreakDays(daysWithActivity: readonly string[], todayKey: string): number {
  if (!DAY_KEY.test(todayKey)) return 0;
  const set = new Set(daysWithActivity);
  let cursor = todayKey;
  if (!set.has(cursor)) {
    cursor = addDays(todayKey, -1);
    if (!set.has(cursor)) return 0;
  }
  let count = 0;
  while (set.has(cursor)) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

/** The longest run of consecutive days in the list (0 when empty). */
export function longestStreak(daysWithActivity: readonly string[]): number {
  const days = uniqueSorted(daysWithActivity);
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && daysBetween(days[i - 1]!, days[i]!) === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

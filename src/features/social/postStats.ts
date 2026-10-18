import type { RogoPost, RogoWatchStats } from '@/cloud/rogo';
import { paceOrSpeed, sportKindFromName, type SportKind } from '@/features/social/feedRoute';
import { formatPace } from '@/features/workouts/analysis/types';
import { fmtDecimal, fmtInt, fmtDuration, t } from '@/i18n';

const num = (value: number | string | null | undefined) => (typeof value === 'number' ? value : null);

const SPORT_KINDS: readonly SportKind[] = ['run', 'walk', 'ride', 'swim', 'other'];

/** The watch stats of a post JoyoFit made (`stats.source === 'joyofit'`); null for every other post. */
export function watchStats(post: RogoPost): RogoWatchStats | null {
  const stats = post.stats;
  if (stats?.source !== 'joyofit') return null;
  return {
    source: 'joyofit',
    distanceM: num(stats.distanceM),
    avgHr: num(stats.avgHr),
    maxHr: num(stats.maxHr),
    startedAt: num(stats.startedAt) ?? Date.parse(post.createdAt),
    hasDetail: stats.hasDetail === 1 ? 1 : 0,
    sportKind: SPORT_KINDS.find((kind) => kind === stats.sportKind) ?? null,
    movingSec: num(stats.movingSec),
    elevGainM: num(stats.elevGainM),
    hasMap: stats.hasMap === 1 ? 1 : 0,
    showMap: stats.showMap === 0 ? 0 : 1,
  };
}

/** "5,43 km" under 10 km, "12,3 km" from there on. */
function distanceFigure(meters: number): string {
  const km = meters / 1000;
  return t('common:units.km', { value: fmtDecimal(km, km < 10 ? 2 : 1) });
}

/**
 * The figures a post card shows: for a watch post distance, time (moving time when the post has it), pace on foot or
 * speed on a bike, and elevation gain; then energy and heart rate. Any other post shows its duration and energy.
 */
export function postFigures(post: RogoPost): { label: string; value: string }[] {
  const watch = watchStats(post);
  const figures: { label: string; value: string }[] = [];
  const elapsedSec = post.durationMin !== null ? post.durationMin * 60 : null;
  const timeSec = watch?.movingSec ? watch.movingSec : elapsedSec;
  if (watch?.distanceM) figures.push({ label: t('social:post.figure.distance'), value: distanceFigure(watch.distanceM) });
  if (timeSec !== null) figures.push({ label: t('social:post.figure.time'), value: fmtDuration(timeSec) });
  if (watch) {
    const rate = paceOrSpeed(watch.sportKind ?? sportKindFromName(post.title), watch.distanceM, timeSec);
    if (rate?.kind === 'pace') {
      figures.push({ label: t('social:post.figure.pace'), value: t('social:post.figure.paceValue', { pace: formatPace(rate.secPerKm) }) });
    } else if (rate?.kind === 'speed') {
      figures.push({ label: t('social:post.figure.speed'), value: t('social:post.figure.speedValue', { kmh: fmtDecimal(rate.kmh, 1) }) });
    }
    if (watch.elevGainM && watch.elevGainM > 0) {
      figures.push({ label: t('social:post.figure.elevation'), value: t('common:units.m', { value: fmtInt(watch.elevGainM) }) });
    }
  }
  if (post.kcal !== null) figures.push({ label: t('social:post.figure.energy'), value: `${fmtInt(post.kcal)} kcal` });
  if (watch?.avgHr) figures.push({ label: t('social:post.figure.avgHr'), value: `${watch.avgHr} bpm` });
  if (watch?.maxHr) figures.push({ label: t('social:post.figure.maxHr'), value: `${watch.maxHr} bpm` });
  return figures;
}

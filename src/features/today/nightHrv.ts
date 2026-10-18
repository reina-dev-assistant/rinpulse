import type { SleepScoreRow } from '@/db/queries';
import { buildNights } from '@/features/sleep/nights';
import { t } from '@/i18n';
import type { SleepSegment } from '@/wear';

/** Nights with Automatic stress on that must pass before a watch that recorded none is called unable to. */
export const NIGHTS_TO_CHECK = 3;

export interface NightHrvInput {
  platform: 'android' | 'ios';
  /** Whether the watch listed the automatic stress command the last time it connected; null before any connect. */
  knownSupported: boolean | null;
  /** Automatic stress switch, as last set from this app. */
  enabled: boolean;
  /** Unix seconds of the calibration; null when none was stored. */
  calibratedAt: number | null;
  /** Sleep nights (naps left out) that ended after `calibratedAt`; every night in the window when it is null. */
  nightsSinceSetup: number;
  /** Night HRV rows that ended after `calibratedAt`; every one in the window when it is null. */
  nightRowsSinceSetup: number;
  /** There is a night HRV row anywhere in the readings window. */
  anyNightRowInHistory: boolean;
  /** This phone has never had a watch: the "turn on Automatic stress" advice would be about a switch that does not exist. */
  noWatch?: boolean;
}

export type NightHrvAvailability =
  | { state: 'available' }
  | {
      state: 'ios' | 'unsupported' | 'off' | 'none-recorded' | 'waiting' | 'no-watch';
      message: string;
      detail: string;
    };

/**
 * Why night HRV is or is not arriving, so the app can say so instead of showing empty metrics. Night HRV only comes
 * from the watch's automatic stress records, which need the watch to list the command and the switch to be on.
 */
export function nightHrvAvailability(input: NightHrvInput): NightHrvAvailability {
  if (input.anyNightRowInHistory) return { state: 'available' };
  if (input.noWatch) {
    return { state: 'no-watch', message: t('today:nightHrv.noWatch.message'), detail: t('today:nightHrv.noWatch.detail') };
  }
  if (input.platform === 'ios') {
    return {
      state: 'ios',
      message: t('today:nightHrv.ios.message'),
      detail: t('today:nightHrv.ios.detail'),
    };
  }
  if (input.knownSupported === false) {
    return {
      state: 'unsupported',
      message: t('today:nightHrv.unsupported.message'),
      detail: t('today:nightHrv.unsupported.detail'),
    };
  }
  if (!input.enabled) {
    return {
      state: 'off',
      message: t('today:nightHrv.off.message'),
      detail: t('today:nightHrv.off.detail'),
    };
  }
  if (input.nightsSinceSetup >= NIGHTS_TO_CHECK && input.nightRowsSinceSetup === 0) {
    return {
      state: 'none-recorded',
      message: t('today:nightHrv.noneRecorded.message'),
      detail: t('today:nightHrv.noneRecorded.detail', { count: input.nightsSinceSetup }),
    };
  }
  return {
    state: 'waiting',
    message: t('today:nightHrv.waiting.message'),
    detail: t('today:nightHrv.waiting.detail', { done: input.nightsSinceSetup, total: NIGHTS_TO_CHECK }),
  };
}

/** Message and detail as one text; empty when night HRV is available. */
export function availabilityText(availability: NightHrvAvailability | null | undefined): string | null {
  if (!availability || availability.state === 'available') return null;
  return t('today:recovery.offWaiting', { message: availability.message, detail: availability.detail });
}

/** Sleep nights (naps left out) that ended after `sinceSec`; with null, every night in `segments`. */
export function countNightsSince(
  segments: readonly SleepSegment[],
  scores: readonly SleepScoreRow[],
  sinceSec: number | null,
): number {
  return buildNights(segments, scores).filter((n) => !n.nap && (sinceSec === null || n.end > sinceSec)).length;
}

/** Empty-state text of the "HRV, nights" trend card. */
export function nightHrvTrendEmpty(availability: NightHrvAvailability | null | undefined): string {
  return availabilityText(availability) ?? t('today:nightHrv.trendEmpty');
}

/** Empty-state text of the Recovery trend card. */
export function recoveryTrendEmpty(availability: NightHrvAvailability | null | undefined): string {
  if (availability && ['ios', 'unsupported', 'none-recorded'].includes(availability.state) && 'message' in availability) {
    return t('today:nightHrv.recoveryEmptyNoNight', { message: availability.message });
  }
  return t('today:nightHrv.recoveryEmpty');
}

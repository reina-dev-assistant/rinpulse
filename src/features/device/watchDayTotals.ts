import type { WatchRow } from '@/features/device/watches';
import type { FitnessTotals } from '@/wear';

/** What the last sync of this app session reported for today, and the watch that reported it. */
export interface WatchTotals extends FitnessTotals {
  /** `SyncSummary.to`, unix seconds. */
  at: number;
  /** The watch the numbers came from (`device.address`); null when the link could not say. */
  address: string | null;
}

/**
 * The watch's own day counter, when it may stand for the day on Today; null means "add up the stored minutes instead".
 *
 * A sync reports the counter of the watch it ran on, and that watch need not be the one the person lives in: a borrowed band, a
 * second watch for runs. Showing its counter put another person's (usually near-zero) day on the ring while the stored minutes of
 * the owner's watch were untouched. The stored minutes are the merged timeline of every watch (docs/multi-watch.md), so:
 *
 * - one watch row or none (a phone with a single watch, or the list is still loading): the counter, as before;
 * - several watches and exactly one stores health data: its counter, and only its counter (a guest watch with `tracks_health` off
 *   reports zeros);
 * - several watches and two or more store health data: no counter at all, the sum of the merged minutes is the day.
 */
export function ownTotalsOf(totals: WatchTotals | null, watches: readonly Pick<WatchRow, 'address' | 'tracksHealth'>[], dayStart: number): WatchTotals | null {
  if (!totals || totals.at < dayStart) return null;
  if (watches.length <= 1) return totals;
  const tracking = watches.filter((w) => w.tracksHealth);
  if (tracking.length !== 1) return null;
  return totals.address === tracking[0].address ? totals : null;
}

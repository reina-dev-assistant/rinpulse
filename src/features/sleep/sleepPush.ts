import { SLEEP_PUSH_BATCH, type SleepNightPayload } from '@/cloud/sleepInsightsClient';

/** JoyoRogo keeps this many nights; the first push after the switch turns on sends all of them. */
export const SLEEP_BACKFILL_NIGHTS = 90;
/** Every later push looks at the newest nights only (a night is final within a day or two of waking). */
export const SLEEP_RECENT_NIGHTS = 14;
/** After JoyoRogo answered 404/405 (an older JoyoRogo), do not ask again for this long. */
export const SLEEP_UNSUPPORTED_BACKOFF_MS = 30 * 60 * 1000;

/** Whether a 404/405 at `unsupportedAt` still holds back requests at `now`. */
export function sleepBackoffActive(unsupportedAt: number, now: number): boolean {
  return unsupportedAt > 0 && now - unsupportedAt < SLEEP_UNSUPPORTED_BACKOFF_MS;
}

/** What the server accepted for a night, to compare against: the serialized payload per wake date. */
export type AcceptedNights = Map<string, string>;

export const serializeNight = (n: SleepNightPayload): string => JSON.stringify(n);

/**
 * The calls still to make, oldest nights first, at most {@link SLEEP_PUSH_BATCH} nights each. `nights` is oldest first (the
 * output of `buildRogoNights`). Looks at the newest 90 nights when `backfill` (the switch was just seen on and nothing was
 * ever accepted here), else the newest 14, and skips every night whose payload equals the last accepted one.
 */
export function pendingSleepBatches(nights: readonly SleepNightPayload[], accepted: ReadonlyMap<string, string>, backfill: boolean): SleepNightPayload[][] {
  const window = nights.slice(-(backfill ? SLEEP_BACKFILL_NIGHTS : SLEEP_RECENT_NIGHTS));
  const changed = window.filter((n) => accepted.get(n.wakeDate) !== serializeNight(n));
  const batches: SleepNightPayload[][] = [];
  for (let i = 0; i < changed.length; i += SLEEP_PUSH_BATCH) batches.push(changed.slice(i, i + SLEEP_PUSH_BATCH));
  return batches;
}

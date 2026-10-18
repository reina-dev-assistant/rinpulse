import {
  needsWatchKcalSend,
  watchKcalEligible,
  watchKcalPayload,
  WATCH_KCAL_MAX_PER_PASS,
  type WatchKcalPayload,
  type WatchKcalSent,
  type WatchWorkoutRow,
} from './watchKcalPlan';

/** How a failed request affects the pass. */
export type SendFailure =
  /** Not worth showing: nobody is signed in, or this JoyoRogo has no such procedure. The pass ends. */
  | 'quiet'
  /** The server answered about this workout and refused it: the next workout may still go. */
  | 'refused'
  /** No usable answer (offline, a server error, a rejected session, rate limited): the pass ends, the next sync meets it again. */
  | 'stop';

/** Everything the pass touches, so its rules run without a database or a network in the tests. */
export interface WatchKcalIo {
  /** An account question is open (`pauseSync`): nothing may be sent. */
  paused: () => boolean;
  /** The JoyoRogo account the phone's data is bound to (`cloud_state.user_id`), null when none. */
  boundAccount: () => Promise<string | null>;
  /** Stored workouts started within the window, newest first. */
  workouts: () => Promise<WatchWorkoutRow[]>;
  sentFor: (start: number) => Promise<WatchKcalSent | null>;
  /** The localized sport name for the diary. */
  label: (sportName: string) => string;
  send: (payload: WatchKcalPayload) => Promise<void>;
  markSent: (start: number, accountId: string, payload: WatchKcalPayload) => Promise<void>;
  classify: (error: unknown) => SendFailure;
  onSent: () => Promise<void>;
  onError: (start: number, error: unknown) => Promise<void>;
  detachedHash: string;
  nowSec: () => number;
}

export interface WatchKcalPass {
  sent: number;
  /** The pass ended at a problem that the next sync will meet again. */
  stopped: boolean;
}

/** A workout the diary of `accountId` does not have in its current form. */
export interface PendingWatchSend {
  row: WatchWorkoutRow;
  payload: WatchKcalPayload;
}

/** What the next pass would send to `accountId`, newest first. */
export async function pendingWatchSends(io: WatchKcalIo, accountId: string): Promise<PendingWatchSend[]> {
  const now = io.nowSec();
  const out: PendingWatchSend[] = [];
  for (const row of await io.workouts()) {
    if (!watchKcalEligible(row, io.detachedHash, now)) continue;
    const payload = watchKcalPayload(row, io.label(row.sportName));
    if (payload && needsWatchKcalSend(payload, await io.sentFor(row.start), accountId)) out.push({ row, payload });
  }
  return out;
}

/**
 * The pass the sync runs for the signed-in account (`accountId`): every eligible watch workout that JoyoRogo's diary of that account does
 * not have in its current form is sent. Nothing happens while the sync is paused (an account question is open) or when the phone's data is
 * bound to another account (the choice is made first; `bindAccount` follows it). Never throws.
 */
export async function runWatchKcalPass(io: WatchKcalIo, accountId: string): Promise<WatchKcalPass> {
  const pass: WatchKcalPass = { sent: 0, stopped: false };
  if (io.paused()) return pass;
  try {
    if ((await io.boundAccount()) !== accountId) return pass;
    for (const { row, payload } of await pendingWatchSends(io, accountId)) {
      if (pass.sent >= WATCH_KCAL_MAX_PER_PASS) break;
      try {
        await io.send(payload);
      } catch (error) {
        const failure = io.classify(error);
        if (failure !== 'quiet') await io.onError(row.start, error);
        if (failure === 'refused') continue;
        pass.stopped = true;
        return pass;
      }
      await io.markSent(row.start, accountId, payload);
      pass.sent += 1;
      await io.onSent();
    }
  } catch (error) {
    if (io.classify(error) !== 'quiet') await io.onError(0, error);
    pass.stopped = true;
  }
  return pass;
}

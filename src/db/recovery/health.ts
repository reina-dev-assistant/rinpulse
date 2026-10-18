import { isCorruptionError } from './corruption';
import type { RecoveryOptions, RecoveryResult } from './recover';

/**
 * Decides when the database is repaired, remembers what happened for the notice the person sees, and keeps the app's
 * queries out of the way meanwhile. No native imports (the pieces it needs are passed in), so it runs under `bun test`;
 * `index.ts` wires the real ones.
 */

/** Seconds are not needed: the notice only says that it happened. */
export interface RepairNotice {
  kind: 'repaired' | 'recreated' | 'failed';
  /** Rows could not be read: the cloud and the watch have to fill them in again. */
  lost: boolean;
  /** The new database is prepared and goes in at the next start. */
  pendingSwap: boolean;
  /** Name of the kept copy of the damaged file, when one was made. */
  keptAs: string | null;
  at: number;
}

export interface DbHealthState {
  repairing: boolean;
  notice: RepairNotice | null;
}

export interface HealthDeps {
  recover(options: RecoveryOptions): Promise<RecoveryResult>;
  /** Pauses the app's queries; returns the function that lets them go on. */
  hold(): () => void;
  storage: { get(key: string): string | null; set(key: string, value: string | null): void };
  now(): number;
}

export const NOTICE_KEY = 'dbRecovery.notice';
export const SWAP_KEY = 'dbRecovery.swap';

/** After a repair, an error that looks like corruption does not start another one for this long (a retrying sync would loop). */
export const COOLDOWN_MS = 5 * 60 * 1000;

function noticeOf(result: RecoveryResult, now: number): RepairNotice | null {
  switch (result.kind) {
    case 'healthy':
      return null;
    case 'repaired':
      return { kind: 'repaired', lost: result.lost, pendingSwap: false, keptAs: result.keptAs, at: now };
    case 'recreated':
      return { kind: 'recreated', lost: true, pendingSwap: false, keptAs: result.keptAs, at: now };
    case 'failed':
      return { kind: 'failed', lost: false, pendingSwap: result.swapPending !== null, keptAs: result.keptAs, at: now };
  }
}

const field = (value: object, key: string): unknown => (key in value ? Reflect.get(value, key) : undefined);

function readNotice(raw: string | null): RepairNotice | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const kind = field(value, 'kind');
    if (kind !== 'repaired' && kind !== 'recreated' && kind !== 'failed') return null;
    const keptAs = field(value, 'keptAs');
    const at = field(value, 'at');
    return {
      kind,
      lost: field(value, 'lost') === true,
      pendingSwap: field(value, 'pendingSwap') === true,
      keptAs: typeof keptAs === 'string' ? keptAs : null,
      at: typeof at === 'number' ? at : 0,
    };
  } catch {
    return null;
  }
}

export interface DbHealth {
  getState(): DbHealthState;
  subscribe(listener: () => void): () => void;
  /** Looks at an error from any query (JS or native); starts a repair when it is corruption and none ran lately. */
  report(error: unknown): void;
  /** Runs the repair now, or joins the one that is running. */
  repair(options?: RecoveryOptions): Promise<RecoveryResult>;
  /** The person has read the notice. */
  dismiss(): void;
  /** The file name of a prepared database that is waiting to be swapped in, or null. */
  pendingSwap(): string | null;
  /** Forgets the pending swap after it was applied or found missing. */
  clearPendingSwap(): void;
}

export function createDbHealth(deps: HealthDeps): DbHealth {
  let state: DbHealthState = { repairing: false, notice: readNotice(deps.storage.get(NOTICE_KEY)) };
  let running: Promise<RecoveryResult> | null = null;
  let lastRunAt = -Infinity;
  const listeners = new Set<() => void>();

  const set = (next: DbHealthState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const run = async (options: RecoveryOptions): Promise<RecoveryResult> => {
    set({ ...state, repairing: true });
    const release = deps.hold();
    let result: RecoveryResult;
    try {
      result = await deps.recover(options);
    } catch (e) {
      // recoverDatabase does not throw; a wiring error must not leave the app paused or the notice spinning.
      result = { kind: 'failed', keptAs: null, reason: e instanceof Error ? e.message : String(e), swapPending: null };
    } finally {
      release();
    }
    lastRunAt = deps.now();
    const notice = noticeOf(result, lastRunAt);
    if (result.kind === 'failed') deps.storage.set(SWAP_KEY, result.swapPending);
    else if (result.kind !== 'healthy') deps.storage.set(SWAP_KEY, null);
    if (notice) deps.storage.set(NOTICE_KEY, JSON.stringify(notice));
    // A healthy result keeps the notice of an earlier repair; it only ends the spinner.
    set({ repairing: false, notice: notice ?? state.notice });
    return result;
  };

  const repair = (options: RecoveryOptions = {}): Promise<RecoveryResult> => {
    if (running === null) {
      running = run(options).finally(() => {
        running = null;
      });
    }
    return running;
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    report(error) {
      if (!isCorruptionError(error)) return;
      if (running !== null || deps.now() - lastRunAt < COOLDOWN_MS) return;
      void repair();
    },
    repair,
    dismiss() {
      deps.storage.set(NOTICE_KEY, null);
      set({ ...state, notice: null });
    },
    pendingSwap: () => deps.storage.get(SWAP_KEY),
    clearPendingSwap: () => deps.storage.set(SWAP_KEY, null),
  };
}

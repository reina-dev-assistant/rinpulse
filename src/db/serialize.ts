import type { SQLiteDatabase } from 'expo-sqlite';

import { BUSY_TIMEOUT_MS } from '@/db/migrations';
import { waitForHold } from '@/db/recovery/gate';
import { reportDatabaseError } from '@/db/recovery';
import { createTransactionLane } from '@/db/transactionLane';

/**
 * expo-sqlite on Android releases a statement's native object while another query on the same handle is still in
 * flight when several run at once (expo/expo#48995): "NativeDatabase.prepareAsync has been rejected ... Cannot use
 * shared object that was already released", an NPE, or a native crash. Large result sets make it likely, because the
 * garbage they leave makes Hermes collect statement wrappers sooner.
 *
 * Every query helper on the app's one handle is routed through a single promise chain, so only one statement is open
 * at a time. `withTransactionAsync` is not gated itself: it runs BEGIN, the task's own (gated) queries and COMMIT
 * through the gated methods, so gating it as a whole would deadlock its own queries. Remove this once expo-sqlite
 * serializes per handle.
 *
 * The same wrappers are where a damaged database file shows itself to the app: an error that says the file is corrupt goes to
 * the repair (`recovery/`), which also pauses the chain (`waitForHold`) while it rewrites the file. The two transaction
 * helpers are wrapped for that alone: the exclusive one runs on a connection of its own, outside the chain.
 */
const GATED = ['execAsync', 'runAsync', 'getFirstAsync', 'getAllAsync'] as const;
const TRANSACTIONS = ['withTransactionAsync', 'withExclusiveTransactionAsync'] as const;

/** Looks at a rejection without handling it: the caller still gets the error. */
function watch<T>(promise: Promise<T>): Promise<T> {
  promise.catch(reportDatabaseError);
  return promise;
}

interface TransactionConnection {
  execAsync(sql: string): Promise<void>;
}

/**
 * The connection of an exclusive transaction is a new one with no busy wait, and the native writer shares the file with a
 * really working lock (same SQLite library), so its first write would fail with SQLITE_BUSY while a sync is storing rows. The
 * wait is set before the task's first statement (BEGIN takes no lock yet).
 */
function waitForLocks(task: unknown): (txn: TransactionConnection) => Promise<unknown> {
  return async (txn) => {
    await txn.execAsync(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    return (task as (txn: TransactionConnection) => Promise<unknown>)(txn);
  };
}

export function serializeQueries(db: SQLiteDatabase): void {
  let tail: Promise<unknown> = Promise.resolve();
  for (const name of GATED) {
    const original = db[name].bind(db) as (...args: unknown[]) => Promise<unknown>;
    const gated = (...args: unknown[]) => {
      const call = async () => {
        await waitForHold();
        return original(...args);
      };
      const run = watch(tail.then(call, call));
      tail = run.catch(() => undefined);
      return run;
    };
    Object.defineProperty(db, name, { value: gated, configurable: true, writable: true });
  }
  // One transaction at a time on this handle (`transactionLane.ts`); the exclusive kind has a connection of its own and stays outside.
  const lane = createTransactionLane();
  for (const name of TRANSACTIONS) {
    const original = db[name].bind(db) as (...args: unknown[]) => Promise<unknown>;
    const wrapped =
      name === 'withExclusiveTransactionAsync'
        ? (...args: unknown[]) => watch(original(waitForLocks(args[0])))
        : (...args: unknown[]) => watch(lane(() => original(...args)));
    Object.defineProperty(db, name, { value: wrapped, configurable: true, writable: true });
  }
}

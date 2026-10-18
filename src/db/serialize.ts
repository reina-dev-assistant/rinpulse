import type { SQLiteDatabase } from 'expo-sqlite';

import { waitForHold } from '@/db/recovery/gate';
import { reportDatabaseError } from '@/db/recovery';

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
  for (const name of TRANSACTIONS) {
    const original = db[name].bind(db) as (...args: unknown[]) => Promise<unknown>;
    Object.defineProperty(db, name, { value: (...args: unknown[]) => watch(original(...args)), configurable: true, writable: true });
  }
}

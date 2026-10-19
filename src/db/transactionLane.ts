/**
 * One transaction at a time on the app's shared database handle. expo-sqlite's `withTransactionAsync` is BEGIN, the task, COMMIT on
 * that one connection, and its own docs say other work may interleave: two of them started in the same moment both send BEGIN and
 * the second fails with "cannot start a transaction within a transaction" (a restore from the cloud runs several at once). The
 * lane makes each whole transaction wait for the one before it. A transaction that is still waiting after `maxWaitMs` starts
 * anyway: the only way to wait that long is a task that started another transaction on the same handle and waits for it, which
 * can never finish, and a failed BEGIN is better than a frozen app.
 */
export type TransactionLane = <T>(run: () => Promise<T>) => Promise<T>;

export function createTransactionLane(maxWaitMs = 30_000): TransactionLane {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(run: () => Promise<T>): Promise<T> => {
    const ahead = tail;
    const mine = (async () => {
      let stopWaiting = () => {};
      const giveUp = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, maxWaitMs);
        stopWaiting = () => clearTimeout(timer);
      });
      await Promise.race([ahead.then(() => undefined, () => undefined), giveUp]);
      stopWaiting();
      return run();
    })();
    tail = mine.then(() => undefined, () => undefined);
    return mine;
  };
}

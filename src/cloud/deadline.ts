/**
 * Settles with `work`, or rejects with `onTimeout()` once `ms` have passed without it settling. `onTimeout` runs at that moment
 * and returns the error; it is also the place to cancel the work (abort a request). A native promise that is never resolved
 * and a fetch that ignores its abort signal both end here instead of leaving a spinner on screen.
 */
export function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  const { promise: expired, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => reject(onTimeout()), ms);
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

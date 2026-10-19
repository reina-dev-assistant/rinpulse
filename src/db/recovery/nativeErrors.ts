/**
 * Where an error of the native writer reaches JS. The Kotlin side (its own SQLite) is the first to meet a damaged `joyofit.db`:
 * the error is the rejection of a call (`onNativeCallError` in `@/wear`), or text in an event the module emits (the log of a failed
 * background sync, the link state, the scan state). Every one of them goes to `report`, which starts a repair only for corruption.
 * No native imports (the sources are passed in), so it runs under `bun test`.
 */

interface Subscription {
  remove(): void;
}

export interface NativeErrorSources {
  /** The module's `addListener`. */
  addListener(event: 'onLog' | 'onStateChange' | 'onScanStateChange', listener: (payload: NativeEventPayload) => void): Subscription;
  /** Errors thrown or rejected by calls into the module. */
  onCallError(listener: (error: unknown) => void): () => void;
}

/** The fields of the three events that can carry an error text. */
export interface NativeEventPayload {
  direction?: string;
  message?: string;
  error?: string | null;
}

/** Starts forwarding; returns the function that stops it. */
export function watchNativeErrors(sources: NativeErrorSources, report: (error: unknown) => void): () => void {
  const stops: (() => void)[] = [sources.onCallError(report)];
  const subscribe = (event: 'onLog' | 'onStateChange' | 'onScanStateChange', textOf: (payload: NativeEventPayload) => string | null | undefined) => {
    try {
      const subscription = sources.addListener(event, (payload) => {
        const text = textOf(payload);
        if (text) report(text);
      });
      stops.push(() => subscription.remove());
    } catch {
      // A binary without this event has nothing to forward.
    }
  };
  subscribe('onLog', (payload) => (payload.direction === 'error' ? payload.message : null));
  subscribe('onStateChange', (payload) => payload.error);
  subscribe('onScanStateChange', (payload) => payload.error);
  return () => {
    for (const stop of stops) stop();
  };
}

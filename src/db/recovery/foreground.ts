/**
 * Work that touches or replaces the database file (the start check, the repair, the swap of a prepared file) runs only while
 * the app is in the foreground. A background launch (iOS: Bluetooth state restoration or a background fetch; Android: the
 * foreground service starting the process) runs the JS too, with a locked phone on iOS: files under data protection cannot be
 * read then, a long scan of the database gets the process killed, and nothing a person could answer is on the screen.
 * No native imports (the source is passed in), so it runs under `bun test`.
 */

export interface AppStateSource {
  /** `active`, `inactive`, `background` or `unknown`. */
  current(): string;
  /** Calls the listener with every new state; returns the function that stops it. */
  onChange(listener: (state: string) => void): () => void;
}

export interface ForegroundScheduler {
  /** Runs `job` now when the app is active, else once when it becomes active. A job with the same key that is already waiting is not queued twice. */
  run(key: string, job: () => void): void;
  /** True while the app is active. */
  isActive(): boolean;
}

export function createForegroundScheduler(source: AppStateSource): ForegroundScheduler {
  const waiting = new Map<string, () => void>();
  let stop: (() => void) | null = null;

  const flush = (state: string) => {
    if (state !== 'active') return;
    stop?.();
    stop = null;
    const jobs = [...waiting.values()];
    waiting.clear();
    for (const job of jobs) job();
  };

  return {
    isActive: () => source.current() === 'active',
    run(key, job) {
      if (source.current() === 'active') {
        job();
        return;
      }
      waiting.set(key, job);
      stop ??= source.onChange(flush);
    },
  };
}

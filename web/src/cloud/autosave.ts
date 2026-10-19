/**
 * Debounced, single-flight scheduler for the cloud autosave. It knows nothing about the editor or the network: `touch()` says
 * "an edit happened", `save()` does the write and reports how it went.
 *
 * - The write starts `delayMs` after the last edit.
 * - Never two writes at once: an edit that lands while one is in flight queues exactly one more write, which starts when the
 *   first one succeeds (it reads the latest state, so one is enough).
 * - A conflict stops it until `resume()`; a failure only drops the queued write, the next edit tries again.
 */
export type SaveOutcome = "ok" | "conflict" | "error";

export interface AutosaveOptions {
  delayMs: number;
  save: () => Promise<SaveOutcome>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface Autosave {
  /** An edit happened: (re)starts the countdown. Ignored while paused. */
  touch: () => void;
  /** Drops the countdown and the queued write; a write in flight finishes. */
  cancel: () => void;
  /** Lets `touch()` work again after a conflict. */
  resume: () => void;
  readonly paused: boolean;
  /** A write is in flight. */
  readonly busy: boolean;
}

export function createAutosave(options: AutosaveOptions): Autosave {
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let timer: unknown;
  let running = false;
  let queued = false;
  let paused = false;

  async function run(): Promise<void> {
    running = true;
    queued = false;
    let outcome: SaveOutcome;
    try {
      outcome = await options.save();
    } catch {
      outcome = "error";
    }
    running = false;
    if (outcome === "conflict") {
      paused = true;
      queued = false;
    } else if (outcome === "ok" && queued) {
      await run();
    } else {
      queued = false;
    }
  }

  const fire = () => {
    timer = undefined;
    if (running) queued = true;
    else void run();
  };

  return {
    touch() {
      if (paused) return;
      if (timer !== undefined) clearTimer(timer);
      timer = setTimer(fire, options.delayMs);
    },
    cancel() {
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
      queued = false;
    },
    resume() {
      paused = false;
    },
    get paused() {
      return paused;
    },
    get busy() {
      return running;
    },
  };
}

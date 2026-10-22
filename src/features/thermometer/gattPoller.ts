import type { GattResult } from './gattRead';

/** One connected read per sensor per this long while the app is open: each read keeps the sensor's radio busy for several seconds. */
export const GATT_INTERVAL_MS = 10 * 60_000;
/** After a failed read the next try comes sooner than a full interval but backs off: 2, 4, 8 minutes, then every interval. */
export const GATT_RETRY_BASE_MS = 2 * 60_000;

export const gattBackoffMs = (failures: number): number => Math.min(GATT_INTERVAL_MS, GATT_RETRY_BASE_MS * 2 ** Math.max(0, failures - 1));

export interface GattPollerDeps {
  now(): number;
  /** Connects and reads one sample. Never rejects (see `readLywsdOnce`). */
  read(id: string): Promise<GattResult>;
  /** Called after every read, whether or not it worked; the caller stores the sample. */
  onResult(id: string, result: GattResult, at: number): void | Promise<void>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/**
 * Reads the stock-firmware thermometers over GATT on a schedule: now (when the newest sample is older than an interval), then every
 * {@link GATT_INTERVAL_MS}, one read at a time, with a backoff after a failure. It runs only between `start` and `stop`: the app starts it
 * while it is in the foreground and stops it in the background, so it costs the sensor's battery nothing while the phone is in a pocket.
 * Holds no I/O of its own.
 */
export class GattPoller {
  private ids: string[] = [];
  private readonly nextAt = new Map<string, number>();
  private readonly failures = new Map<string, number>();
  private timer: unknown = null;
  private running = false;
  private busy: Promise<void> = Promise.resolve();

  constructor(private readonly deps: GattPollerDeps) {}

  /** Starts (or retargets) the polling. `lastSampleAt` maps a sensor to the time of its newest stored sample, so a restart does not read at once. */
  start(ids: readonly string[], lastSampleAt: ReadonlyMap<string, number>): void {
    this.ids = [...ids];
    for (const id of [...this.nextAt.keys()]) if (!this.ids.includes(id)) this.nextAt.delete(id);
    for (const id of this.ids) {
      if (!this.nextAt.has(id)) this.nextAt.set(id, (lastSampleAt.get(id) ?? Number.NEGATIVE_INFINITY) + GATT_INTERVAL_MS);
    }
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  /** Reads one sensor now (the "read now" button), after any read in progress. Resolves with its result. */
  readNow(id: string): Promise<GattResult> {
    const run = this.busy.then(() => this.readOne(id));
    this.busy = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async readOne(id: string): Promise<GattResult> {
    const result = await this.deps.read(id);
    const at = this.deps.now();
    if (result.ok) {
      this.failures.delete(id);
      this.nextAt.set(id, at + GATT_INTERVAL_MS);
    } else {
      const n = (this.failures.get(id) ?? 0) + 1;
      this.failures.set(id, n);
      this.nextAt.set(id, at + gattBackoffMs(n));
    }
    await this.deps.onResult(id, result, at);
    return result;
  }

  private schedule(): void {
    if (!this.running) return;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    const times = this.ids.map((id) => this.nextAt.get(id) ?? 0);
    if (times.length === 0) {
      this.timer = null;
      return;
    }
    const wait = Math.max(0, Math.min(...times) - this.deps.now());
    this.timer = this.deps.setTimer(() => void this.tick(), wait);
  }

  private async tick(): Promise<void> {
    this.timer = null;
    for (const id of this.ids) {
      if (!this.running) return;
      if ((this.nextAt.get(id) ?? 0) <= this.deps.now()) await this.readNow(id);
    }
    this.schedule();
  }
}

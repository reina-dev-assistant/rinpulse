/**
 * The live side of a strength session's heart rate strap: connects the strap, feeds its notifications to the `HrCollector`, takes a
 * sample every `HR_SAMPLE_SEC`, journals them and keeps the BLE link alive with the native workout session (an Android foreground
 * service; without GPS). One session at most, for the whole app: it keeps running when the logger screen is minimized and ends when
 * the workout is finished or discarded (`end`).
 *
 * Framework-free (no React, no Expo imports): the hub, the native session and the clock are injected so it runs under bun test.
 * `useStrengthHr.ts` is the React side (permission step, chip).
 */
import type { ValueEvent, WorkoutSessionOptions } from '../../../modules/ble-sensors/src/BleSensors.types';
import type { EnergyProfile } from '../record/energy';
import type { JournalDb } from '../record/journal';
import type { WorkoutSensor } from '../sensors/store';
import { clearHrJournal, HR_FLUSH_SEC, HrCollector, loadHrJournal, saveHrJournal, strapResult, type StrapResult } from './hr';
import type { StrengthWorkout } from './types';

export interface HrSessionDeps {
  hub: {
    onValue(listener: (e: ValueEvent) => void): () => void;
    connect(id: string): Promise<void>;
    disconnect(id: string): Promise<void>;
  };
  session: { start(options: WorkoutSessionOptions): Promise<void>; end(): Promise<void> };
  now: () => number;
  log?: (message: string) => void;
}

export interface HrSessionSnapshot {
  /** The workout the strap is recording for; null while no session runs. */
  workoutId: string | null;
  sensorId: string | null;
  /** The heart rate right now; null without contact or while the strap is silent. */
  hr: number | null;
  /** The code of the last failed connect (ERR_BLUETOOTH_OFF, ...), null while fine. */
  error: string | null;
}

const IDLE: HrSessionSnapshot = { workoutId: null, sensorId: null, hr: null, error: null };

const codeOf = (error: unknown): string => String((error as { code?: unknown } | null)?.code ?? '');

export interface HrBeginOptions {
  db: JournalDb;
  workoutId: string;
  sensor: WorkoutSensor;
  /** Android notification of the foreground service. */
  title: string;
  text: string;
}

export class StrengthHrSession {
  private snap: HrSessionSnapshot = IDLE;
  private readonly listeners = new Set<() => void>();
  private collector: HrCollector | null = null;
  private db: JournalDb | null = null;
  private sensor: WorkoutSensor | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private off: (() => void) | null = null;
  /** Follows the workout's stopwatch (set by the logger screen, also before `begin`). */
  private paused = false;
  private ticks = 0;
  /** The strap was heard at least once in this session. */
  private used = false;
  /** Journal writes run one after the other. */
  private io: Promise<unknown> = Promise.resolve();
  /** `begin` and `end` of one session run one after the other. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: HrSessionDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): HrSessionSnapshot => this.snap;

  private publish(patch: Partial<HrSessionSnapshot>): void {
    const next = { ...this.snap, ...patch };
    if (next.workoutId === this.snap.workoutId && next.sensorId === this.snap.sensorId && next.hr === this.snap.hr && next.error === this.snap.error) return;
    this.snap = next;
    for (const l of this.listeners) l();
  }

  /**
   * Starts the strap for workout `workoutId`: restores the samples of the crash journal when it is the same workout, connects the strap
   * and starts the native session. Does nothing when this workout and strap are already running; another workout's session ends first.
   * The caller asked for the Bluetooth permission already. A failing connect or native session never throws: the workout goes on
   * without the strap (`snapshot.error` holds the code).
   */
  begin(options: HrBeginOptions): Promise<void> {
    const run = this.chain.then(() => this.start(options));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async start(options: HrBeginOptions): Promise<void> {
    if (this.snap.workoutId === options.workoutId && this.snap.sensorId === options.sensor.id) return;
    if (this.snap.workoutId !== null) await this.stop();
    const { db, workoutId, sensor } = options;
    const restored = await loadHrJournal(db, workoutId).catch(() => null);
    this.db = db;
    this.sensor = sensor;
    this.collector = new HrCollector(restored ?? []);
    this.ticks = 0;
    this.used = (restored?.length ?? 0) > 0;
    this.off = this.deps.hub.onValue((e) => {
      if (e.id === sensor.id && this.collector?.ingest(e.characteristic, e.value, e.ts)) this.used = true;
    });
    this.timer = setInterval(() => this.tick(), 1000);
    this.publish({ workoutId, sensorId: sensor.id, hr: null, error: null });
    try {
      await this.deps.session.start({ title: options.title, text: options.text, gps: false });
    } catch (error) {
      // ERR_SERVICE_NOT_ALLOWED: the foreground service was refused; the strap still works while the screen is on.
      if (codeOf(error) !== 'ERR_SERVICE_NOT_ALLOWED') this.deps.log?.(`strap: native session failed: ${String(error)}`);
    }
    try {
      await this.deps.hub.connect(sensor.id);
    } catch (error) {
      this.deps.log?.(`strap: connect failed: ${String(error)}`);
      this.publish({ error: codeOf(error) || String(error) });
    }
  }

  /** The stopwatch of the workout is paused: no samples are taken until it runs again. */
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** One second of the clock; also usable to catch up when the app comes back to the front. */
  tick(): void {
    const collector = this.collector;
    if (!collector) return;
    const now = this.deps.now();
    this.publish({ hr: collector.live(now) });
    if (this.paused) return;
    collector.tick(now);
    this.ticks += 1;
    if (this.ticks % HR_FLUSH_SEC === 0) this.flush();
  }

  private flush(): void {
    const { collector, db, sensor, snap } = this;
    if (!collector || !db || !sensor || snap.workoutId === null) return;
    const fresh = collector.drainNew();
    const meta = { workoutId: snap.workoutId, sensorId: sensor.id };
    const now = this.deps.now();
    this.io = this.io.then(() => saveHrJournal(db, fresh, meta, now)).catch((e) => this.deps.log?.(`strap journal write failed: ${String(e)}`));
  }

  /** The heart rate of the finished workout for `attachWorkoutRow`; null when no strap ran or it gave no heart rate. */
  result(workout: Pick<StrengthWorkout, 'exercises' | 'durationSec'>, profile: EnergyProfile): StrapResult | null {
    const { collector, sensor } = this;
    if (!collector || !sensor || !this.used) return null;
    return strapResult(collector.samples, workout, profile, [sensor]);
  }

  /** Resolves when the journal writes queued so far are done. */
  async settled(): Promise<void> {
    await this.io;
  }

  /** Ends the session: the native session, the strap's link and the journal. Safe to call when nothing runs. */
  end(): Promise<void> {
    const run = this.chain.then(() => this.stop());
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async stop(): Promise<void> {
    const { sensor, db } = this;
    clearInterval(this.timer ?? undefined);
    this.timer = null;
    this.off?.();
    this.off = null;
    this.collector = null;
    this.sensor = null;
    this.db = null;
    this.snap = IDLE;
    for (const l of this.listeners) l();
    if (!sensor) return;
    await this.io;
    if (db) await clearHrJournal(db).catch((e) => this.deps.log?.(`strap journal clear failed: ${String(e)}`));
    await this.deps.hub.disconnect(sensor.id).catch((e) => this.deps.log?.(`strap: disconnect failed: ${String(e)}`));
    await this.deps.session.end().catch((e) => this.deps.log?.(`strap: ending the native session failed: ${String(e)}`));
  }
}

/**
 * The strength logger's workout on the watch: when a session starts on the phone, the watch is told to start strength training too
 * (Huawei Health's phone-started workout, `modules/huawei-wear/.../WatchWorkout.kt`), is paused and resumed with the stopwatch and stopped
 * with the workout. The watch records heart rate and energy for that window; the next watch sync brings the workout and `link.ts` attaches
 * it to the logged one by overlap, as for a workout the person started on the watch by hand.
 *
 * Framework-free (no React, no Expo imports): the native module and the clock are injected so it runs under bun test. One session at most,
 * for the whole app; it outlives the logger screen (`watchWorkoutInstance.ts`). The calls are serialised, so a quick pause, resume and
 * finish reach the watch in that order.
 */
import type { WatchWorkoutOutcome, WatchWorkoutResult, WatchWorkoutStatus } from '../../../modules/huawei-wear/src/HuaweiWear.types';

export interface WatchWorkoutNative {
  getWatchWorkout(): WatchWorkoutStatus;
  startWatchWorkout(sport: number): Promise<WatchWorkoutResult>;
  pauseWatchWorkout(): Promise<WatchWorkoutResult>;
  resumeWatchWorkout(): Promise<WatchWorkoutResult>;
  stopWatchWorkout(): Promise<WatchWorkoutResult>;
}

/**
 * What the screens may offer. `unavailable`: this build has no such function (an older binary, or a platform without it) or no watch at all
 * is in the person's life: nothing to show. `offline`: a watch exists but is not connected now, so nothing is known about it yet.
 * `unsupported`: the connected watch does not list the command: an info line instead of the switch. `ready`: connected and listed.
 */
export type WatchWorkoutAvailability = 'unavailable' | 'offline' | 'unsupported' | 'ready';

export function watchWorkoutAvailability(native: WatchWorkoutNative | null, hasWatch: boolean): WatchWorkoutAvailability {
  if (native === null || !hasWatch) return 'unavailable';
  const status = native.getWatchWorkout();
  if (!status.connected) return 'offline';
  return status.supported ? 'ready' : 'unsupported';
}

/**
 * The notice text for a refused start (`strength` namespace): the watch said it is not on the wrist (`worn` false, read right after the
 * refusal), else the refusal with its code, else the plain refusal (iOS and older binaries give no code).
 */
export function refusedNoticeKey(code: number | null, worn: boolean | null): 'watch.notWorn' | 'watch.refusedCode' | 'watch.refused' {
  if (worn === false) return 'watch.notWorn';
  return code !== null ? 'watch.refusedCode' : 'watch.refused';
}

/**
 * A refusal the person cannot fix by putting the watch on: the watch said "no" while worn (or did not say it is not worn). On the Fit 4 Pro
 * (6.1.0.117) every `17/01` start, pause, resume and stop is refused with 123002 even for a workout started on the watch, so the
 * phone cannot control that watch's workouts (`docs/strength.md`). Such a refusal is remembered per watch and the start is not tried again.
 */
export function isGatedRefusal(outcome: WatchWorkoutOutcome | null, worn: boolean | null): boolean {
  return outcome === 'refused' && worn !== false;
}

/**
 * `idle`: nothing started (or the session is over). `starting`: the command is on its way. `running` / `paused`: the watch confirmed the
 * start. `unconfirmed`: the command went out and the watch did not confirm it (it may well be recording). `failed`: the watch is not
 * connected, refused, or does not support it. `lost`: the workout was started from the phone before the app restarted; the watch cannot be
 * controlled any more and is not told again.
 */
export type WatchSessionPhase = 'idle' | 'starting' | 'running' | 'paused' | 'unconfirmed' | 'failed' | 'lost';

export interface WatchSessionSnapshot {
  workoutId: string | null;
  phase: WatchSessionPhase;
  /** Why `failed`: the outcome the watch gave. */
  outcome: WatchWorkoutOutcome | null;
  /** The result code of a refusal (`outcome` `refused`), else null. */
  code: number | null;
  /** The wear state the watch reported right after a refusal: false is "not on the wrist"; null when it was not asked or did not say. */
  worn: boolean | null;
}

const IDLE: WatchSessionSnapshot = { workoutId: null, phase: 'idle', outcome: null, code: null, worn: null };

const snapshot = (
  workoutId: string | null,
  phase: WatchSessionPhase,
  outcome: WatchWorkoutOutcome | null = null,
  result: WatchWorkoutResult | null = null,
): WatchSessionSnapshot => ({ workoutId, phase, outcome, code: result?.code ?? null, worn: result?.worn ?? null });

export interface WatchSessionDeps {
  /** The native module, or null on a binary without the functions. */
  native: () => WatchWorkoutNative | null;
  log?: (message: string) => void;
}

export interface WatchBeginOptions {
  workoutId: string;
  /** Huawei sport code of the workout on the watch. */
  sport: number;
  /** The watch was already told to start for this workout (before an app restart). */
  startedBefore: boolean;
}

export class StrengthWatchSession {
  private snap: WatchSessionSnapshot = IDLE;
  private readonly listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  /** What the watch was last told, so a repeated `setPaused` sends nothing. */
  private told: 'running' | 'paused' | null = null;

  constructor(private readonly deps: WatchSessionDeps) {}

  getSnapshot = (): WatchSessionSnapshot => this.snap;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(next: WatchSessionSnapshot): void {
    this.snap = next;
    for (const listener of this.listeners) listener();
  }

  private run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Tells the watch to start the workout. Resolves with the phase it ended in; never rejects. */
  begin(options: WatchBeginOptions): Promise<WatchSessionPhase> {
    return this.run(async () => {
      const native = this.deps.native();
      const { workoutId } = options;
      if (native === null) {
        this.set(snapshot(workoutId, 'failed', 'unsupported'));
        return 'failed';
      }
      // The native side still owns a workout (the screens reloaded, the app did not restart): take it over instead of starting again.
      const open = native.getWatchWorkout();
      if (open.active) {
        this.told = open.state === 'paused' ? 'paused' : 'running';
        this.set(snapshot(workoutId, this.told));
        return this.told;
      }
      if (options.startedBefore) {
        this.deps.log?.(`watch workout for ${workoutId} was started before the app restarted; not started again`);
        this.set(snapshot(workoutId, 'lost'));
        return 'lost';
      }
      this.set(snapshot(workoutId, 'starting'));
      let result: WatchWorkoutResult;
      try {
        result = await native.startWatchWorkout(options.sport);
      } catch (e) {
        this.deps.log?.(`watch workout start failed: ${String((e as { message?: unknown } | null)?.message ?? e)}`);
        this.set(snapshot(workoutId, 'failed', 'sent'));
        return 'failed';
      }
      this.deps.log?.(
        `watch workout start: ${result.outcome}${result.code !== null ? ` (${result.code})` : ''}${result.worn === false ? ', watch not worn' : ''}`,
      );
      switch (result.outcome) {
        case 'confirmed':
          this.told = 'running';
          this.set(snapshot(workoutId, 'running', 'confirmed'));
          return 'running';
        case 'sent':
          this.told = 'running';
          this.set(snapshot(workoutId, 'unconfirmed', 'sent'));
          return 'unconfirmed';
        default:
          this.set(snapshot(workoutId, 'failed', result.outcome, result));
          return 'failed';
      }
    });
  }

  /** Follows the logger's stopwatch: paused true pauses the watch workout, false resumes it. */
  setPaused(paused: boolean): Promise<void> {
    return this.run(async () => {
      const { phase, workoutId } = this.snap;
      if (workoutId === null || (phase !== 'running' && phase !== 'paused' && phase !== 'unconfirmed')) return;
      const want = paused ? 'paused' : 'running';
      if (this.told === want) return;
      const native = this.deps.native();
      if (native === null) return;
      this.told = want;
      try {
        const result = await (paused ? native.pauseWatchWorkout() : native.resumeWatchWorkout());
        this.deps.log?.(`watch workout ${paused ? 'pause' : 'resume'}: ${result.outcome}`);
      } catch (e) {
        this.deps.log?.(`watch workout ${paused ? 'pause' : 'resume'} failed: ${String((e as { message?: unknown } | null)?.message ?? e)}`);
      }
      // The phase of a confirmed start follows the stopwatch; an unconfirmed one stays unconfirmed.
      if (this.snap.workoutId === workoutId && this.snap.phase !== 'unconfirmed') this.set({ ...this.snap, phase: want });
    });
  }

  /** Stops the workout on the watch (the workout was finished or discarded) and ends the session. Resolves when the watch has been told. */
  end(): Promise<void> {
    return this.run(async () => {
      const { phase } = this.snap;
      this.set(IDLE);
      this.told = null;
      if (phase === 'idle' || phase === 'failed' || phase === 'lost') return;
      const native = this.deps.native();
      if (native === null) return;
      try {
        const result = await native.stopWatchWorkout();
        this.deps.log?.(`watch workout stop: ${result.outcome}`);
      } catch (e) {
        this.deps.log?.(`watch workout stop failed: ${String((e as { message?: unknown } | null)?.message ?? e)}`);
      }
    });
  }
}

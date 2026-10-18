/**
 * The phone's side of "Main di web" / "Ride on the web": one ride room, from the six digit code to the end of the ride. Framework-free
 * (no React, no Expo imports): everything outside is injected, so the whole flow runs under bun test with a fake socket, fake clock and
 * fake recorder; `state/RideProvider.tsx` is the React shell around the one instance the app has.
 *
 * What it does while a room is joined:
 * - streams the live sensor values (from its own `SensorTracker`, fed by the sensor hub) as `s` frames, about 4 a second;
 * - starts the phone's recorder as an indoor ride (`prepare`, which connects the paired sensors and keeps the app alive), and keeps the
 *   recorder and the game in step: `ctl` from the game drives the recorder, a pause, resume, lap or start made on the phone is sent to
 *   the game, and the game's `st` speed feeds the recorder (`virtualSpeed`);
 * - keeps the game's `sum` (distance, climb, route, laps) for the save, and tells the relay with `ack` once the workout is saved;
 * - survives a bad connection: pings every 5 s (the relay answers `{"t":"pong"}`), drops a socket that heard nothing for 15 s, and
 *   reconnects with a growing wait, up to `MAX_ATTEMPTS` times, then waits for the person (`phase: 'lost'`).
 * The phone stays the source of truth: a `stop` from the game only pauses the recorder and raises `stopRequested`; the person saves.
 */
import type { ValueEvent } from '../../../modules/ble-sensors/src/BleSensors.types';
import type { RecordingSnapshot } from '../record/controller';
import { SensorTracker } from '../sensors/gatt';
import { RideJoinError, type RideError } from './errors';
import {
  LIMITS,
  PING_TEXT,
  PONG_TEXT,
  encode,
  parseMessage,
  type CtlAction,
  type JoinRoomResponse,
  type RideMsg,
  type SensorMsg,
  type StateMsg,
  type SumMsg,
} from './protocol';

export type RidePhase = 'idle' | 'joining' | 'connecting' | 'connected' | 'reconnecting' | 'lost' | 'ended';

export interface RideSnapshot {
  phase: RidePhase;
  code: string | null;
  /** Web viewers connected to the room (the game and spectators). */
  webs: number;
  /** Round trip to the relay in ms, null before the first pong. */
  latencyMs: number | null;
  /** The latest sensor values on the phone (null: nothing fresh). */
  hr: number | null;
  cad: number | null;
  /** The game's latest state frame, null before the first one or after it went quiet. */
  game: StateMsg | null;
  /** The game ended the ride (`ctl stop`): the screen asks to save. */
  stopRequested: boolean;
  /** The game's summary, kept for the save. */
  summary: SumMsg | null;
  /** Failed reconnect attempts in a row. */
  attempt: number;
  error: RideError | null;
}

/** The slice of the WebSocket API the session uses (React Native's and the browser's both fit). */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** What the session needs of `RecordingController`. */
export interface RecorderPort {
  subscribe(listener: () => void): () => void;
  getSnapshot(): RecordingSnapshot;
  prepare(sport: 'indoorRide', title: string): Promise<void>;
  cancel(): Promise<void>;
  start(): void;
  pause(): void;
  resume(): void;
  lap(): void;
  setVirtualSpeed(speedMps: number): void;
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RideDeps {
  join(code: string): Promise<JoinRoomResponse>;
  socketUrl(roomId: string, token: string): string;
  openSocket(url: string): SocketLike;
  hub: { onValue(listener: (e: ValueEvent) => void): () => void };
  recorder: RecorderPort;
  now: () => number;
  /** The rider's weight in kg, for the game's physics. */
  massKg: () => number;
  wheelCircumferenceM: () => number;
  /** "JoyoFit 1.4.0": the `app` of the hello. */
  app: string;
  /** Title of the recording's notification (Android). */
  title: () => string;
  scheduler?: Scheduler;
  /** Uniform in [0, 1); spreads reconnect waits. */
  random?: () => number;
  log?: (message: string) => void;
}

export const SAMPLE_INTERVAL_MS = 250;
export const PING_INTERVAL_MS = 5000;
/** A socket that heard nothing (not even a pong) for this long is dead, whatever it claims. */
export const SILENCE_MS = 15_000;
export const RECONNECT_BASE_MS = 500;
export const RECONNECT_MAX_MS = 15_000;
export const MAX_ATTEMPTS = 20;
/** After the person ends the ride on the phone, how long the game gets to send its summary. */
export const SUMMARY_WAIT_MS = 4000;
/** The game's `st` frames come about once a second; older than this and it is not playing. */
const GAME_FRESH_MS = 6000;
/** Snapshot updates caused by sensor values are throttled to this. */
const PUBLISH_MS = 1000;

const CLOSE_REPLACED = 4001;
const CLOSE_EXPIRED = 4002;
const CLOSE_POLICY = 1008;

const defaultScheduler: Scheduler = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

function idleSnapshot(): RideSnapshot {
  return { phase: 'idle', code: null, webs: 0, latencyMs: null, hr: null, cad: null, game: null, stopRequested: false, summary: null, attempt: 0, error: null };
}

export class RideSession {
  private snap: RideSnapshot = idleSnapshot();
  private readonly listeners = new Set<() => void>();
  private readonly scheduler: Scheduler;
  private room: JoinRoomResponse | null = null;
  private socket: SocketLike | null = null;
  private tracker: SensorTracker | null = null;
  private offHub: (() => void) | null = null;
  private offRecorder: (() => void) | null = null;
  private sampleTimer: unknown = null;
  private pingTimer: unknown = null;
  private reconnectTimer: unknown = null;
  private pingSentAt = 0;
  private lastHeardAt = 0;
  private lastPublishAt = 0;
  private gameAt = 0;
  /** The game ended the ride; `requestStop` does not send another stop. */
  private gameStopped = false;
  /** The next recorder changes are the game's doing: not echoed back. */
  private applyingRemote = false;
  private prepared = false;
  private prev: { phase: string; status: string; laps: number };
  private summaryWaiters: ((sum: SumMsg | null) => void)[] = [];
  /** Bumped by `join` and `leave`: the answers of an older join are ignored. */
  private session = 0;
  /** Bumped on every socket and on `leave`: callbacks of an older socket are ignored. */
  private generation = 0;

  constructor(private readonly deps: RideDeps) {
    this.scheduler = deps.scheduler ?? defaultScheduler;
    const recorder = deps.recorder.getSnapshot();
    this.prev = { phase: recorder.phase, status: recorder.status, laps: recorder.laps.length };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RideSnapshot => this.snap;

  private publish(patch: Partial<RideSnapshot> = {}): void {
    this.snap = { ...this.snap, ...patch };
    this.lastPublishAt = this.deps.now();
    for (const l of this.listeners) l();
  }

  private log(message: string): void {
    this.deps.log?.(`ride: ${message}`);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // joining and leaving

  /** Joins the room with this code, opens the socket and gets the recorder ready. Failures end in `snapshot.error`, never a throw. */
  async join(code: string): Promise<void> {
    if (this.snap.phase !== 'idle' && this.snap.phase !== 'ended' && this.snap.phase !== 'lost') return;
    this.detach();
    this.gameStopped = false;
    this.publish({ ...idleSnapshot(), phase: 'joining', code });
    const session = ++this.session;
    try {
      this.room = await this.deps.join(code);
    } catch (error) {
      if (session !== this.session) return;
      const kind = error instanceof RideJoinError ? error.kind : 'network';
      this.publish({ ...idleSnapshot(), error: { kind, detail: error instanceof Error ? error.message : String(error) } });
      return;
    }
    if (session !== this.session) return;
    const recorder = this.deps.recorder.getSnapshot();
    if (recorder.phase !== 'idle' && recorder.sport !== 'indoorRide') {
      this.room = null;
      this.publish({ ...idleSnapshot(), error: { kind: 'busy' } });
      return;
    }
    this.tracker = new SensorTracker(this.deps.wheelCircumferenceM());
    this.offHub = this.deps.hub.onValue((e) => {
      this.tracker?.ingest(e.characteristic.toLowerCase(), e.value, e.ts);
    });
    this.prev = { phase: recorder.phase, status: recorder.status, laps: recorder.laps.length };
    this.offRecorder = this.deps.recorder.subscribe(() => this.recorderChanged());
    this.connect();
    if (recorder.phase === 'idle') void this.prepareRecorder(session);
  }

  private async prepareRecorder(session: number): Promise<void> {
    try {
      await this.deps.recorder.prepare('indoorRide', this.deps.title());
      this.prepared = true;
      if (session !== this.session) await this.deps.recorder.cancel().catch(() => {});
    } catch (error) {
      if (session !== this.session) return;
      this.log(`recorder prepare failed: ${String(error)}`);
      this.publish({ error: { kind: 'prepare', detail: error instanceof Error ? error.message : String(error) } });
    }
  }

  /** Leaves the room. A recording that already started keeps running (it is an ordinary indoor ride from here); one that was only getting ready is cancelled. */
  async leave(): Promise<void> {
    this.session++;
    this.generation++;
    this.settleSummary(null);
    this.close(1000, 'bye');
    this.detach();
    const wasPrepared = this.prepared;
    this.prepared = false;
    this.room = null;
    this.publish({ ...idleSnapshot() });
    if (wasPrepared && this.deps.recorder.getSnapshot().phase === 'ready') await this.deps.recorder.cancel().catch((e) => this.log(`cancel failed: ${String(e)}`));
  }

  private detach(): void {
    this.offHub?.();
    this.offHub = null;
    this.offRecorder?.();
    this.offRecorder = null;
    this.tracker = null;
    this.stopLoops();
    this.scheduler.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // socket

  private connect(): void {
    const room = this.room;
    if (!room) return;
    const generation = ++this.generation;
    this.publish({ phase: this.snap.attempt > 0 ? 'reconnecting' : 'connecting' });
    const socket = this.deps.openSocket(this.deps.socketUrl(room.roomId, room.token));
    this.socket = socket;
    socket.onopen = () => {
      if (generation !== this.generation) return;
      this.lastHeardAt = this.deps.now();
      this.send({ t: 'hello', v: 1, role: 'phone', app: this.deps.app, massKg: Math.min(LIMITS.massKg.max, Math.max(LIMITS.massKg.min, this.deps.massKg())) });
      this.publish({ phase: 'connected', attempt: 0, error: this.snap.error?.kind === 'prepare' ? this.snap.error : null });
      this.startLoops(generation);
      this.sendPing();
    };
    socket.onmessage = (event) => {
      if (generation !== this.generation || typeof event.data !== 'string') return;
      this.lastHeardAt = this.deps.now();
      this.receive(event.data);
    };
    socket.onclose = (event) => {
      if (generation !== this.generation) return;
      this.closed(event.code, event.reason ?? '');
    };
    socket.onerror = () => {
      // `onclose` follows and does the work
    };
  }

  private close(code: number, reason: string): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try {
      socket.close(code, reason);
    } catch {
      // already closed
    }
  }

  private closed(code: number, reason: string): void {
    this.stopLoops();
    this.socket = null;
    this.publish({ webs: 0, latencyMs: null });
    if (code === CLOSE_REPLACED || code === CLOSE_EXPIRED || code === CLOSE_POLICY) {
      this.log(`closed by the relay: ${code} ${reason}`);
      this.settleSummary(null);
      this.publish({ phase: 'ended', error: { kind: code === CLOSE_REPLACED ? 'replaced' : code === CLOSE_EXPIRED ? 'expired' : 'policy' } });
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const attempt = this.snap.attempt;
    if (attempt >= MAX_ATTEMPTS) {
      this.publish({ phase: 'lost', error: { kind: 'lost' } });
      return;
    }
    const spread = 0.8 + 0.4 * (this.deps.random ?? Math.random)();
    const wait = Math.round(Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt) * spread);
    this.publish({ phase: 'reconnecting', attempt: attempt + 1 });
    this.log(`reconnecting in ${wait} ms (attempt ${attempt + 1})`);
    this.reconnectTimer = this.scheduler.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, wait);
  }

  /** After `lost`: tries again from a fresh count. */
  reconnect(): void {
    if (this.snap.phase !== 'lost' || !this.room) return;
    this.publish({ attempt: 0, error: null });
    this.connect();
  }

  private send(msg: RideMsg): void {
    try {
      this.socket?.send(encode(msg));
    } catch (error) {
      this.log(`send failed: ${String(error)}`);
    }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // loops

  private startLoops(generation: number): void {
    this.stopLoops();
    const sample = () => {
      if (generation !== this.generation) return;
      this.sample();
      this.sampleTimer = this.scheduler.setTimeout(sample, SAMPLE_INTERVAL_MS);
    };
    const ping = () => {
      if (generation !== this.generation) return;
      if (this.deps.now() - this.lastHeardAt > SILENCE_MS) {
        this.log('no word from the relay; dropping the socket');
        this.close(4000, 'silent');
        this.closed(1006, 'silent');
        return;
      }
      this.sendPing();
      this.pingTimer = this.scheduler.setTimeout(ping, PING_INTERVAL_MS);
    };
    this.sampleTimer = this.scheduler.setTimeout(sample, SAMPLE_INTERVAL_MS);
    this.pingTimer = this.scheduler.setTimeout(ping, PING_INTERVAL_MS);
  }

  private stopLoops(): void {
    this.scheduler.clearTimeout(this.sampleTimer);
    this.scheduler.clearTimeout(this.pingTimer);
    this.sampleTimer = null;
    this.pingTimer = null;
  }

  private sendPing(): void {
    this.pingSentAt = this.deps.now();
    try {
      this.socket?.send(PING_TEXT);
    } catch {
      // the close handler deals with it
    }
  }

  private sample(): void {
    const tracker = this.tracker;
    if (!tracker) return;
    const now = this.deps.now();
    const r = tracker.read(now);
    const msg: SensorMsg = { t: 's', v: 1, ts: now };
    if (r.hr !== undefined) msg.hr = r.hr;
    if (r.cadenceRpm !== undefined) msg.cad = Math.round(r.cadenceRpm * 10) / 10;
    if (r.speedMps !== undefined) msg.spd = Math.round(r.speedMps * 100) / 100;
    if (r.watts !== undefined) msg.pwr = r.watts;
    if (r.rrMs && r.rrMs.length > 0) msg.rr = r.rrMs.slice(-LIMITS.rrMs.maxCount).map(Math.round);
    const hr = msg.hr ?? null;
    const cad = msg.cad ?? null;
    if (hr !== this.snap.hr || cad !== this.snap.cad) {
      // sensor numbers on the screen move once a second, not 4 times
      if (now - this.lastPublishAt >= PUBLISH_MS || (hr === null) !== (this.snap.hr === null) || (cad === null) !== (this.snap.cad === null)) this.publish({ hr, cad });
    }
    if (this.snap.game && now - this.gameAt > GAME_FRESH_MS) this.publish({ game: null });
    if (msg.hr !== undefined || msg.cad !== undefined || msg.spd !== undefined || msg.pwr !== undefined) this.send(msg);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // frames from the relay

  private receive(text: string): void {
    if (text === PONG_TEXT) {
      this.publish({ latencyMs: Math.max(0, this.deps.now() - this.pingSentAt) });
      return;
    }
    const parsed = parseMessage(text);
    if (!parsed.ok) {
      this.log(`unreadable frame: ${parsed.reason}`);
      return;
    }
    const msg = parsed.msg;
    switch (msg.t) {
      case 'room':
        this.publish({ webs: msg.webs });
        break;
      case 'ctl':
        this.remote(msg.action);
        break;
      case 'st':
        this.gameAt = this.deps.now();
        this.deps.recorder.setVirtualSpeed(msg.vKmh / 3.6);
        this.publish({ game: msg });
        break;
      case 'sum':
        this.publish({ summary: msg });
        this.settleSummary(msg);
        break;
      case 'err':
        this.log(`relay error: ${msg.code}`);
        break;
      default:
        break;
    }
  }

  /** The game asks the recorder for something. */
  private remote(action: CtlAction): void {
    const recorder = this.deps.recorder;
    const snapshot = recorder.getSnapshot();
    this.applyingRemote = true;
    try {
      switch (action) {
        case 'start':
          if (snapshot.phase === 'ready') recorder.start();
          else if (snapshot.phase === 'active' && snapshot.status === 'paused') recorder.resume();
          break;
        case 'pause':
          if (snapshot.phase === 'active' && snapshot.status === 'recording') recorder.pause();
          break;
        case 'resume':
          if (snapshot.phase === 'active' && snapshot.status === 'paused') recorder.resume();
          break;
        case 'lap':
          if (snapshot.phase === 'active' && snapshot.status === 'recording') recorder.lap();
          break;
        case 'stop':
          this.gameStopped = true;
          if (snapshot.phase === 'active' && snapshot.status === 'recording') recorder.pause();
          this.publish({ stopRequested: true });
          break;
      }
    } finally {
      this.applyingRemote = false;
      const after = recorder.getSnapshot();
      this.prev = { phase: after.phase, status: after.status, laps: after.laps.length };
    }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // the recorder's changes on the phone, told to the game

  private recorderChanged(): void {
    const now = this.deps.recorder.getSnapshot();
    const prev = this.prev;
    this.prev = { phase: now.phase, status: now.status, laps: now.laps.length };
    if (this.applyingRemote) return;
    if (now.phase === 'active' && prev.phase !== 'active') this.control('start');
    else if (now.phase === 'active' && prev.status === 'recording' && now.status === 'paused') this.control('pause');
    else if (now.phase === 'active' && prev.status === 'paused' && now.status === 'recording') this.control('resume');
    else if (now.phase === 'active' && now.laps.length > prev.laps) this.control('lap');
  }

  private control(action: CtlAction): void {
    this.send({ t: 'ctl', v: 1, action });
  }

  // -------------------------------------------------------------------------------------------------------------------
  // what the screen asks for

  /** One gear harder (1) or easier (-1) in the game. */
  gear(d: 1 | -1): void {
    this.send({ t: 'gear', v: 1, d });
  }

  /** Starts the recording (the game is told by the change in the recorder). */
  start(): void {
    if (this.deps.recorder.getSnapshot().phase === 'ready') this.deps.recorder.start();
  }

  /**
   * The person ends the ride on the phone: the game is told to stop (unless it already did) and gets `SUMMARY_WAIT_MS` to send its
   * summary. Resolves with it, or null when none came (the ride is saved with the recorder's numbers).
   */
  requestStop(): Promise<SumMsg | null> {
    if (this.snap.summary) return Promise.resolve(this.snap.summary);
    this.endGame();
    if (this.snap.phase !== 'connected' || this.snap.webs === 0) return Promise.resolve(null);
    const { promise, resolve } = Promise.withResolvers<SumMsg | null>();
    const timer = this.scheduler.setTimeout(() => this.settleSummary(null), SUMMARY_WAIT_MS);
    this.summaryWaiters.push((sum) => {
      this.scheduler.clearTimeout(timer);
      resolve(sum);
    });
    return promise;
  }

  /** Tells the game the ride is over (once). The phone throwing a ride away does this too, so the game does not play on. */
  endGame(): void {
    if (this.gameStopped) return;
    this.gameStopped = true;
    this.control('stop');
  }

  private settleSummary(sum: SumMsg | null): void {
    for (const waiter of this.summaryWaiters.splice(0)) waiter(sum);
  }

  /** The workout was saved (or thrown away): the relay can forget the summary. */
  confirmSummary(): void {
    if (this.snap.summary) this.send({ t: 'ack', v: 1, of: 'sum' });
    this.publish({ summary: null, stopRequested: false });
    this.gameStopped = false;
  }

  /** The person went on after the game's stop request (kept pedalling): the request is dropped. */
  dismissStop(): void {
    this.publish({ stopRequested: false });
  }
}

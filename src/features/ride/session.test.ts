import { describe, expect, it } from 'bun:test';

import type { ValueEvent } from '../../../modules/ble-sensors/src/BleSensors.types';
import type { RecordingSnapshot } from '../record/controller';
import { bytesToHex } from '../sensors/gatt';
import { RideJoinError } from './errors';
import { PING_TEXT, PONG_TEXT, type RideMsg } from './protocol';
import {
  MAX_ATTEMPTS,
  PING_INTERVAL_MS,
  RECONNECT_BASE_MS,
  SAMPLE_INTERVAL_MS,
  SILENCE_MS,
  SUMMARY_WAIT_MS,
  RideSession,
  type RecorderPort,
  type Scheduler,
  type SocketLike,
} from './session';

// ---------------------------------------------------------------------------------------------------------------------
// fakes

class FakeClock implements Scheduler {
  now = 1_760_000_000_000;
  private next = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Runs every timer due within `ms`, in order, moving the clock as it goes. */
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let due: [number, { at: number; fn: () => void }] | null = null;
      for (const entry of this.timers) if (entry[1].at <= end && (due === null || entry[1].at < due[1].at)) due = entry;
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = Math.max(this.now, due[1].at);
      due[1].fn();
    }
    this.now = end;
  }

  get pending(): number {
    return this.timers.size;
  }
}

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason?: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  sent: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
  }

  open(): void {
    this.onopen?.();
  }

  receive(msg: RideMsg | string): void {
    this.onmessage?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) });
  }

  drop(code = 1006): void {
    this.onclose?.({ code, reason: '' });
  }

  frames(type?: string): Record<string, unknown>[] {
    return this.sent.filter((s) => s !== PING_TEXT).map((s) => JSON.parse(s) as Record<string, unknown>).filter((f) => type === undefined || f.t === type);
  }
}

function recorderSnapshot(patch: Partial<RecordingSnapshot> = {}): RecordingSnapshot {
  return { phase: 'idle', sport: null, gps: false, warm: false, status: 'idle', live: null, laps: [], sensorIds: [], fix: null, noService: false, sensorError: null, ...patch } as RecordingSnapshot;
}

class FakeRecorder implements RecorderPort {
  snap = recorderSnapshot();
  listeners = new Set<() => void>();
  calls: string[] = [];
  virtualSpeeds: number[] = [];
  prepareError: Error | null = null;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.snap;

  private set(patch: Partial<RecordingSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of [...this.listeners]) l();
  }

  async prepare(sport: 'indoorRide', title: string): Promise<void> {
    this.calls.push(`prepare:${sport}:${title}`);
    if (this.prepareError) throw this.prepareError;
    this.set({ phase: 'ready', sport });
  }
  async cancel(): Promise<void> {
    this.calls.push('cancel');
    this.set({ phase: 'idle', sport: null });
  }
  start(): void {
    this.calls.push('start');
    this.set({ phase: 'active', status: 'recording' });
  }
  pause(): void {
    this.calls.push('pause');
    this.set({ status: 'paused' });
  }
  resume(): void {
    this.calls.push('resume');
    this.set({ status: 'recording' });
  }
  lap(): void {
    this.calls.push('lap');
    this.set({ laps: [...this.snap.laps, {} as never] });
  }
  setVirtualSpeed(speedMps: number): void {
    this.virtualSpeeds.push(speedMps);
  }
  /** What the person does on the phone: the same transitions without the session asking. */
  local(action: 'start' | 'pause' | 'resume' | 'lap') {
    this[action]();
  }
}

class FakeHub {
  listeners = new Set<(e: ValueEvent) => void>();
  onValue(l: (e: ValueEvent) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  emit(characteristic: string, hex: string, ts: number) {
    for (const l of this.listeners) l({ id: 'sensor-1', ts, service: '', characteristic, value: hex });
  }
}

const u16 = (v: number) => [v & 255, (v >>> 8) & 255];
/** A crank-only CSC value: `revs` crank revolutions at `time` (1/1024 s ticks). */
const crank = (revs: number, time: number) => bytesToHex(new Uint8Array([0x02, ...u16(revs), ...u16(time)]));
const heart = (bpm: number) => bytesToHex(new Uint8Array([0x00, bpm]));

function setup(options: { join?: () => Promise<{ roomId: string; token: string }>; recorder?: FakeRecorder } = {}) {
  const clock = new FakeClock();
  const hub = new FakeHub();
  const recorder = options.recorder ?? new FakeRecorder();
  const sockets: FakeSocket[] = [];
  const joins: string[] = [];
  const session = new RideSession({
    join: async (code) => {
      joins.push(code);
      return options.join ? options.join() : { roomId: 'room-1', token: 'tok-1' };
    },
    socketUrl: (roomId, token) => `wss://relay.test/ride/rooms/${roomId}/ws?role=phone&token=${token}`,
    openSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    hub,
    recorder,
    now: () => clock.now,
    massKg: () => 72,
    wheelCircumferenceM: () => 2.105,
    app: 'JoyoFit test',
    title: () => 'Indoor ride',
    scheduler: clock,
    random: () => 0.5,
  });
  const last = () => sockets[sockets.length - 1]!;
  return { session, clock, hub, recorder, sockets, joins, last };
}

/** Joined, socket open, recorder prepared. */
async function connected(options: Parameters<typeof setup>[0] = {}) {
  const env = setup(options);
  await env.session.join('123456');
  env.last().open();
  await Promise.resolve();
  return env;
}

// ---------------------------------------------------------------------------------------------------------------------

describe('joining', () => {
  it('joins by code, opens the phone socket, says hello with the rider mass and gets the recorder ready', async () => {
    const { session, sockets, joins, recorder, last } = setup();
    const join = session.join('123456');
    expect(session.getSnapshot()).toMatchObject({ phase: 'joining', code: '123456' });
    await join;
    expect(joins).toEqual(['123456']);
    expect(sockets).toHaveLength(1);
    expect(last().url).toBe('wss://relay.test/ride/rooms/room-1/ws?role=phone&token=tok-1');
    expect(session.getSnapshot().phase).toBe('connecting');
    last().open();
    expect(session.getSnapshot()).toMatchObject({ phase: 'connected', attempt: 0, error: null });
    expect(last().frames('hello')).toEqual([{ t: 'hello', v: 1, role: 'phone', app: 'JoyoFit test', massKg: 72 }]);
    expect(last().sent).toContain(PING_TEXT);
    await Promise.resolve();
    expect(recorder.calls).toEqual(['prepare:indoorRide:Indoor ride']);
    expect(recorder.snap.phase).toBe('ready');
  });

  it('keeps a failed join as an error and opens nothing', async () => {
    const { session, sockets } = setup({ join: () => Promise.reject(new RideJoinError('notFound')) });
    await session.join('000000');
    expect(session.getSnapshot()).toMatchObject({ phase: 'idle', error: { kind: 'notFound' } });
    expect(sockets).toHaveLength(0);
  });

  it('any other failure of the join is a network error', async () => {
    const { session } = setup({ join: () => Promise.reject(new TypeError('Network request failed')) });
    await session.join('000000');
    expect(session.getSnapshot().error).toMatchObject({ kind: 'network' });
  });

  it('refuses while another workout is being recorded', async () => {
    const recorder = new FakeRecorder();
    recorder.snap = recorderSnapshot({ phase: 'active', sport: 'run', status: 'recording' });
    const { session, sockets } = setup({ recorder });
    await session.join('123456');
    expect(session.getSnapshot()).toMatchObject({ phase: 'idle', error: { kind: 'busy' } });
    expect(sockets).toHaveLength(0);
  });

  it('takes over an indoor ride that is already being recorded without preparing again', async () => {
    const recorder = new FakeRecorder();
    recorder.snap = recorderSnapshot({ phase: 'active', sport: 'indoorRide', status: 'recording' });
    const { session, last } = setup({ recorder });
    await session.join('123456');
    last().open();
    expect(recorder.calls).toEqual([]);
    expect(session.getSnapshot().phase).toBe('connected');
  });

  it('shows a recorder that cannot get ready, and stays connected', async () => {
    const recorder = new FakeRecorder();
    recorder.prepareError = new Error('ERR_BLUETOOTH_OFF');
    const { session, last } = setup({ recorder });
    await session.join('123456');
    last().open();
    await Promise.resolve();
    await Promise.resolve();
    expect(session.getSnapshot()).toMatchObject({ phase: 'connected', error: { kind: 'prepare', detail: 'ERR_BLUETOOTH_OFF' } });
  });

  it('ignores a second join while one is under way', async () => {
    const { session, joins } = setup();
    const first = session.join('111111');
    await session.join('222222');
    await first;
    expect(joins).toEqual(['111111']);
  });

  it('leaving while the join is pending drops its answer', async () => {
    const pending = Promise.withResolvers<{ roomId: string; token: string }>();
    const { session, sockets } = setup({ join: () => pending.promise });
    const join = session.join('123456');
    await session.leave();
    pending.resolve({ roomId: 'r', token: 't' });
    await join;
    expect(sockets).toHaveLength(0);
    expect(session.getSnapshot().phase).toBe('idle');
  });
});

describe('streaming', () => {
  it('sends the sensor values four times a second with the fields that exist, and nothing without data', async () => {
    const { clock, hub, last } = await connected();
    clock.advance(SAMPLE_INTERVAL_MS);
    expect(last().frames('s')).toEqual([]);

    hub.emit('2a37', heart(131), clock.now);
    hub.emit('2a5b', crank(10, 1024), clock.now);
    hub.emit('2a5b', crank(11, 1024 + 683), clock.now + 700);
    clock.advance(SAMPLE_INTERVAL_MS);
    const [sample] = last().frames('s');
    expect(sample).toMatchObject({ t: 's', v: 1, ts: clock.now, hr: 131 });
    expect(sample!.cad as number).toBeGreaterThan(80);
    expect(sample!.cad as number).toBeLessThan(95);
    expect('pwr' in sample!).toBe(false);
    expect('spd' in sample!).toBe(false);

    last().sent.length = 0;
    clock.advance(1000);
    expect(last().frames('s')).toHaveLength(4);
  });

  it('carries RR intervals once and never more than the protocol allows', async () => {
    const { clock, hub, last } = await connected();
    hub.emit('2a37', bytesToHex(new Uint8Array([0x10, 120, ...u16(820), ...u16(815)])), clock.now);
    clock.advance(SAMPLE_INTERVAL_MS);
    const [first] = last().frames('s');
    expect(first!.rr).toEqual([Math.round((820 / 1024) * 1000), Math.round((815 / 1024) * 1000)]);
    clock.advance(SAMPLE_INTERVAL_MS);
    expect(last().frames('s')[1]!.rr).toBeUndefined();
  });

  it('puts heart rate and cadence in the snapshot, about once a second', async () => {
    const { session, clock, hub } = await connected();
    hub.emit('2a37', heart(120), clock.now);
    clock.advance(SAMPLE_INTERVAL_MS);
    expect(session.getSnapshot()).toMatchObject({ hr: 120, cad: null });
    hub.emit('2a37', heart(125), clock.now);
    clock.advance(SAMPLE_INTERVAL_MS);
    expect(session.getSnapshot().hr).toBe(120);
    hub.emit('2a37', heart(126), clock.now);
    clock.advance(1000);
    expect(session.getSnapshot().hr).toBe(126);
  });

  it('stops streaming after leave', async () => {
    const { session, clock, hub, last } = await connected();
    const socket = last();
    await session.leave();
    expect(socket.closedWith).toEqual({ code: 1000, reason: 'bye' });
    hub.emit('2a37', heart(120), clock.now);
    socket.sent.length = 0;
    clock.advance(3000);
    expect(socket.sent).toEqual([]);
    expect(clock.pending).toBe(0);
    expect(session.getSnapshot().phase).toBe('idle');
  });
});

describe('connection health', () => {
  it('measures the round trip from the pong', async () => {
    const { session, clock, last } = await connected();
    clock.advance(37);
    last().receive(PONG_TEXT);
    expect(session.getSnapshot().latencyMs).toBe(37);
    clock.advance(PING_INTERVAL_MS);
    expect(last().sent.filter((s) => s === PING_TEXT)).toHaveLength(2);
  });

  it('reconnects with a growing wait after a drop, says hello again, and resets the count', async () => {
    const { session, clock, sockets, last } = await connected();
    last().drop();
    expect(session.getSnapshot()).toMatchObject({ phase: 'reconnecting', attempt: 1, webs: 0, latencyMs: null });
    clock.advance(RECONNECT_BASE_MS - 1);
    expect(sockets).toHaveLength(1);
    clock.advance(1);
    expect(sockets).toHaveLength(2);

    last().drop();
    expect(session.getSnapshot().attempt).toBe(2);
    clock.advance(RECONNECT_BASE_MS * 2 - 1);
    expect(sockets).toHaveLength(2);
    clock.advance(1);
    expect(sockets).toHaveLength(3);

    last().open();
    expect(session.getSnapshot()).toMatchObject({ phase: 'connected', attempt: 0 });
    expect(last().frames('hello')).toHaveLength(1);
  });

  it('caps the wait at 15 seconds and gives up after the attempt limit, until the person tries again', async () => {
    const { session, clock, sockets, last } = await connected();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      last().drop();
      clock.advance(20_000);
    }
    expect(sockets).toHaveLength(MAX_ATTEMPTS + 1);
    last().drop();
    expect(session.getSnapshot()).toMatchObject({ phase: 'lost', error: { kind: 'lost' } });
    clock.advance(60_000);
    expect(sockets).toHaveLength(MAX_ATTEMPTS + 1);

    session.reconnect();
    expect(sockets).toHaveLength(MAX_ATTEMPTS + 2);
    last().open();
    expect(session.getSnapshot()).toMatchObject({ phase: 'connected', attempt: 0, error: null });
  });

  it('drops a socket that went silent and reconnects', async () => {
    const { session, clock, sockets, last } = await connected();
    const dead = last();
    clock.advance(SILENCE_MS + PING_INTERVAL_MS);
    expect(dead.closedWith).toMatchObject({ reason: 'silent' });
    expect(session.getSnapshot().phase).toBe('reconnecting');
    clock.advance(RECONNECT_BASE_MS);
    expect(sockets.length).toBe(2);
  });

  it('a socket that keeps answering is never dropped', async () => {
    const { session, clock, sockets, last } = await connected();
    for (let i = 0; i < 10; i++) {
      clock.advance(PING_INTERVAL_MS);
      last().receive(PONG_TEXT);
    }
    expect(sockets).toHaveLength(1);
    expect(session.getSnapshot().phase).toBe('connected');
  });

  it('does not reconnect when the relay closed the socket for good', async () => {
    for (const [code, kind] of [[4001, 'replaced'], [4002, 'expired'], [1008, 'policy']] as const) {
      const { session, clock, sockets, last } = await connected();
      last().drop(code);
      clock.advance(60_000);
      expect(sockets).toHaveLength(1);
      expect(session.getSnapshot()).toMatchObject({ phase: 'ended', error: { kind } });
    }
  });

  it('ignores what an old socket says after a new one replaced it', async () => {
    const { session, clock, sockets, last } = await connected();
    const old = last();
    old.drop();
    clock.advance(RECONNECT_BASE_MS);
    last().open();
    old.receive({ t: 'room', v: 1, phone: true, webs: 5, expiresAt: 1 });
    old.drop(4002);
    expect(session.getSnapshot()).toMatchObject({ phase: 'connected', webs: 0 });
    expect(sockets).toHaveLength(2);
  });

  it('can join again after the room ended', async () => {
    const { session, joins, last } = await connected();
    last().drop(4002);
    await session.join('654321');
    expect(joins).toEqual(['123456', '654321']);
    expect(session.getSnapshot()).toMatchObject({ phase: 'connecting', code: '654321', error: null });
  });
});

describe('the game drives the recorder', () => {
  const ctl = (action: string) => ({ t: 'ctl', v: 1, action }) as RideMsg;

  it('start, pause, resume and lap reach the recorder and are not echoed back', async () => {
    const { recorder, last } = await connected();
    last().receive(ctl('start'));
    expect(recorder.calls).toContain('start');
    last().receive(ctl('pause'));
    last().receive(ctl('resume'));
    last().receive(ctl('lap'));
    expect(recorder.calls.slice(1)).toEqual(['start', 'pause', 'resume', 'lap']);
    expect(last().frames('ctl')).toEqual([]);
  });

  it('ignores controls that do not fit the recorder state', async () => {
    const { recorder, last } = await connected();
    last().receive(ctl('pause'));
    last().receive(ctl('resume'));
    last().receive(ctl('lap'));
    expect(recorder.calls).toEqual(['prepare:indoorRide:Indoor ride']);
    last().receive(ctl('start'));
    last().receive(ctl('start'));
    expect(recorder.calls.filter((c) => c === 'start')).toHaveLength(1);
  });

  it('a start while paused resumes', async () => {
    const { recorder, last } = await connected();
    last().receive(ctl('start'));
    last().receive(ctl('pause'));
    last().receive(ctl('start'));
    expect(recorder.snap.status).toBe('recording');
  });

  it('stop pauses the recorder and asks the person to save, without saving by itself', async () => {
    const { session, recorder, last } = await connected();
    last().receive(ctl('start'));
    last().receive(ctl('stop'));
    expect(recorder.snap).toMatchObject({ phase: 'active', status: 'paused' });
    expect(session.getSnapshot().stopRequested).toBe(true);
    expect(last().frames('ctl')).toEqual([]);
    session.dismissStop();
    expect(session.getSnapshot().stopRequested).toBe(false);
  });

  it('feeds the game speed to the recorder, and drops the game state when it goes quiet', async () => {
    const { session, recorder, clock, last } = await connected();
    const st = { t: 'st', v: 1, gear: 7, gearCount: 15, route: 'Bukit', phase: 'riding', distM: 1000, elevM: 20, grade: 2, vKmh: 36, pwrEst: 180 } as const;
    last().receive(st);
    expect(recorder.virtualSpeeds).toEqual([10]);
    expect(session.getSnapshot().game).toMatchObject({ vKmh: 36, route: 'Bukit' });
    clock.advance(7000);
    expect(session.getSnapshot().game).toBeNull();
  });

  it('counts the viewers from the room frames', async () => {
    const { session, last } = await connected();
    last().receive({ t: 'room', v: 1, phone: true, webs: 2, expiresAt: 1 });
    expect(session.getSnapshot().webs).toBe(2);
  });

  it('survives garbage from the relay', async () => {
    const { session, last } = await connected();
    last().receive('not json');
    last().receive('{"t":"nuke","v":1}');
    expect(session.getSnapshot().phase).toBe('connected');
  });
});

describe('the phone tells the game', () => {
  it('start, pause, resume and lap made on the phone are sent as ctl', async () => {
    const { session, recorder, last } = await connected();
    session.start();
    recorder.local('pause');
    recorder.local('resume');
    recorder.local('lap');
    expect(last().frames('ctl').map((f) => f.action)).toEqual(['start', 'pause', 'resume', 'lap']);
  });

  it('gear buttons are sent as gear frames', async () => {
    const { session, last } = await connected();
    session.gear(1);
    session.gear(-1);
    expect(last().frames('gear')).toEqual([
      { t: 'gear', v: 1, d: 1 },
      { t: 'gear', v: 1, d: -1 },
    ]);
  });

  it('start does nothing before the recorder is ready', async () => {
    const recorder = new FakeRecorder();
    recorder.prepareError = new Error('x');
    const { session, last } = await connected({ recorder });
    session.start();
    expect(recorder.calls).toEqual(['prepare:indoorRide:Indoor ride']);
    expect(last().frames('ctl')).toEqual([]);
  });
});

describe('the summary', () => {
  const sum = { t: 'sum', v: 1, distM: 15000, elevM: 200, route: 'Bukit', laps: [{ sec: 900, distM: 7500 }] } as const;

  it('is kept for the save and acknowledged after it', async () => {
    const { session, last } = await connected();
    last().receive(sum);
    expect(session.getSnapshot().summary).toMatchObject({ distM: 15000, elevM: 200, route: 'Bukit' });
    session.confirmSummary();
    expect(last().frames('ack')).toEqual([{ t: 'ack', v: 1, of: 'sum' }]);
    expect(session.getSnapshot()).toMatchObject({ summary: null, stopRequested: false });
    session.confirmSummary();
    expect(last().frames('ack')).toHaveLength(1);
  });

  it('a stop on the phone tells the game and waits for its summary', async () => {
    const { session, last } = await connected();
    last().receive({ t: 'room', v: 1, phone: true, webs: 1, expiresAt: 1 });
    const waiting = session.requestStop();
    expect(last().frames('ctl')).toEqual([{ t: 'ctl', v: 1, action: 'stop' }]);
    last().receive(sum);
    expect(await waiting).toMatchObject({ distM: 15000 });
  });

  it('gives up after a few seconds without a summary', async () => {
    const { session, clock, last } = await connected();
    last().receive({ t: 'room', v: 1, phone: true, webs: 1, expiresAt: 1 });
    const waiting = session.requestStop();
    clock.advance(SUMMARY_WAIT_MS - 1);
    let settled = false;
    void waiting.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    clock.advance(1);
    expect(await waiting).toBeNull();
  });

  it('does not wait when no game is connected', async () => {
    const { session } = await connected();
    expect(await session.requestStop()).toBeNull();
  });

  it('does not tell the game to stop twice, nor wait for what it already sent', async () => {
    const { session, last } = await connected();
    last().receive({ t: 'room', v: 1, phone: true, webs: 1, expiresAt: 1 });
    last().receive({ t: 'ctl', v: 1, action: 'stop' });
    last().receive(sum);
    expect(await session.requestStop()).toMatchObject({ distM: 15000 });
    expect(last().frames('ctl')).toEqual([]);
  });

  it('a leave while waiting settles the wait with nothing', async () => {
    const { session, last } = await connected();
    last().receive({ t: 'room', v: 1, phone: true, webs: 1, expiresAt: 1 });
    const waiting = session.requestStop();
    await session.leave();
    expect(await waiting).toBeNull();
  });
});

describe('leave', () => {
  it('cancels a recorder that was only getting ready', async () => {
    const { session, recorder } = await connected();
    await session.leave();
    expect(recorder.calls).toEqual(['prepare:indoorRide:Indoor ride', 'cancel']);
    expect(recorder.snap.phase).toBe('idle');
  });

  it('leaves a recording that already started running', async () => {
    const { session, recorder, last } = await connected();
    last().receive({ t: 'ctl', v: 1, action: 'start' });
    await session.leave();
    expect(recorder.calls).not.toContain('cancel');
    expect(recorder.snap.phase).toBe('active');
  });

  it('stops watching the recorder', async () => {
    const { session, recorder, last } = await connected();
    const socket = last();
    await session.leave();
    recorder.local('start');
    expect(socket.frames('ctl')).toEqual([]);
    expect(recorder.listeners.size).toBe(0);
  });
});

#!/usr/bin/env bun
// A fake JoyoFit phone for developing the web game without hardware: joins a ride room by its six digit code, then streams synthetic
// cadence and heart rate like the app does (about 4 samples a second), answers the game's control messages, and acknowledges the
// summary at the end. Protocol: src/features/ride/protocol.ts; the whole feature: docs/ride.md.
//
//   bun scripts/ride-sim.ts --code 123456                      # local relay (wrangler dev on :8787), fake sign-in
//   bun scripts/ride-sim.ts --code 123456 --relay https://api.fit.joyorogo.com --cookie '<JoyoRogo session cookie header>'
//
// Local relay: the Worker asks JoyoRogo who the caller is, so a local run points it at a fake JoyoRogo that this script starts on :8788:
//   cd server && bunx wrangler dev --var JOYOROGO_AUTH_URL:http://localhost:8788
//
// Options (all optional): --profile steady|intervals|hills (default steady), --cad <rpm> (target, default 85), --hr-rest <bpm> (65),
// --hr-max <bpm> (185), --mass <kg> (70), --rate <samples/s> (4), --auth-port <port> (8788), --no-keys, --exit-on-sum.
// Keys while it runs: + / - gear up / down, space coast / pedal, p pause / resume, l lap, q stop (and wait for the summary), Ctrl-C quit.
import { createServer } from 'node:http';

import {
  PING_TEXT,
  PONG_TEXT,
  encode,
  isRoomCode,
  parseMessage,
  type JoinRoomResponse,
  type RideMsg,
  type SensorMsg,
} from '../src/features/ride/protocol';

interface Options {
  relay: string;
  code: string | null;
  cookie: string | null;
  profile: 'steady' | 'intervals' | 'hills';
  cad: number;
  hrRest: number;
  hrMax: number;
  mass: number;
  rate: number;
  authPort: number;
  keys: boolean;
  exitOnSum: boolean;
}

function parseArgs(argv: string[]): Options {
  const flags = new Set(['--no-keys', '--exit-on-sum']);
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    if (flags.has(arg)) values.set(arg, 'true');
    else {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      values.set(arg, value);
    }
  }
  const number = (name: string, fallback: number): number => {
    const raw = values.get(name);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
    return n;
  };
  const profile = values.get('--profile') ?? 'steady';
  if (profile !== 'steady' && profile !== 'intervals' && profile !== 'hills') throw new Error('--profile is steady, intervals or hills');
  return {
    relay: (values.get('--relay') ?? 'http://localhost:8787').replace(/\/+$/, ''),
    code: values.get('--code') ?? null,
    cookie: values.get('--cookie') ?? null,
    profile,
    cad: number('--cad', 85),
    hrRest: number('--hr-rest', 65),
    hrMax: number('--hr-max', 185),
    mass: number('--mass', 70),
    rate: number('--rate', 4),
    authPort: number('--auth-port', 8788),
    keys: !values.has('--no-keys'),
    exitOnSum: values.has('--exit-on-sum'),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Synthetic rider

/** The cadence the rider aims for `t` seconds into the ride. 0 is coasting. */
export function targetCadence(profile: Options['profile'], t: number, cad: number): number {
  if (profile === 'intervals') return t % 240 < 180 ? cad + 8 : cad - 28;
  if (profile === 'hills') return cad + 14 * Math.sin((t / 90) * Math.PI);
  return cad;
}

/** A rider whose cadence follows its target with a little noise and whose heart rate follows the effort with a lag. */
class Rider {
  cad = 0;
  hr: number;
  /** Seconds until the next heartbeat. */
  private beat = 0;
  private t = 0;

  constructor(private readonly o: Options) {
    this.hr = o.hrRest;
  }

  /** Advances `dt` seconds; `coasting` forces cadence to 0. Returns the sample, with the RR intervals (ms) of the beats in this step. */
  step(dt: number, coasting: boolean, now: number): SensorMsg {
    this.t += dt;
    const target = coasting ? 0 : Math.max(0, targetCadence(this.o.profile, this.t, this.o.cad));
    this.cad += (target - this.cad) * Math.min(1, dt * 0.8) + (target > 0 ? (Math.random() - 0.5) * 3 : 0);
    this.cad = Math.max(0, this.cad);
    const effort = Math.min(1, (this.cad / 100) ** 1.4);
    const hrTarget = this.o.hrRest + (this.o.hrMax - this.o.hrRest) * (0.15 + 0.7 * effort);
    this.hr += (hrTarget - this.hr) * Math.min(1, dt / 25);
    const rr: number[] = [];
    this.beat -= dt;
    while (this.beat <= 0) {
      const interval = 60 / this.hr;
      rr.push(Math.round(interval * 1000 + (Math.random() - 0.5) * 30));
      this.beat += interval;
    }
    const msg: SensorMsg = { t: 's', v: 1, ts: now, hr: Math.round(this.hr), cad: Math.round(this.cad * 10) / 10 };
    if (rr.length > 0) msg.rr = rr.slice(0, 16);
    return msg;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Fake JoyoRogo sign-in (local relay only)

/** Answers `GET /api/auth/get-session` for any caller that sends a session cookie: the relay's `requireUser` accepts it as one user. */
function startFakeAuth(port: number): Promise<boolean> {
  const server = createServer((req, res) => {
    const signedIn = /session_token=/.test(req.headers.cookie ?? '');
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify(
        signedIn ? { user: { id: 'ride-sim-user', email: 'sim@example.com', name: 'Ride Sim' }, session: { expiresAt: new Date(Date.now() + 3_600_000).toISOString() } } : null,
      ),
    );
  });
  return new Promise((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => resolve(true));
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Phone session

const log = (message: string) => console.log(`${new Date().toISOString().slice(11, 23)}  ${message}`);

async function join(o: Options): Promise<JoinRoomResponse> {
  const cookie = o.cookie ?? '__Secure-better-auth.session_token=ride-sim.sig';
  const response = await fetch(`${o.relay}/ride/rooms/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ code: o.code }),
  });
  const body = (await response.json().catch(() => null)) as (Partial<JoinRoomResponse> & { error?: string }) | null;
  if (!response.ok || !body?.roomId || !body.token) {
    const hint =
      response.status === 401
        ? o.cookie
          ? 'the cookie was not accepted'
          : 'the relay could not ask the fake sign-in; start it with: cd server && bunx wrangler dev --var JOYOROGO_AUTH_URL:http://localhost:' + o.authPort
        : response.status === 404
          ? 'no such code (it lasts 10 minutes)'
          : response.status === 409
            ? 'another phone already joined this room'
            : '';
    throw new Error(`join failed: ${response.status} ${body?.error ?? ''} ${hint}`.trim());
  }
  return { roomId: body.roomId, token: body.token };
}

class Phone {
  private ws: WebSocket | null = null;
  private readonly rider: Rider;
  private coasting = false;
  private paused = false;
  private closed = false;
  private attempt = 0;
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingSentAt = 0;
  private lastState = 0;
  private done: (() => void) | null = null;
  private joined: JoinRoomResponse | null = null;

  constructor(private readonly o: Options) {
    this.rider = new Rider(o);
  }

  async run(): Promise<void> {
    this.joined = await join(this.o);
    log(`joined room ${this.joined.roomId.slice(0, 8)}... as the phone`);
    this.connect();
    await new Promise<void>((resolve) => {
      this.done = resolve;
    });
  }

  private url(): string {
    const { roomId, token } = this.joined!;
    return `${this.o.relay.replace(/^http/, 'ws')}/ride/rooms/${encodeURIComponent(roomId)}/ws?role=phone&token=${encodeURIComponent(token)}`;
  }

  private connect(): void {
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.attempt = 0;
      log('connected');
      this.send({ t: 'hello', v: 1, role: 'phone', app: 'JoyoFit ride-sim', massKg: this.o.mass });
      this.sampleTimer = setInterval(() => this.sample(), 1000 / this.o.rate);
      this.pingTimer = setInterval(() => this.ping(), 5000);
      this.ping();
    });
    ws.addEventListener('message', (event) => this.receive(String(event.data)));
    ws.addEventListener('close', (event) => {
      clearInterval(this.sampleTimer ?? undefined);
      clearInterval(this.pingTimer ?? undefined);
      if (this.closed) return;
      if (event.code === 4001 || event.code === 4002 || event.code === 1008) {
        log(`closed by the relay (${event.code} ${event.reason}); not reconnecting`);
        this.quit();
        return;
      }
      const wait = Math.min(15_000, 500 * 2 ** this.attempt++);
      log(`connection lost (${event.code}); reconnecting in ${wait} ms`);
      setTimeout(() => this.connect(), wait);
    });
    ws.addEventListener('error', () => {
      // 'close' follows and handles the retry
    });
  }

  private send(msg: RideMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  private sample(): void {
    this.send(this.rider.step(1 / this.o.rate, this.coasting, Date.now()));
  }

  private ping(): void {
    this.pingSentAt = Date.now();
    this.ws?.send(PING_TEXT);
  }

  private receive(text: string): void {
    if (text === PONG_TEXT) {
      log(`latency ${Date.now() - this.pingSentAt} ms`);
      return;
    }
    const parsed = parseMessage(text);
    if (!parsed.ok) {
      log(`unreadable frame (${parsed.reason}): ${text.slice(0, 80)}`);
      return;
    }
    const msg = parsed.msg;
    switch (msg.t) {
      case 'room':
        log(`room: phone ${msg.phone ? 'on' : 'off'}, ${msg.webs} web viewer(s)`);
        break;
      case 'hello':
        log(`web says hello: ${msg.app}`);
        break;
      case 'ctl':
        if (msg.action === 'pause') this.paused = true;
        if (msg.action === 'resume' || msg.action === 'start') this.paused = false;
        log(`control from the game: ${msg.action}${this.paused ? ' (recorder paused)' : ''}`);
        break;
      case 'st': {
        const now = Date.now();
        if (now - this.lastState >= 4000) {
          this.lastState = now;
          log(`game: ${msg.phase}, gear ${msg.gear + 1}/${msg.gearCount}, ${msg.vKmh} km/h, ${(msg.distM / 1000).toFixed(2)} km, grade ${msg.grade}%, ${msg.pwrEst} W (estimate)`);
        }
        break;
      }
      case 'sum':
        log(`summary: ${(msg.distM / 1000).toFixed(2)} km, +${msg.elevM} m, route "${msg.route}", ${msg.laps.length} lap(s)`);
        this.send({ t: 'ack', v: 1, of: 'sum' });
        if (this.o.exitOnSum) setTimeout(() => this.quit(), 200);
        break;
      case 'err':
        log(`relay error: ${msg.code}`);
        break;
      default:
        break;
    }
  }

  gear(d: 1 | -1): void {
    this.send({ t: 'gear', v: 1, d });
    log(`gear ${d > 0 ? 'up' : 'down'}`);
  }

  toggleCoast(): void {
    this.coasting = !this.coasting;
    log(this.coasting ? 'coasting' : 'pedalling');
  }

  ctl(action: 'start' | 'pause' | 'resume' | 'lap' | 'stop'): void {
    this.send({ t: 'ctl', v: 1, action });
    log(`sent ${action}`);
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.ctl(this.paused ? 'pause' : 'resume');
  }

  quit(): void {
    this.closed = true;
    clearInterval(this.sampleTimer ?? undefined);
    clearInterval(this.pingTimer ?? undefined);
    this.ws?.close(1000, 'bye');
    this.done?.();
  }
}

function bindKeys(phone: Phone): void {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (key: string) => {
    if (key === '\u0003') phone.quit();
    else if (key === '+' || key === '=') phone.gear(1);
    else if (key === '-') phone.gear(-1);
    else if (key === ' ') phone.toggleCoast();
    else if (key === 'p') phone.togglePause();
    else if (key === 'l') phone.ctl('lap');
    else if (key === 'q') phone.ctl('stop');
  });
}

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));
  if (!isRoomCode(o.code)) throw new Error('--code <six digits> is required (the game shows it)');
  if (!o.cookie) {
    const started = await startFakeAuth(o.authPort);
    log(started ? `fake JoyoRogo sign-in on :${o.authPort} (run the relay with --var JOYOROGO_AUTH_URL:http://localhost:${o.authPort})` : `port ${o.authPort} is taken; assuming a fake sign-in is already running there`);
  }
  const phone = new Phone(o);
  if (o.keys) bindKeys(phone);
  await phone.run();
  process.exit(0);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

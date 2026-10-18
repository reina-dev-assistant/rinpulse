/**
 * The wire protocol of "Main di web" / "Ride on the web" (version 1): what the JoyoFit phone, the relay (`server/src/ride`) and the
 * browser game (`site/src/ride`) say to each other over WebSocket. Pure TypeScript, no imports, no DOM, no React Native: the app, the
 * Worker, the site and `scripts/ride-sim.ts` all import this one file. docs/ride.md describes the same contract in prose.
 *
 * Every message is one JSON text frame of at most `MAX_MESSAGE_BYTES` with `t` (type) and `v: PROTOCOL_VERSION`. `parseMessage`
 * validates a frame and returns a clean copy (unknown fields dropped, numbers range-checked); the relay uses it on every frame it
 * receives and closes the socket of a sender that keeps failing it.
 *
 * Who may send what (`CAN_SEND`), and where the relay forwards it:
 *
 * |type|from|goes to|what|
 * |---|---|---|---|
 * |`hello`|phone, web|the other side|who is here (`app`, and the rider's `massKg` from the phone)|
 * |`s`|phone|web|live sensor sample, about 4 Hz; a missing field means no data|
 * |`ctl`|web, phone|the other side|start / pause / resume / lap / stop; whoever sends it, the phone's recorder obeys it|
 * |`gear`|phone|web|a gear change from the phone's buttons|
 * |`st`|web|phone, other webs|the game's state, about 1 Hz, for the phone's status card and for spectators (power is an estimate)|
 * |`sum`|web|phone|the ride summary at stop; kept by the relay until the phone confirms it with `ack`|
 * |`ack`|phone|relay|the phone saved the `sum`|
 * |`room`|relay|both|who is connected (sent on every join and leave, and to a socket that just connected)|
 * |`err`|relay|the sender|why the relay is about to close the socket|
 * |`ping` / `pong`|both|relay|keep-alive and latency; the relay answers the exact text `PING_TEXT` itself, without waking|
 *
 * The relay stamps every frame it forwards with `rt` (its clock, epoch ms) so a receiver can tell how old a sample is.
 */

export const PROTOCOL_VERSION = 1;
/** A frame larger than this (UTF-8 bytes) is refused. */
export const MAX_MESSAGE_BYTES = 2048;
/** The keep-alive frame and the relay's answer, byte for byte: Cloudflare answers it without running the Durable Object. */
export const PING_TEXT = '{"t":"ping"}';
export const PONG_TEXT = '{"t":"pong"}';

export type RideRole = 'phone' | 'web';
export type CtlAction = 'start' | 'pause' | 'resume' | 'lap' | 'stop';
export type GamePhase = 'idle' | 'countdown' | 'riding' | 'paused' | 'finished';

export const CTL_ACTIONS: readonly CtlAction[] = ['start', 'pause', 'resume', 'lap', 'stop'];
export const GAME_PHASES: readonly GamePhase[] = ['idle', 'countdown', 'riding', 'paused', 'finished'];

export interface HelloMsg {
  t: 'hello';
  v: 1;
  role: RideRole;
  /** Who is talking ("JoyoFit 1.4.0", "JoyoFit Ride"). */
  app: string;
  /** Phone only: the rider's weight in kg (profile), for the physics. The game falls back to 70. */
  massKg?: number;
}

/** One sensor sample. Units: bpm, rpm, m/s, watts (measured, never estimated), RR intervals in ms. */
export interface SensorMsg {
  t: 's';
  v: 1;
  /** Epoch ms on the phone's clock. */
  ts: number;
  hr?: number;
  cad?: number;
  spd?: number;
  /** Only from a real power meter; absent otherwise. */
  pwr?: number;
  rr?: number[];
}

export interface CtlMsg {
  t: 'ctl';
  v: 1;
  action: CtlAction;
}

export interface GearMsg {
  t: 'gear';
  v: 1;
  /** 1 = one gear harder, -1 = one gear easier. */
  d: 1 | -1;
}

/** The game's state for the phone. `pwrEst` is the physics model's ESTIMATE in watts; the phone labels it "estimasi". */
export interface StateMsg {
  t: 'st';
  v: 1;
  /** 0-based index into `GEARS` (physics.ts). */
  gear: number;
  gearCount: number;
  route: string;
  phase: GamePhase;
  distM: number;
  /** Metres climbed so far. */
  elevM: number;
  /** Current road grade in percent. */
  grade: number;
  vKmh: number;
  pwrEst: number;
}

export interface SumLap {
  sec: number;
  distM: number;
}

/** What the phone attaches to the saved workout: the distance and climb the rider covered in the game. */
export interface SumMsg {
  t: 'sum';
  v: 1;
  distM: number;
  elevM: number;
  route: string;
  laps: SumLap[];
}

export interface AckMsg {
  t: 'ack';
  v: 1;
  of: 'sum';
}

export interface PingMsg {
  t: 'ping';
}

export interface PongMsg {
  t: 'pong';
}

/** Relay to everyone in the room: who is connected right now. */
export interface RoomMsg {
  t: 'room';
  v: 1;
  phone: boolean;
  webs: number;
  /** Epoch ms after which an idle room is closed (relay clock). */
  expiresAt: number;
}

export type ErrCode = 'bad_message' | 'too_large' | 'rate_limited' | 'not_allowed' | 'replaced' | 'expired';

export interface ErrMsg {
  t: 'err';
  v: 1;
  code: ErrCode;
}

export type ClientMsg = HelloMsg | SensorMsg | CtlMsg | GearMsg | StateMsg | SumMsg | AckMsg | PingMsg | PongMsg;
export type ServerMsg = RoomMsg | ErrMsg;
export type RideMsg = ClientMsg | ServerMsg;
export type MsgType = RideMsg['t'];

/** A forwarded frame as the receiver sees it: the relay's `rt` stamp added. */
export type Relayed<M extends RideMsg = RideMsg> = M & { rt?: number };

/** Message types each role may send; anything else is `not_allowed`. */
export const CAN_SEND: Readonly<Record<RideRole, readonly MsgType[]>> = {
  phone: ['hello', 's', 'ctl', 'gear', 'ack', 'ping', 'pong'],
  web: ['hello', 'ctl', 'st', 'sum', 'ping', 'pong'],
};

/** Where the relay forwards what a role sent: the types in the list go to the other side, the rest stay in the relay. */
export const FORWARD: Readonly<Record<RideRole, readonly MsgType[]>> = {
  phone: ['hello', 's', 'ctl', 'gear'],
  web: ['hello', 'ctl', 'st', 'sum'],
};

// ---------------------------------------------------------------------------------------------------------------------
// Limits

export const LIMITS = {
  hr: { min: 0, max: 300 },
  cad: { min: 0, max: 300 },
  /** m/s */
  spd: { min: 0, max: 100 },
  pwr: { min: 0, max: 5000 },
  rrMs: { min: 0, max: 5000, maxCount: 16 },
  massKg: { min: 20, max: 250 },
  appChars: 40,
  routeChars: 80,
  laps: 30,
  distM: { min: 0, max: 1_000_000 },
  elevM: { min: 0, max: 100_000 },
  grade: { min: -50, max: 50 },
  vKmh: { min: 0, max: 200 },
  gears: { max: 64 },
} as const;

/** UTF-8 byte length of a string, without TextEncoder (Hermes, Workers, Bun and browsers all agree on the result). */
export function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        n += 4;
        i += 1;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------------
// Parsing

export type ParseFailure = 'too_large' | 'bad_message';
export type ParseResult = { ok: true; msg: RideMsg } | { ok: false; reason: ParseFailure };

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);

function num(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function str(value: unknown, maxChars: number): string | null {
  return typeof value === 'string' && value.length <= maxChars ? value : null;
}

/** Marks an optional number field that is present but invalid, so the frame is refused (a missing field is `undefined`). */
const BAD = Symbol('bad');
type Bad = typeof BAD;

function optNum(o: Obj, key: string, min: number, max: number): number | undefined | Bad {
  if (!(key in o) || o[key] === undefined || o[key] === null) return undefined;
  return num(o[key], min, max) ?? BAD;
}

const round = (n: number, digits = 1): number => {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
};

function parseSensor(o: Obj): SensorMsg | null {
  const ts = num(o.ts, 0, 8.64e15);
  if (ts === null) return null;
  const msg: SensorMsg = { t: 's', v: 1, ts };
  const hr = optNum(o, 'hr', LIMITS.hr.min, LIMITS.hr.max);
  const cad = optNum(o, 'cad', LIMITS.cad.min, LIMITS.cad.max);
  const spd = optNum(o, 'spd', LIMITS.spd.min, LIMITS.spd.max);
  const pwr = optNum(o, 'pwr', LIMITS.pwr.min, LIMITS.pwr.max);
  if (hr === BAD || cad === BAD || spd === BAD || pwr === BAD) return null;
  if (hr !== undefined) msg.hr = hr;
  if (cad !== undefined) msg.cad = cad;
  if (spd !== undefined) msg.spd = spd;
  if (pwr !== undefined) msg.pwr = pwr;
  if (o.rr !== undefined && o.rr !== null) {
    if (!Array.isArray(o.rr) || o.rr.length > LIMITS.rrMs.maxCount) return null;
    const rr: number[] = [];
    for (const item of o.rr) {
      const n = num(item, LIMITS.rrMs.min, LIMITS.rrMs.max);
      if (n === null) return null;
      rr.push(n);
    }
    if (rr.length > 0) msg.rr = rr;
  }
  return msg;
}

function parseState(o: Obj): StateMsg | null {
  const gear = num(o.gear, 0, LIMITS.gears.max);
  const gearCount = num(o.gearCount, 1, LIMITS.gears.max);
  const route = str(o.route, LIMITS.routeChars);
  const phase = typeof o.phase === 'string' ? GAME_PHASES.find((p) => p === o.phase) : undefined;
  const distM = num(o.distM, LIMITS.distM.min, LIMITS.distM.max);
  const elevM = num(o.elevM, LIMITS.elevM.min, LIMITS.elevM.max);
  const grade = num(o.grade, LIMITS.grade.min, LIMITS.grade.max);
  const vKmh = num(o.vKmh, LIMITS.vKmh.min, LIMITS.vKmh.max);
  const pwrEst = num(o.pwrEst, 0, LIMITS.pwr.max);
  if (gear === null || gearCount === null || route === null || !phase) return null;
  if (distM === null || elevM === null || grade === null || vKmh === null || pwrEst === null) return null;
  return { t: 'st', v: 1, gear: Math.round(gear), gearCount: Math.round(gearCount), route, phase, distM: round(distM), elevM: round(elevM), grade: round(grade), vKmh: round(vKmh), pwrEst: Math.round(pwrEst) };
}

function parseSum(o: Obj): SumMsg | null {
  const distM = num(o.distM, LIMITS.distM.min, LIMITS.distM.max);
  const elevM = num(o.elevM, LIMITS.elevM.min, LIMITS.elevM.max);
  const route = str(o.route, LIMITS.routeChars);
  if (distM === null || elevM === null || route === null) return null;
  if (!Array.isArray(o.laps) || o.laps.length > LIMITS.laps) return null;
  const laps: SumLap[] = [];
  for (const item of o.laps) {
    if (!isObj(item)) return null;
    const sec = num(item.sec, 0, 86_400);
    const lapDist = num(item.distM, LIMITS.distM.min, LIMITS.distM.max);
    if (sec === null || lapDist === null) return null;
    laps.push({ sec: round(sec), distM: round(lapDist) });
  }
  return { t: 'sum', v: 1, distM: round(distM), elevM: round(elevM), route, laps };
}

function parseHello(o: Obj): HelloMsg | null {
  const role = o.role === 'phone' || o.role === 'web' ? o.role : null;
  const app = str(o.app, LIMITS.appChars);
  const massKg = optNum(o, 'massKg', LIMITS.massKg.min, LIMITS.massKg.max);
  if (!role || app === null || massKg === BAD) return null;
  return { t: 'hello', v: 1, role, app, ...(massKg === undefined ? {} : { massKg }) };
}

function parseRoom(o: Obj): RoomMsg | null {
  const webs = num(o.webs, 0, 10_000);
  const expiresAt = num(o.expiresAt, 0, 8.64e15);
  if (typeof o.phone !== 'boolean' || webs === null || expiresAt === null) return null;
  return { t: 'room', v: 1, phone: o.phone, webs, expiresAt };
}

const ERR_CODES: readonly ErrCode[] = ['bad_message', 'too_large', 'rate_limited', 'not_allowed', 'replaced', 'expired'];

/**
 * Validates one text frame. Returns a clean copy of the message (only the fields the protocol knows, numbers in range) or why it was
 * refused. A frame of the wrong `v` is `bad_message`; the relay and the clients never guess at another version.
 */
export function parseMessage(raw: string): ParseResult {
  if (utf8Length(raw) > MAX_MESSAGE_BYTES) return { ok: false, reason: 'too_large' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'bad_message' };
  }
  if (!isObj(json) || typeof json.t !== 'string') return { ok: false, reason: 'bad_message' };
  const bad = { ok: false, reason: 'bad_message' } as const;
  if (json.t === 'ping') return { ok: true, msg: { t: 'ping' } };
  if (json.t === 'pong') return { ok: true, msg: { t: 'pong' } };
  if (json.v !== PROTOCOL_VERSION) return bad;
  let msg: RideMsg | null = null;
  switch (json.t) {
    case 'hello':
      msg = parseHello(json);
      break;
    case 's':
      msg = parseSensor(json);
      break;
    case 'ctl': {
      const action = CTL_ACTIONS.find((a) => a === json.action);
      msg = action ? { t: 'ctl', v: 1, action } : null;
      break;
    }
    case 'gear':
      msg = json.d === 1 || json.d === -1 ? { t: 'gear', v: 1, d: json.d } : null;
      break;
    case 'st':
      msg = parseState(json);
      break;
    case 'sum':
      msg = parseSum(json);
      break;
    case 'ack':
      msg = json.of === 'sum' ? { t: 'ack', v: 1, of: 'sum' } : null;
      break;
    case 'room':
      msg = parseRoom(json);
      break;
    case 'err': {
      const code = ERR_CODES.find((c) => c === json.code);
      msg = code ? { t: 'err', v: 1, code } : null;
      break;
    }
  }
  return msg ? { ok: true, msg } : bad;
}

/** True when `role` may send a message of this type. */
export function canSend(role: RideRole, type: MsgType): boolean {
  return CAN_SEND[role].includes(type);
}

/** The frame text for a message. */
export function encode(msg: RideMsg | Relayed): string {
  return JSON.stringify(msg);
}

// ---------------------------------------------------------------------------------------------------------------------
// Rooms (REST)

/** `POST /ride/rooms` (no body, no login): what the web gets. `token` is the web token for the WebSocket. */
export interface CreateRoomResponse {
  roomId: string;
  /** Six digits, valid until `codeExpiresAt`. The QR holds `joyofit://ride/join?code=<code>`. */
  code: string;
  token: string;
  /** Epoch ms. */
  codeExpiresAt: number;
}

/** `POST /ride/rooms/join { code }` (JoyoRogo session cookie): what the phone gets. */
export interface JoinRoomResponse {
  roomId: string;
  token: string;
}

export const CODE_LENGTH = 6;
/** How long a code can be used to join. */
export const CODE_TTL_MS = 10 * 60 * 1000;
/** A room with no traffic for this long is closed and forgotten. */
export const ROOM_IDLE_MS = 3 * 60 * 60 * 1000;

export const isRoomCode = (value: unknown): value is string => typeof value === 'string' && /^\d{6}$/.test(value);

/** The deep link the web shows as a QR. */
export const joinLink = (code: string): string => `joyofit://ride/join?code=${code}`;

/** The code out of a scanned or pasted text: the deep link, a link with `code=`, or the bare six digits. Null when there is none. */
export function codeFromText(text: string): string | null {
  const trimmed = text.trim();
  const query = /[?&]code=(\d{6})(?!\d)/.exec(trimmed);
  if (query?.[1]) return query[1];
  const compact = trimmed.replace(/[\s-]/g, '');
  return isRoomCode(compact) ? compact : null;
}

/** The WebSocket path of a room, for either role. */
export function wsPath(roomId: string, role: RideRole, token: string): string {
  return `/ride/rooms/${encodeURIComponent(roomId)}/ws?role=${role}&token=${encodeURIComponent(token)}`;
}

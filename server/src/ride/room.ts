import { DurableObject } from "cloudflare:workers";

import {
  CAN_SEND,
  FORWARD,
  PONG_TEXT,
  PING_TEXT,
  ROOM_IDLE_MS,
  encode,
  parseMessage,
  type ErrCode,
  type HelloMsg,
  type RideMsg,
  type RideRole,
  type RoomMsg,
  type SumMsg,
} from "../../../src/features/ride/protocol";
import { sha256Hex } from "../auth";
import { checkResult, emptyEvidence, insertResult, rankOf, type Rejection, type ResultInput, type RideEvidence } from "./leaderboard";
import {
  ACTIVITY_PERSIST_MS,
  CLOSE_EXPIRED,
  CLOSE_POLICY,
  CLOSE_REPLACED,
  FRAME_RATE,
  MAX_WEB_SOCKETS,
  STRIKES_BEFORE_CLOSE,
  STRIKE_FORGIVE_MS,
  EVIDENCE_PERSIST_MS,
} from "./limits";

/** What a room remembers. Only hashes of the tokens are stored. */
interface RoomState {
  createdAt: number;
  webTokenHash: string;
  phoneTokenHash: string | null;
  /** The JoyoRogo user who joined as the phone; only they can join again. */
  phoneUserId: string | null;
  /** The phone user's public name ("First L."), for the leaderboard. */
  phoneName?: string | null;
  /** What the relay saw of the ride in progress, for the leaderboard. Reset by the game's `ctl start`. */
  evidence?: RideEvidence | null;
  /** The phone's last `hello`, handed to a web that connects later. */
  phoneHello: HelloMsg | null;
  /** A `sum` the phone has not confirmed yet; delivered again whenever the phone connects. */
  pendingSum: SumMsg | null;
  lastActivity: number;
}

export type JoinResult = { ok: true; token: string } | { ok: false; error: "gone" | "taken" };

export type SubmitResult = { ok: true; rank: number } | { ok: false; error: "invalid_token" | "no_phone" | Rejection };

interface Attachment {
  role: RideRole;
}

interface Bucket {
  tokens: number;
  at: number;
  strikes: number;
  lastStrikeAt: number;
}

const STATE_KEY = "room";

/** 24 random bytes, base64url: 192 bits, unguessable. */
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * One ride room: one phone and a few web viewers, relayed frame by frame (docs/ride.md, protocol in `src/features/ride/protocol.ts`).
 *
 * - WebSockets are hibernatable (`acceptWebSocket`): a room nobody is talking in costs nothing, and the exact `{"t":"ping"}` text is
 *   answered by the runtime without waking the object.
 * - The relay never reads a sample's content beyond validating it: it checks size, shape and who may send what, stamps `rt`, and
 *   forwards. It keeps only the phone's `hello`, the unconfirmed `sum`, the last-activity time, and a count of the cadence
 *   samples since the game's `ctl start` (the leaderboard's evidence, `leaderboard.ts`).
 * - Tokens: `open` mints the web token, `joinPhone` the phone token (a new one for the same user replaces the old one and closes
 *   the old socket). A room is closed 3 hours after its last frame (alarm).
 * - Every method that depends on time takes `now`, so tests move the clock.
 */
export class RideRoom extends DurableObject<Env> {
  private room: RoomState | null = null;
  /** The last frame this instance relayed (ms); an alarm after a hibernation falls back to the stored value. */
  private trafficAt = 0;
  private persistedActivity = 0;
  private evidenceSavedAt = 0;
  private readonly buckets = new WeakMap<WebSocket, Bucket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING_TEXT, PONG_TEXT));
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<RoomState>(STATE_KEY)) ?? null;
      this.persistedActivity = this.room?.lastActivity ?? 0;
    });
  }

  // -------------------------------------------------------------------------------------------------------------------
  // RPC, called by the Worker's routes

  /** Creates the room; returns the web token. Throws when the room already exists. */
  async open(now: number): Promise<{ webToken: string }> {
    if (this.room) throw new Error("room_exists");
    const webToken = randomToken();
    this.room = { createdAt: now, webTokenHash: await sha256Hex(webToken), phoneTokenHash: null, phoneUserId: null, phoneHello: null, pendingSum: null, lastActivity: now };
    await this.save();
    await this.ctx.storage.setAlarm(now + ROOM_IDLE_MS);
    this.persistedActivity = now;
    return { webToken };
  }

  /** The phone joins (or joins again with a new token). Only one JoyoRogo user is the phone of a room. */
  async joinPhone(userId: string, now: number, publicName: string | null = null): Promise<JoinResult> {
    const room = this.room;
    if (!room) return { ok: false, error: "gone" };
    if (room.phoneUserId !== null && room.phoneUserId !== userId) return { ok: false, error: "taken" };
    const token = randomToken();
    room.phoneTokenHash = await sha256Hex(token);
    room.phoneUserId = userId;
    room.phoneName = publicName;
    await this.touch(now, true);
    return { ok: true, token };
  }

  /** The game submits a finished ride for the leaderboard; accepted only when the relay saw the phone's cadence for it. */
  async submitResult(webToken: string, input: ResultInput, now: number): Promise<SubmitResult> {
    const room = this.room;
    if (!room || webToken.length === 0 || webToken.length > 128 || (await sha256Hex(webToken)) !== room.webTokenHash) {
      return { ok: false, error: "invalid_token" };
    }
    if (!room.phoneUserId) return { ok: false, error: "no_phone" };
    const evidence = room.evidence ?? null;
    const rejection = checkResult(evidence, input, now);
    if (rejection) return { ok: false, error: rejection };
    evidence!.submitted = true;
    await this.save();
    await insertResult(this.env.DB, { userId: room.phoneUserId, name: room.phoneName ?? null, input, now });
    return { ok: true, rank: await rankOf(this.env.DB, input.routeId, room.phoneUserId, input.timeS) };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // WebSocket upgrade

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected a websocket", { status: 426 });
    const room = this.room;
    if (!room) return Response.json({ error: "room_not_found" }, { status: 404 });
    const params = new URL(request.url).searchParams;
    const role = params.get("role");
    const token = params.get("token") ?? "";
    if (role !== "phone" && role !== "web") return Response.json({ error: "invalid_role" }, { status: 400 });
    const expected = role === "phone" ? room.phoneTokenHash : room.webTokenHash;
    if (!expected || token.length === 0 || token.length > 128 || (await sha256Hex(token)) !== expected) {
      return Response.json({ error: "invalid_token" }, { status: 401 });
    }
    if (role === "web" && this.live(this.ctx.getWebSockets("web")).length >= MAX_WEB_SOCKETS) {
      return Response.json({ error: "room_full" }, { status: 429 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    if (role === "phone") {
      // One phone: a second one (the app reconnecting before the old socket was noticed dead) takes over.
      for (const old of this.ctx.getWebSockets("phone")) this.closeWith(old, CLOSE_REPLACED, "replaced");
    }
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role } satisfies Attachment);
    const now = Date.now();
    await this.touch(now, false);
    this.sendPresence();
    if (role === "web" && room.phoneHello) server.send(encode({ ...room.phoneHello, rt: now }));
    if (role === "phone" && room.pendingSum) server.send(encode({ ...room.pendingSum, rt: now }));
    return new Response(null, { status: 101, webSocket: client });
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Hibernatable WebSocket handlers

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;
    const role = attachment.role;
    const now = Date.now();
    if (!this.take(ws, role, now)) return this.strike(ws, "rate_limited", now);
    if (typeof message !== "string") return this.strike(ws, "bad_message", now);
    const parsed = parseMessage(message);
    if (!parsed.ok) return this.strike(ws, parsed.reason, now);
    const msg = parsed.msg;
    if (msg.t === "ping") {
      ws.send(PONG_TEXT);
      return;
    }
    if (msg.t === "pong") return;
    if (!CAN_SEND[role].includes(msg.t) || (msg.t === "hello" && msg.role !== role)) return this.strike(ws, "not_allowed", now);
    this.forgive(ws, now);

    const room = this.room;
    if (!room) return;
    let dirty = false;
    if (msg.t === "hello" && role === "phone") {
      room.phoneHello = msg;
      dirty = true;
    } else if (msg.t === "sum") {
      room.pendingSum = msg;
      dirty = true;
    } else if (msg.t === "ack" && room.pendingSum) {
      room.pendingSum = null;
      dirty = true;
    } else if (msg.t === "ctl" && msg.action === "start" && role === "web") {
      room.evidence = emptyEvidence(now);
      dirty = true;
    } else if (msg.t === "s" && role === "phone" && msg.cad !== undefined && room.evidence && !room.evidence.submitted) {
      room.evidence.cadSamples += 1;
      room.evidence.cadSum += msg.cad;
      if (now - this.evidenceSavedAt >= EVIDENCE_PERSIST_MS) {
        this.evidenceSavedAt = now;
        dirty = true;
      }
    }
    await this.touch(now, dirty);

    if (FORWARD[role].includes(msg.t)) this.forward(ws, role, msg, now);
  }

  async webSocketClose(ws: WebSocket, _code: number, reason: string): Promise<void> {
    this.closeWith(ws, 1000, reason);
    this.sendPresence(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.closeWith(ws, 1011, "error");
    this.sendPresence(ws);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Alarm: idle expiry

  async alarm(): Promise<void> {
    const stored = await this.ctx.storage.get<RoomState>(STATE_KEY);
    if (!stored) return;
    const lastActivity = Math.max(stored.lastActivity, this.trafficAt);
    const idleEnd = lastActivity + ROOM_IDLE_MS;
    if (Date.now() < idleEnd) {
      await this.ctx.storage.setAlarm(idleEnd);
      return;
    }
    for (const ws of this.ctx.getWebSockets()) {
      this.sendTo(ws, { t: "err", v: 1, code: "expired" });
      this.closeWith(ws, CLOSE_EXPIRED, "expired");
    }
    this.room = null;
    await this.ctx.storage.deleteAll();
  }

  // -------------------------------------------------------------------------------------------------------------------
  // internals

  private async save(): Promise<void> {
    if (this.room) await this.ctx.storage.put(STATE_KEY, this.room);
  }

  /**
   * Notes traffic. The stored last-activity time (and the alarm that follows it) moves at most every `ACTIVITY_PERSIST_MS`, or with
   * `force` (a change that is saved anyway).
   */
  private async touch(now: number, force: boolean): Promise<void> {
    const room = this.room;
    if (!room) return;
    this.trafficAt = now;
    if (force || now - this.persistedActivity >= ACTIVITY_PERSIST_MS) {
      room.lastActivity = now;
      this.persistedActivity = now;
      await this.save();
      await this.ctx.storage.setAlarm(now + ROOM_IDLE_MS);
    }
  }

  private live(sockets: WebSocket[]): WebSocket[] {
    return sockets.filter((s) => s.readyState === WebSocket.OPEN);
  }

  private presence(exclude?: WebSocket): RoomMsg {
    const alive = (tag: RideRole) => this.live(this.ctx.getWebSockets(tag)).filter((s) => s !== exclude);
    return { t: "room", v: 1, phone: alive("phone").length > 0, webs: alive("web").length, expiresAt: this.trafficAtOrStored() + ROOM_IDLE_MS };
  }

  private trafficAtOrStored(): number {
    return Math.max(this.trafficAt, this.room?.lastActivity ?? 0);
  }

  private sendPresence(exclude?: WebSocket): void {
    const frame = encode(this.presence(exclude));
    for (const ws of this.live(this.ctx.getWebSockets())) if (ws !== exclude) ws.send(frame);
  }

  /** Phone frames go to the webs, web frames to the phone; the game's `st` also goes to the other webs, so a spectator can follow the rider. */
  private forward(sender: WebSocket, from: RideRole, msg: RideMsg, now: number): void {
    const frame = encode({ ...msg, rt: now });
    const targets = [...this.ctx.getWebSockets(from === "phone" ? "web" : "phone")];
    if (from === "web" && msg.t === "st") targets.push(...this.ctx.getWebSockets("web"));
    for (const ws of this.live(targets)) if (ws !== sender) ws.send(frame);
  }

  private sendTo(ws: WebSocket, msg: RideMsg): void {
    try {
      ws.send(encode(msg));
    } catch {
      // the socket is already gone
    }
  }

  private closeWith(ws: WebSocket, code: number, reason: string): void {
    if (code === CLOSE_REPLACED) this.sendTo(ws, { t: "err", v: 1, code: "replaced" });
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  /** Spends one token of the socket's bucket; false when it has none (the frame is dropped). */
  private take(ws: WebSocket, role: RideRole, now: number): boolean {
    const rule = FRAME_RATE[role];
    let bucket = this.buckets.get(ws);
    if (!bucket) {
      bucket = { tokens: rule.burst, at: now, strikes: 0, lastStrikeAt: 0 };
      this.buckets.set(ws, bucket);
    }
    bucket.tokens = Math.min(rule.burst, bucket.tokens + ((now - bucket.at) / 1000) * rule.perSec);
    bucket.at = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  private forgive(ws: WebSocket, now: number): void {
    const bucket = this.buckets.get(ws);
    if (bucket && bucket.strikes > 0 && now - bucket.lastStrikeAt >= STRIKE_FORGIVE_MS) bucket.strikes = 0;
  }

  /** A frame the relay refuses: the sender is told why; an oversized frame, or too many strikes, closes the socket. */
  private strike(ws: WebSocket, code: ErrCode, now: number): void {
    const bucket = this.buckets.get(ws);
    if (bucket) {
      if (now - bucket.lastStrikeAt >= STRIKE_FORGIVE_MS) bucket.strikes = 0;
      bucket.strikes += 1;
      bucket.lastStrikeAt = now;
    }
    this.sendTo(ws, { t: "err", v: 1, code });
    if (code === "too_large" || (bucket?.strikes ?? 0) >= STRIKES_BEFORE_CLOSE) this.closeWith(ws, CLOSE_POLICY, code);
  }
}

import {
  PING_TEXT,
  encode,
  parseMessage,
  wsPath,
  type CreateRoomResponse,
  type CtlAction,
  type StateMsg,
  type SumMsg,
} from "../../../../src/features/ride/protocol.ts";
import type { DataSource, LiveSample, SourceState } from "../live.ts";

const DEFAULT_API = "https://api.fit.joyorogo.com";
const STORAGE_KEY = "joyofit-ride-room";
const PING_MS = 20_000;
const MAX_BACKOFF_MS = 15_000;

/** What the phone can ask the game to do. */
export type RoomCommand = { type: "gear"; d: 1 | -1 } | { type: "ctl"; action: CtlAction };

export interface RoomInfo {
  roomId: string;
  token: string;
  code: string;
  /** Epoch ms after which the code no longer joins. */
  codeExpiresAt: number;
}

/** The relay base URL: `?relay=http://localhost:8787` for `wrangler dev`, otherwise the production API. */
export function relayBase(): string {
  const override = new URLSearchParams(window.location.search).get("relay");
  return (override || import.meta.env.VITE_RIDE_API || DEFAULT_API).replace(/\/+$/, "");
}

export async function createRoom(base = relayBase()): Promise<RoomInfo> {
  const res = await fetch(`${base}/ride/rooms`, { method: "POST" });
  if (!res.ok) throw new Error(`rooms ${res.status}`);
  const body = (await res.json()) as CreateRoomResponse;
  return { roomId: body.roomId, token: body.token, code: body.code, codeExpiresAt: body.codeExpiresAt };
}

function loadStored(): RoomInfo | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RoomInfo) : null;
  } catch {
    return null;
  }
}

function store(info: RoomInfo | null): void {
  try {
    if (info) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(info));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: a reload just makes a new room.
  }
}

/**
 * The web side of a ride room (see src/features/ride/protocol.ts). Creates the room (or resumes the one this tab
 * made before a reload), keeps the WebSocket alive, and turns the phone's frames into samples and commands.
 */
export class RoomSource implements DataSource {
  readonly kind = "room" as const;
  state: SourceState = "idle";
  detail: string | undefined;
  room: RoomInfo | null = null;
  /** Rider weight from the phone's profile, once it said hello. */
  massKg: number | undefined;
  phoneApp: string | undefined;

  private sampleListeners = new Set<(s: LiveSample) => void>();
  private stateListeners = new Set<() => void>();
  private commandListeners = new Set<(c: RoomCommand) => void>();
  private socket: WebSocket | null = null;
  private pingTimer = 0;
  private retryTimer = 0;
  private attempt = 0;
  private stopped = true;
  private pendingSum: SumMsg | null = null;

  constructor(private readonly base: string = relayBase()) {}

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.setState("connecting");
    this.room = loadStored();
    try {
      if (!this.room) await this.newRoom();
    } catch (e) {
      this.fail(e);
      return;
    }
    this.connect();
  }

  /** Throws the room away and starts a fresh one (expired code, or the player wants a new pairing). */
  async renew(): Promise<void> {
    this.closeSocket();
    window.clearTimeout(this.retryTimer);
    this.massKg = undefined;
    this.phoneApp = undefined;
    store(null);
    this.setState("connecting");
    try {
      await this.newRoom();
    } catch (e) {
      this.fail(e);
      return;
    }
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.retryTimer);
    this.closeSocket();
    this.setState("idle");
  }

  onSample(fn: (s: LiveSample) => void): () => void {
    this.sampleListeners.add(fn);
    return () => this.sampleListeners.delete(fn);
  }

  onState(fn: () => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  onCommand(fn: (c: RoomCommand) => void): () => void {
    this.commandListeners.add(fn);
    return () => this.commandListeners.delete(fn);
  }

  sendCtl(action: CtlAction): void {
    this.send({ t: "ctl", v: 1, action });
  }

  sendState(st: Omit<StateMsg, "t" | "v">): void {
    this.send({ t: "st", v: 1, ...st });
  }

  /** Sends the summary now, or as soon as the socket is back. */
  sendSum(sum: SumMsg): boolean {
    this.pendingSum = sum;
    return this.flushSum();
  }

  private flushSum(): boolean {
    if (!this.pendingSum || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(encode(this.pendingSum));
    this.pendingSum = null;
    return true;
  }

  private send(msg: Parameters<typeof encode>[0]): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(encode(msg));
  }

  private async newRoom(): Promise<void> {
    this.room = await createRoom(this.base);
    store(this.room);
  }

  private setState(state: SourceState, detail?: string): void {
    this.state = state;
    this.detail = detail;
    for (const fn of this.stateListeners) fn();
  }

  private fail(e: unknown): void {
    this.stopped = true;
    this.setState("error", e instanceof Error ? e.message : String(e));
  }

  private closeSocket(): void {
    window.clearInterval(this.pingTimer);
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onopen = s.onmessage = s.onclose = s.onerror = null;
      s.close();
    }
  }

  private connect(): void {
    const room = this.room;
    if (!room || this.stopped) return;
    this.closeSocket();
    const url = this.base.replace(/^http/, "ws") + wsPath(room.roomId, "web", room.token);
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.setState("waiting");
      this.send({ t: "hello", v: 1, role: "web", app: "JoyoFit Ride web" });
      this.flushSum();
      this.pingTimer = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(PING_TEXT);
      }, PING_MS);
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data === "string") this.handle(ev.data);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      window.clearInterval(this.pingTimer);
      this.socket = null;
      if (this.stopped) return;
      this.setState("lost");
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt++);
      this.retryTimer = window.setTimeout(() => this.connect(), delay);
    };
  }

  private handle(raw: string): void {
    const parsed = parseMessage(raw);
    if (!parsed.ok) return;
    const msg = parsed.msg;
    switch (msg.t) {
      case "room":
        this.setState(msg.phone ? "live" : "waiting", this.phoneApp);
        break;
      case "hello":
        if (msg.role === "phone") {
          this.massKg = msg.massKg;
          this.phoneApp = msg.app;
          this.setState("live", msg.app);
        }
        break;
      case "s":
        for (const fn of this.sampleListeners) fn({ hr: msg.hr, cad: msg.cad, pwr: msg.pwr, at: Date.now() });
        if (this.state !== "live") this.setState("live", this.phoneApp);
        break;
      case "gear":
        for (const fn of this.commandListeners) fn({ type: "gear", d: msg.d });
        break;
      case "ctl":
        for (const fn of this.commandListeners) fn({ type: "ctl", action: msg.action });
        break;
      case "err":
        if (msg.code === "expired") {
          this.closeSocket();
          store(null);
          this.room = null;
          this.stopped = true;
          this.setState("error", msg.code);
        }
        break;
      default:
        break;
    }
  }
}

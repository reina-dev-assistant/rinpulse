import { env, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  CODE_TTL_MS,
  MAX_MESSAGE_BYTES,
  PING_TEXT,
  PONG_TEXT,
  ROOM_IDLE_MS,
  type CreateRoomResponse,
  type JoinRoomResponse,
  type RideMsg,
} from "../../src/features/ride/protocol";
import { LIMIT_CREATE_PER_IP, MAX_WEB_SOCKETS, STRIKES_BEFORE_CLOSE } from "../src/ride/limits";
import type { RideRoom } from "../src/ride/room";
import { call, postJson, signUp } from "./helpers";

type Frame = RideMsg & { rt?: number };

/** Wakes every waiter when any socket of the test receives something or closes. */
const activity = new Set<() => void>();
const announce = () => {
  for (const wake of [...activity]) wake();
};

/** Resolves when `ready()` is true, re-checking on every frame or close any peer sees. The test's own timeout bounds the wait. */
async function until(ready: () => boolean): Promise<void> {
  while (!ready()) {
    const { promise, resolve } = Promise.withResolvers<void>();
    activity.add(resolve);
    await promise;
    activity.delete(resolve);
  }
}

/** One side of a room: collects the frames the relay sends and lets a test wait for the next one it cares about. */
class Peer {
  readonly inbox: Frame[] = [];
  readonly texts: string[] = [];
  closed: { code: number; reason: string } | null = null;

  constructor(readonly ws: WebSocket) {
    ws.accept();
    ws.addEventListener("message", (event) => {
      const text = String(event.data);
      this.texts.push(text);
      this.inbox.push(JSON.parse(text) as Frame);
      announce();
    });
    ws.addEventListener("close", (event) => {
      this.closed = { code: event.code, reason: event.reason };
      announce();
    });
  }

  send(msg: object | string | ArrayBuffer) {
    this.ws.send(typeof msg === "string" || msg instanceof ArrayBuffer ? msg : JSON.stringify(msg));
  }

  /** Resolves with the first not yet consumed frame the predicate accepts; consumed frames are removed. */
  async next<T extends Frame = Frame>(match: (f: Frame) => boolean): Promise<T> {
    let at = -1;
    await until(() => {
      at = this.inbox.findIndex(match);
      return at >= 0 || this.closed !== null;
    });
    if (at < 0) throw new Error(`socket closed (${this.closed?.code} ${this.closed?.reason}) while waiting; inbox: ${JSON.stringify(this.inbox)}`);
    return this.inbox.splice(at, 1)[0] as T;
  }

  ofType<T extends Frame>(t: string): Promise<T> {
    return this.next<T>((f) => f.t === t);
  }

  async waitClosed(): Promise<{ code: number; reason: string }> {
    await until(() => this.closed !== null);
    return this.closed!;
  }
}

/**
 * Resolves once the relay has handled every frame `from` sent before this call: a `lap` goes round the relay and comes out at `to`
 * (a socket's frames are handled in order), so what is in `to.inbox` afterwards is everything the earlier frames produced.
 */
async function flush(from: Peer, to: Peer): Promise<void> {
  from.send({ t: "ctl", v: 1, action: "lap" });
  await to.next((f) => f.t === "ctl" && f.action === "lap");
}

/** Durable Object storage is not reset between tests, so every room gets its own client address (the create limit is per address). */
let nextHost = 1;
const freshIp = () => `10.1.${Math.floor(nextHost / 250)}.${(nextHost++ % 250) + 1}`;

const create = async (ip = freshIp()) => {
  const res = await call("/ride/rooms", { method: "POST", headers: { "cf-connecting-ip": ip } });
  expect(res.status).toBe(200);
  return (await res.json()) as CreateRoomResponse;
};

const joinWith = (cookie: string, code: string, ip = freshIp()) =>
  call("/ride/rooms/join", { method: "POST", body: JSON.stringify({ code }), headers: { "content-type": "application/json", "cf-connecting-ip": ip }, cookie });

async function joinPhone(cookie: string, code: string): Promise<JoinRoomResponse> {
  const res = await joinWith(cookie, code);
  expect(res.status).toBe(200);
  return (await res.json()) as JoinRoomResponse;
}

async function open(roomId: string, role: "phone" | "web", token: string): Promise<Peer> {
  const res = await call(`/ride/rooms/${roomId}/ws?role=${role}&token=${encodeURIComponent(token)}`, { headers: { Upgrade: "websocket" } });
  expect(res.status).toBe(101);
  return new Peer(res.webSocket as WebSocket);
}

/** A room with a phone and a web connected, their presence frames drained. */
async function room() {
  const made = await create();
  const { cookie, user } = signUp("rider");
  const joined = await joinPhone(cookie, made.code);
  const web = await open(made.roomId, "web", made.token);
  const phone = await open(made.roomId, "phone", joined.token);
  await phone.next((f) => f.t === "room" && f.phone);
  await web.next((f) => f.t === "room" && f.phone);
  return { made, cookie, user, joined, web, phone, stub: () => env.RIDE_ROOM.get(env.RIDE_ROOM.idFromString(made.roomId)) };
}

const sample = (extra: object = {}) => ({ t: "s", v: 1, ts: Date.now(), hr: 128, cad: 86, ...extra });
const hello = (role: "phone" | "web", extra: object = {}) => ({ t: "hello", v: 1, role, app: "test", ...extra });

describe("POST /ride/rooms", () => {
  it("opens a room with a six digit code, a web token and the code's deadline, for any origin", async () => {
    const before = Date.now();
    const res = await call("/ride/rooms", { method: "POST", headers: { origin: "https://localhost:5173", "cf-connecting-ip": "198.51.100.1" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await res.json()) as CreateRoomResponse;
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.roomId).toMatch(/^[0-9a-f]{64}$/);
    expect(body.token.length).toBeGreaterThanOrEqual(30);
    expect(body.codeExpiresAt).toBeGreaterThanOrEqual(before + CODE_TTL_MS);
    expect(body.codeExpiresAt).toBeLessThanOrEqual(Date.now() + CODE_TTL_MS);
  });

  it("answers the preflight", async () => {
    const res = await call("/ride/rooms", {
      method: "OPTIONS",
      headers: { origin: "https://example.org", "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("gives two rooms two codes and two ids", async () => {
    const a = await create("203.0.113.10");
    const b = await create("203.0.113.11");
    expect(a.roomId).not.toBe(b.roomId);
    expect(a.code).not.toBe(b.code);
  });

  it("stops one address after its limit, with Retry-After, and leaves another address alone", async () => {
    for (let i = 0; i < LIMIT_CREATE_PER_IP.max; i++) await create("192.0.2.50");
    const refused = await call("/ride/rooms", { method: "POST", headers: { "cf-connecting-ip": "192.0.2.50" } });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await refused.json()).toEqual({ error: "rate_limited" });
    await create("192.0.2.51");
  });
});

describe("POST /ride/rooms/join", () => {
  it("needs a JoyoRogo session", async () => {
    const made = await create();
    expect((await postJson("/ride/rooms/join", { code: made.code })).status).toBe(401);
  });

  it("joins by code and hands out the room id and a phone token that opens the socket", async () => {
    const made = await create();
    const { cookie } = signUp("ani");
    const joined = await joinPhone(cookie, made.code);
    expect(joined.roomId).toBe(made.roomId);
    expect(joined.token).not.toBe(made.token);
    const phone = await open(joined.roomId, "phone", joined.token);
    expect((await phone.ofType<Frame & { phone: boolean }>("room")).phone).toBe(true);
  });

  it("refuses a malformed code (400), an unknown one (404) and nothing else leaks", async () => {
    const { cookie } = signUp("budi");
    for (const code of ["12345", "1234567", "abcdef", ""]) expect((await joinWith(cookie, code)).status).toBe(400);
    expect((await postJson("/ride/rooms/join", { nope: 1 }, cookie)).status).toBe(400);
    const res = await joinWith(cookie, "000000");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "code_not_found" });
  });

  it("lets only one user be the phone; the same user may join again and the old token stops working", async () => {
    const made = await create();
    const first = signUp("citra");
    const other = signUp("dewi");
    const joined = await joinPhone(first.cookie, made.code);
    const taken = await joinWith(other.cookie, made.code);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "room_taken" });

    const again = await joinPhone(first.cookie, made.code);
    expect(again.token).not.toBe(joined.token);
    const stale = await call(`/ride/rooms/${made.roomId}/ws?role=phone&token=${joined.token}`, { headers: { Upgrade: "websocket" } });
    expect(stale.status).toBe(401);
    expect((await open(made.roomId, "phone", again.token)).ws).toBeTruthy();
  });

  it("a code stops working after ten minutes", async () => {
    const made = await create();
    const { cookie } = signUp("eka");
    const index = env.RIDE_INDEX.getByName(`code:${made.code}`);
    expect(await index.resolve(Date.now())).toBe(made.roomId);
    expect(await index.resolve(Date.now() + CODE_TTL_MS + 1)).toBeNull();
    await runInDurableObject(index, async (_instance, state) => {
      await state.storage.put("code", { roomId: made.roomId, expiresAt: Date.now() - 1 });
    });
    expect((await joinWith(cookie, made.code)).status).toBe(404);
  });

  it("holds a code for one room at a time, and frees it when it expires", async () => {
    const index = env.RIDE_INDEX.getByName("code:424242");
    const t0 = Date.now();
    expect(await index.claim("room-a", CODE_TTL_MS, t0)).toBe(true);
    expect(await index.claim("room-b", CODE_TTL_MS, t0 + 1000)).toBe(false);
    expect(await index.resolve(t0 + 1000)).toBe("room-a");
    expect(await index.claim("room-b", CODE_TTL_MS, t0 + CODE_TTL_MS)).toBe(true);
    expect(await index.resolve(t0 + CODE_TTL_MS)).toBe("room-b");
  });

  it("the index cleans its storage with its alarm", async () => {
    const index = env.RIDE_INDEX.getByName("code:515151");
    expect(await index.claim("room-a", CODE_TTL_MS, Date.now())).toBe(true);
    await runInDurableObject(index, async (_instance, state) => {
      await state.storage.put("code", { roomId: "room-a", expiresAt: Date.now() - 1 });
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(index)).toBe(true);
    await runInDurableObject(index, async (_instance, state) => {
      expect(await state.storage.get("code")).toBeUndefined();
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it("limits the joins of one user", async () => {
    const { cookie } = signUp("fajar");
    for (let i = 0; i < 10; i++) expect((await joinWith(cookie, "111111")).status).toBe(404);
    const refused = await joinWith(cookie, "111111");
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("WebSocket upgrade", () => {
  it("needs the Upgrade header, a valid role, a token, an existing room", async () => {
    const made = await create();
    expect((await call(`/ride/rooms/${made.roomId}/ws?role=web&token=${made.token}`)).status).toBe(426);
    expect((await call(`/ride/rooms/${made.roomId}/ws?role=admin&token=${made.token}`, { headers: { Upgrade: "websocket" } })).status).toBe(400);
    expect((await call(`/ride/rooms/${made.roomId}/ws?role=web`, { headers: { Upgrade: "websocket" } })).status).toBe(400);
    expect((await call(`/ride/rooms/not-an-id/ws?role=web&token=x`, { headers: { Upgrade: "websocket" } })).status).toBe(404);
    const unknown = env.RIDE_ROOM.newUniqueId().toString();
    expect((await call(`/ride/rooms/${unknown}/ws?role=web&token=x`, { headers: { Upgrade: "websocket" } })).status).toBe(404);
  });

  it("checks the token for the role: a wrong one, and the web token as a phone, are 401", async () => {
    const made = await create();
    const { cookie } = signUp("gita");
    const joined = await joinPhone(cookie, made.code);
    const upgrade = { headers: { Upgrade: "websocket" } };
    expect((await call(`/ride/rooms/${made.roomId}/ws?role=web&token=wrong`, upgrade)).status).toBe(401);
    expect((await call(`/ride/rooms/${made.roomId}/ws?role=phone&token=${made.token}`, upgrade)).status).toBe(401);
    expect((await call(`/ride/rooms/${made.roomId}/ws?role=web&token=${joined.token}`, upgrade)).status).toBe(401);
    expect((await call(`/ride/rooms/${made.roomId}/ws?role=phone&token=${joined.token}`, upgrade)).status).toBe(101);
  });

  it("refuses a phone before anyone joined as one", async () => {
    const made = await create();
    const res = await call(`/ride/rooms/${made.roomId}/ws?role=phone&token=${made.token}`, { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(401);
  });

  it("takes a limited number of web viewers", async () => {
    const made = await create();
    const peers: Peer[] = [];
    for (let i = 0; i < MAX_WEB_SOCKETS; i++) peers.push(await open(made.roomId, "web", made.token));
    const full = await call(`/ride/rooms/${made.roomId}/ws?role=web&token=${made.token}`, { headers: { Upgrade: "websocket" } });
    expect(full.status).toBe(429);
    expect(await full.json()).toEqual({ error: "room_full" });
  });
});

describe("relay", () => {
  it("tells everyone who is connected, on every join and leave", async () => {
    const made = await create();
    const { cookie } = signUp("hana");
    const web = await open(made.roomId, "web", made.token);
    const lobby = await web.ofType<Frame & { phone: boolean; webs: number; expiresAt: number }>("room");
    expect(lobby).toMatchObject({ phone: false, webs: 1 });
    expect(lobby.expiresAt).toBeGreaterThan(Date.now() + ROOM_IDLE_MS - 60_000);

    const joined = await joinPhone(cookie, made.code);
    const phone = await open(made.roomId, "phone", joined.token);
    expect(await web.next((f) => f.t === "room" && f.phone)).toMatchObject({ phone: true, webs: 1 });
    expect(await phone.next((f) => f.t === "room")).toMatchObject({ phone: true, webs: 1 });

    const second = await open(made.roomId, "web", made.token);
    expect(await phone.next((f) => f.t === "room" && f.webs === 2)).toMatchObject({ phone: true, webs: 2 });
    second.ws.close(1000, "bye");
    expect(await phone.next((f) => f.t === "room" && f.webs === 1)).toMatchObject({ phone: true, webs: 1 });
    phone.ws.close(1000, "bye");
    expect(await web.next((f) => f.t === "room" && !f.phone)).toMatchObject({ phone: false, webs: 1 });
  });

  it("forwards phone samples to every web, stamped, with only the fields it validated", async () => {
    const { made, web, phone } = await room();
    const spectator = await open(made.roomId, "web", made.token);
    await spectator.ofType("room");
    phone.send(sample({ rr: [800, 810], evil: "<script>" }));
    for (const peer of [web, spectator]) {
      const got = await peer.ofType<Frame & { hr: number; cad: number; rr: number[]; rt: number }>("s");
      expect(got).toMatchObject({ v: 1, hr: 128, cad: 86, rr: [800, 810] });
      expect("evil" in got).toBe(false);
      expect("pwr" in got).toBe(false);
      expect(Math.abs(got.rt - Date.now())).toBeLessThan(5000);
    }
    await flush(web, phone);
    expect(phone.inbox.filter((f) => f.t === "s")).toEqual([]);
  });

  it("routes control, gear and state to the other side only", async () => {
    const { web, phone } = await room();
    web.send({ t: "ctl", v: 1, action: "start" });
    expect(await phone.ofType("ctl")).toMatchObject({ action: "start" });
    phone.send({ t: "ctl", v: 1, action: "pause" });
    expect(await web.ofType("ctl")).toMatchObject({ action: "pause" });
    phone.send({ t: "gear", v: 1, d: 1 });
    expect(await web.ofType("gear")).toMatchObject({ d: 1 });
    web.send({ t: "st", v: 1, gear: 7, gearCount: 15, route: "Bukit", phase: "riding", distM: 1200, elevM: 30, grade: 2.5, vKmh: 29, pwrEst: 180 });
    expect(await phone.ofType("st")).toMatchObject({ gear: 7, route: "Bukit", phase: "riding", pwrEst: 180 });
    await flush(phone, web);
    expect(web.inbox.filter((f) => f.t === "st" || f.t === "gear")).toEqual([]);
  });

  it("sends the game's state to spectators too, but not back to the web that sent it", async () => {
    const { made, web, phone } = await room();
    const spectator = await open(made.roomId, "web", made.token);
    await spectator.ofType("room");
    web.send({ t: "st", v: 1, gear: 3, gearCount: 15, route: "Bukit", phase: "riding", distM: 500, elevM: 10, grade: 1, vKmh: 25, pwrEst: 150 });
    expect(await spectator.ofType("st")).toMatchObject({ gear: 3, vKmh: 25 });
    expect(await phone.ofType("st")).toMatchObject({ gear: 3 });
    await flush(phone, web);
    expect(web.inbox.filter((f) => f.t === "st")).toEqual([]);
  });

  it("keeps the phone's hello for a viewer who comes later", async () => {
    const { made, phone, web } = await room();
    phone.send(hello("phone", { app: "JoyoFit 9", massKg: 68 }));
    await flush(phone, web);
    const late = await open(made.roomId, "web", made.token);
    expect(await late.ofType("hello")).toMatchObject({ role: "phone", app: "JoyoFit 9", massKg: 68 });
  });

  it("passes the web's hello to the phone", async () => {
    const { web, phone } = await room();
    web.send(hello("web", { app: "JoyoFit Ride" }));
    expect(await phone.ofType("hello")).toMatchObject({ role: "web", app: "JoyoFit Ride" });
  });

  it("answers the exact ping text itself, and a ping object too", async () => {
    const { web } = await room();
    web.send(PING_TEXT);
    await web.next(() => web.texts.includes(PONG_TEXT));
    web.send({ t: "ping", extra: 1 });
    await web.next(() => web.texts.filter((t) => t === PONG_TEXT).length >= 2);
  });

  it("keeps working after the room object was evicted and its sockets hibernated", async () => {
    const { web, phone, stub } = await room();
    await evictDurableObject(stub());
    phone.send(sample({ hr: 141 }));
    expect(await web.ofType("s")).toMatchObject({ hr: 141 });
    web.send({ t: "ctl", v: 1, action: "lap" });
    expect(await phone.ofType("ctl")).toMatchObject({ action: "lap" });
  });
});

describe("summary hand-back", () => {
  const summary = { t: "sum", v: 1, distM: 15234.5, elevM: 210, route: "Bukit Jam", laps: [{ sec: 900, distM: 7600 }, { sec: 905, distM: 7634.5 }] };

  it("is forwarded to the phone and kept until the phone confirms it", async () => {
    const { made, web, phone, joined } = await room();
    web.send(summary);
    expect(await phone.ofType("sum")).toMatchObject({ distM: 15234.5, elevM: 210, route: "Bukit Jam", laps: summary.laps });

    // The phone drops off before it saved: the next connection gets the summary again.
    phone.ws.close(1000, "gone");
    await web.next((f) => f.t === "room" && !f.phone);
    const back = await open(made.roomId, "phone", joined.token);
    expect(await back.ofType("sum")).toMatchObject({ distM: 15234.5 });

    back.send({ t: "ack", v: 1, of: "sum" });
    await flush(back, web);
    back.ws.close(1000, "gone");
    await web.next((f) => f.t === "room" && !f.phone);
    const again = await open(made.roomId, "phone", joined.token);
    await again.ofType("room");
    await flush(web, again);
    expect(again.inbox.filter((f) => f.t === "sum")).toEqual([]);
  });

  it("waits for a phone that was not connected when the game ended", async () => {
    const made = await create();
    const web = await open(made.roomId, "web", made.token);
    await web.ofType("room");
    web.send(summary);
    const { cookie } = signUp("indra");
    const joined = await joinPhone(cookie, made.code);
    const phone = await open(made.roomId, "phone", joined.token);
    expect(await phone.ofType("sum")).toMatchObject({ route: "Bukit Jam" });
  });

  it("only the web may send one, and a broken one is refused", async () => {
    const { web, phone } = await room();
    phone.send(summary);
    expect(await phone.ofType("err")).toMatchObject({ code: "not_allowed" });
    web.send({ ...summary, laps: [1] });
    expect(await web.ofType("err")).toMatchObject({ code: "bad_message" });
    await flush(web, phone);
    expect(phone.inbox.filter((f) => f.t === "sum")).toEqual([]);
  });
});

describe("abuse handling", () => {
  it("tells the sender why a frame was refused and forwards nothing", async () => {
    const { web, phone } = await room();
    phone.send("not json");
    expect(await phone.ofType("err")).toMatchObject({ code: "bad_message" });
    phone.send({ t: "s", v: 1, ts: 1, hr: 9999 });
    expect(await phone.ofType("err")).toMatchObject({ code: "bad_message" });
    phone.send({ t: "st", v: 1, gear: 1, gearCount: 2, route: "r", phase: "riding", distM: 0, elevM: 0, grade: 0, vKmh: 0, pwrEst: 0 });
    expect(await phone.ofType("err")).toMatchObject({ code: "not_allowed" });
    web.send(sample());
    expect(await web.ofType("err")).toMatchObject({ code: "not_allowed" });
    phone.send(hello("web"));
    expect(await phone.ofType("err")).toMatchObject({ code: "not_allowed" });
    phone.send(new Uint8Array([1, 2, 3]).buffer);
    expect(await phone.ofType("err")).toMatchObject({ code: "bad_message" });
    await flush(phone, web);
    expect(web.inbox.filter((f) => f.t !== "room" && f.t !== "err")).toEqual([]);
    expect(phone.closed).toBeNull();
  });

  it("closes a socket that sends a frame over 2 KB", async () => {
    const { phone, web } = await room();
    phone.send(JSON.stringify(hello("phone", { app: "x".repeat(MAX_MESSAGE_BYTES) })));
    expect(await phone.ofType("err")).toMatchObject({ code: "too_large" });
    expect(await phone.waitClosed()).toMatchObject({ code: 1008, reason: "too_large" });
    await web.next((f) => f.t === "room" && !f.phone);
  });

  it("closes a socket that keeps sending garbage", async () => {
    const { phone } = await room();
    for (let i = 0; i < STRIKES_BEFORE_CLOSE; i++) phone.send("garbage");
    expect(await phone.waitClosed()).toMatchObject({ code: 1008, reason: "bad_message" });
  });

  it("drops the frames over a socket's rate and says so, without closing it for a short burst", async () => {
    const { web, phone } = await room();
    const count = 36;
    for (let i = 0; i < count; i++) phone.send(sample({ hr: 100 + i }));
    const limited = () => phone.inbox.filter((f) => f.t === "err" && f.code === "rate_limited").length;
    const delivered = () => web.inbox.filter((f) => f.t === "s").length;
    await until(() => limited() + delivered() === count);
    expect(limited()).toBeGreaterThanOrEqual(1);
    expect(delivered()).toBeGreaterThanOrEqual(30);
    expect(phone.closed).toBeNull();
  });

  it("closes a socket that floods", async () => {
    const { web, phone } = await room();
    for (let i = 0; i < 60; i++) phone.send(sample({ hr: 100 + (i % 50) }));
    expect(await phone.waitClosed()).toMatchObject({ code: 1008, reason: "rate_limited" });
    expect(web.inbox.filter((f) => f.t === "s").length).toBeLessThan(45);
  });

  it("a second phone takes over and the first is closed as replaced", async () => {
    const { made, phone, cookie, web } = await room();
    const again = await joinPhone(cookie, made.code);
    const fresh = await open(made.roomId, "phone", again.token);
    expect(await phone.ofType("err")).toMatchObject({ code: "replaced" });
    expect(await phone.waitClosed()).toMatchObject({ code: 4001 });
    fresh.send(sample({ hr: 150 }));
    expect(await web.ofType("s")).toMatchObject({ hr: 150 });
  });
});

describe("expiry", () => {
  it("a room with recent traffic survives its alarm and sets the next one", async () => {
    const { stub, phone, web } = await room();
    phone.send(sample());
    await web.ofType("s");
    expect(await runDurableObjectAlarm(stub())).toBe(true);
    await runInDurableObject(stub(), async (_instance, state) => {
      expect(await state.storage.get("room")).toBeTruthy();
      expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now());
    });
    phone.send(sample({ hr: 99 }));
    expect(await web.ofType("s")).toMatchObject({ hr: 99 });
  });

  it("closes the sockets, forgets the room and answers 404 after three idle hours", async () => {
    const made = await create();
    const web = await open(made.roomId, "web", made.token);
    await web.ofType("room");
    const stub = env.RIDE_ROOM.get(env.RIDE_ROOM.idFromString(made.roomId));
    await runInDurableObject(stub, async (instance: RideRoom, state) => {
      // Connecting counted as traffic; the room has been silent since, as far as the alarm can tell.
      (instance as unknown as { trafficAt: number }).trafficAt = 0;
      const stored = (await state.storage.get<{ lastActivity: number }>("room"))!;
      await state.storage.put("room", { ...stored, lastActivity: Date.now() - ROOM_IDLE_MS - 1000 });
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await web.ofType("err")).toMatchObject({ code: "expired" });
    expect(await web.waitClosed()).toMatchObject({ code: 4002 });
    const gone = await call(`/ride/rooms/${made.roomId}/ws?role=web&token=${made.token}`, { headers: { Upgrade: "websocket" } });
    expect(gone.status).toBe(404);
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });

  it("a new room sets its idle alarm three hours out", async () => {
    const made = await create();
    const stub = env.RIDE_ROOM.get(env.RIDE_ROOM.idFromString(made.roomId));
    await runInDurableObject(stub, async (_instance, state) => {
      const alarm = (await state.storage.getAlarm())!;
      expect(alarm).toBeGreaterThan(Date.now() + ROOM_IDLE_MS - 60_000);
      expect(alarm).toBeLessThanOrEqual(Date.now() + ROOM_IDLE_MS);
    });
  });

  it("stores only hashes of the tokens", async () => {
    const made = await create();
    const { cookie } = signUp("joko");
    const joined = await joinPhone(cookie, made.code);
    const stub = env.RIDE_ROOM.get(env.RIDE_ROOM.idFromString(made.roomId));
    await runInDurableObject(stub, async (_instance, state) => {
      const dump = JSON.stringify(await state.storage.get("room"));
      expect(dump).not.toContain(made.token);
      expect(dump).not.toContain(joined.token);
    });
  });
});

describe("leaderboard", () => {
  const submit = (roomId: string, body: object, ip = freshIp()) =>
    call(`/ride/rooms/${roomId}/result`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "cf-connecting-ip": ip } });

  /** Starts a ride the way the game does, streams cadence, then moves the relay's ride start back by [ageS]. */
  async function riddenRoom(cads: number[], ageS: number) {
    const r = await room();
    r.web.send({ t: "ctl", v: 1, action: "start" });
    await r.phone.ofType("ctl");
    for (const cad of cads) r.phone.send(sample({ cad }));
    await until(() => r.web.inbox.filter((f) => f.t === "s").length >= cads.length);
    await runInDurableObject(r.stub(), async (instance: RideRoom) => {
      const state = (instance as unknown as { room: { evidence: { startedAt: number } } }).room;
      state.evidence.startedAt = Date.now() - ageS * 1000;
    });
    return r;
  }

  it("accepts a finish the relay saw cadence for, once, and lists it under a short public name", async () => {
    const r = await riddenRoom(Array.from({ length: 30 }, () => 88), 30);
    const body = { token: r.made.token, routeId: "kebun", timeS: 25, distM: 3000, avgCad: 87 };
    // 3 km in 25 s is far faster than anyone rides.
    expect(await (await submit(r.made.roomId, body)).json()).toEqual({ error: "too_fast" });
    const ok = await submit(r.made.roomId, { ...body, timeS: 400 });
    // The relay only knows about 30 s of riding.
    expect(await ok.json()).toEqual({ error: "too_long" });

    await runInDurableObject(r.stub(), async (instance: RideRoom) => {
      const ev = (instance as unknown as { room: { evidence: { startedAt: number; cadSamples: number; cadSum: number } } }).room.evidence;
      ev.startedAt = Date.now() - 420_000;
      ev.cadSamples = 1600;
      ev.cadSum = 1600 * 88;
    });
    const accepted = await submit(r.made.roomId, { ...body, timeS: 400 });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ rank: 1 });
    const again = await submit(r.made.roomId, { ...body, timeS: 390 });
    expect(await again.json()).toEqual({ error: "already_submitted" });

    const board = (await (await call("/ride/leaderboard?route=kebun&board=all")).json()) as { rows: { rank: number; name: string | null; timeS: number }[] };
    expect(board.rows[0]).toMatchObject({ rank: 1, name: "rider", timeS: 400 });
  });

  it("refuses a ride with too few phone samples, a cadence that disagrees, a stolen token, or no ride at all", async () => {
    const thin = await riddenRoom([90, 90, 90], 500);
    const base = { token: thin.made.token, routeId: "kebun", timeS: 450, distM: 3000, avgCad: 90 };
    expect(await (await submit(thin.made.roomId, base)).json()).toEqual({ error: "no_sensor" });

    await runInDurableObject(thin.stub(), async (instance: RideRoom) => {
      const ev = (instance as unknown as { room: { evidence: { cadSamples: number; cadSum: number } } }).room.evidence;
      ev.cadSamples = 2000;
      ev.cadSum = 2000 * 60;
    });
    expect(await (await submit(thin.made.roomId, base)).json()).toEqual({ error: "cadence_mismatch" });
    expect((await submit(thin.made.roomId, { ...base, token: "nope" })).status).toBe(401);

    const idle = await room();
    expect(await (await submit(idle.made.roomId, { ...base, token: idle.made.token })).json()).toEqual({ error: "no_ride" });
  });

  it("an anonymous finish is ranked without a name, and an unknown route is a 400", async () => {
    const r = await riddenRoom([], 1600);
    await runInDurableObject(r.stub(), async (instance: RideRoom) => {
      const ev = (instance as unknown as { room: { evidence: { cadSamples: number; cadSum: number } } }).room.evidence;
      ev.cadSamples = 4000;
      ev.cadSum = 4000 * 70;
    });
    const res = await submit(r.made.roomId, { token: r.made.token, routeId: "bromo", timeS: 1500, distM: 8000, avgCad: 70, anon: true });
    expect(res.status).toBe(200);
    const board = (await (await call("/ride/leaderboard?route=bromo&board=today")).json()) as { rows: { name: string | null }[] };
    expect(board.rows[0]!.name).toBeNull();
    expect((await call("/ride/leaderboard?route=nowhere")).status).toBe(400);
  });
});

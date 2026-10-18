import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";

import { encode, parseMessage, type RideMsg } from "../../../../src/features/ride/protocol.ts";
import type { LiveSample } from "../live.ts";
import { RoomSource, type RoomCommand } from "./room.ts";

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(text: string) {
    this.sent.push(text);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: RideMsg) {
    this.onmessage?.({ data: encode(msg) });
  }
  sentMessages(): RideMsg[] {
    return this.sent.flatMap((raw) => {
      const p = parseMessage(raw);
      return p.ok ? [p.msg] : [];
    });
  }
}

const storage = new Map<string, string>();
const realFetch = globalThis.fetch;
let fetched: { url: string; method: string }[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  storage.clear();
  fetched = [];
  FakeSocket.last = null;
  const g = globalThis as Record<string, unknown>;
  g.window = { location: { search: "" }, setTimeout, clearTimeout, setInterval, clearInterval };
  g.sessionStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  };
  g.WebSocket = FakeSocket;
  g.fetch = async (url: string, init?: { method?: string }) => {
    fetched.push({ url, method: init?.method ?? "GET" });
    return {
      ok: true,
      status: 200,
      json: async () => ({ roomId: "room-1", code: "123456", token: "tok", codeExpiresAt: Date.now() + 600_000 }),
    };
  };
});

afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = realFetch;
});

async function started(): Promise<{ source: RoomSource; socket: FakeSocket }> {
  const source = new RoomSource("http://relay.test");
  await source.start();
  const socket = FakeSocket.last!;
  socket.open();
  return { source, socket };
}

describe("RoomSource", () => {
  test("creates a room, connects as the web role with its token, and says hello", async () => {
    const { source, socket } = await started();
    expect(fetched).toEqual([{ url: "http://relay.test/ride/rooms", method: "POST" }]);
    expect(socket.url).toBe("ws://relay.test/ride/rooms/room-1/ws?role=web&token=tok");
    expect(source.room?.code).toBe("123456");
    expect(source.state).toBe("waiting");
    expect(socket.sentMessages()[0]).toMatchObject({ t: "hello", role: "web" });
  });

  test("the phone joining makes it live; leaving makes it wait again", async () => {
    const { source, socket } = await started();
    socket.receive({ t: "room", v: 1, phone: true, webs: 1, expiresAt: 0 });
    expect(source.state).toBe("live");
    socket.receive({ t: "room", v: 1, phone: false, webs: 1, expiresAt: 0 });
    expect(source.state).toBe("waiting");
  });

  test("sensor frames become samples without inventing missing fields", async () => {
    const { source, socket } = await started();
    const got: LiveSample[] = [];
    source.onSample((s) => got.push(s));
    socket.receive({ t: "s", v: 1, ts: 1, cad: 88, hr: 120 });
    expect(got[0]).toMatchObject({ cad: 88, hr: 120 });
    expect(got[0]!.pwr).toBeUndefined();
  });

  test("hello from the phone supplies the rider's weight", async () => {
    const { source, socket } = await started();
    socket.receive({ t: "hello", v: 1, role: "phone", app: "JoyoFit 9", massKg: 82 });
    expect(source.massKg).toBe(82);
    expect(source.phoneApp).toBe("JoyoFit 9");
  });

  test("gear and control frames from the phone reach the game as commands", async () => {
    const { source, socket } = await started();
    const commands: RoomCommand[] = [];
    source.onCommand((c) => commands.push(c));
    socket.receive({ t: "gear", v: 1, d: 1 });
    socket.receive({ t: "ctl", v: 1, action: "pause" });
    expect(commands).toEqual([
      { type: "gear", d: 1 },
      { type: "ctl", action: "pause" },
    ]);
  });

  test("state, control and summary go to the phone as protocol frames", async () => {
    const { source, socket } = await started();
    source.sendCtl("lap");
    source.sendState({ gear: 3, gearCount: 15, route: "Pantai", phase: "riding", distM: 10, elevM: 1, grade: 1, vKmh: 30, pwrEst: 150 });
    expect(source.sendSum({ t: "sum", v: 1, distM: 100, elevM: 2, route: "Pantai", laps: [{ sec: 10, distM: 100 }] })).toBe(true);
    const types = socket.sentMessages().map((m) => m.t);
    expect(types).toEqual(["hello", "ctl", "st", "sum"]);
  });

  test("a summary sent while the socket is down goes out when it reconnects", async () => {
    const { source, socket } = await started();
    socket.readyState = 3;
    socket.onclose?.();
    expect(source.state).toBe("lost");
    expect(source.sendSum({ t: "sum", v: 1, distM: 5, elevM: 0, route: "Kebun", laps: [] })).toBe(false);
    jest.advanceTimersByTime(1100);
    const next = FakeSocket.last!;
    expect(next).not.toBe(socket);
    next.open();
    expect(next.sentMessages().map((m) => m.t)).toContain("sum");
    source.stop();
  });

  test("an expired room clears the stored room and stops with an error", async () => {
    const { source, socket } = await started();
    expect(storage.has("joyofit-ride-room")).toBe(true);
    socket.receive({ t: "err", v: 1, code: "expired" });
    expect(source.state).toBe("error");
    expect(storage.has("joyofit-ride-room")).toBe(false);
  });

  test("a reload resumes the stored room instead of creating another", async () => {
    await started();
    fetched = [];
    const again = new RoomSource("http://relay.test");
    await again.start();
    expect(fetched).toEqual([]);
    expect(again.room?.roomId).toBe("room-1");
    again.stop();
  });
});

import { describe, expect, it } from "vitest";

import { call, postJson, signUp } from "./helpers";

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86_400;
const step = (timestamp: number, extra: object = {}) => ({ timestamp, steps: 10, calories: 1, distance: 5, heartRate: 70, spo2: null, restingHeartRate: null, ...extra });
const sleep = (start: number, type = 1, extra: object = {}) => ({ start, end: start + 600, type, stage: "deep", ...extra });
const workout = (extra: object = {}) => ({
  workoutNumber: 1, start: NOW - 5000, end: NOW - 4000, sportType: 2, sportName: "Running", duration: 1, distance: 1, calories: 1,
  avgHr: null, maxHr: null, steps: 1, summaryJson: "{}", complete: true, ...extra,
});

interface Page<T> { rows: T[]; cursor: string | number | null; hasMore: boolean }
interface Pull {
  stepSamples: { timestamp: number; device: string | null }[];
  sleepSegments: { start: number; device: string | null }[];
  workouts: { device: string | null }[];
  cursor: number;
}
interface Written { written: { stepSamples: number; sleepSegments: number; workouts: number } }

describe("device column", () => {
  it("round trips, stays null for older builds, and a changed device counts as a change", async () => {
    const { cookie } = signUp("alice");
    const base = { stepSamples: [step(NOW - 100)], sleepSegments: [sleep(NOW - 5000)], workouts: [workout()] };
    expect(((await (await postJson("/v1/sync", base, cookie)).json()) as Written).written).toEqual({ stepSamples: 1, sleepSegments: 1, workouts: 1, devices: 0 });
    let pull = (await (await call("/v1/sync", { cookie })).json()) as Pull;
    expect([pull.stepSamples[0]?.device, pull.sleepSegments[0]?.device, pull.workouts[0]?.device]).toEqual([null, null, null]);

    const tagged = {
      stepSamples: [step(NOW - 100, { device: "AA:BB" })],
      sleepSegments: [sleep(NOW - 5000, 1, { device: "AA:BB" })],
      workouts: [workout({ device: "AA:BB" })],
    };
    expect(((await (await postJson("/v1/sync", tagged, cookie)).json()) as Written).written).toEqual({ stepSamples: 1, sleepSegments: 1, workouts: 1, devices: 0 });
    pull = (await (await call(`/v1/sync?since=${pull.cursor}`, { cookie })).json()) as Pull;
    expect([pull.stepSamples[0]?.device, pull.sleepSegments[0]?.device, pull.workouts[0]?.device]).toEqual(["AA:BB", "AA:BB", "AA:BB"]);
    expect(((await (await postJson("/v1/sync", tagged, cookie)).json()) as Written).written).toEqual({ stepSamples: 0, sleepSegments: 0, workouts: 0, devices: 0 });
  });

  it("rejects a device longer than 64 characters", async () => {
    const { cookie } = signUp("alice");
    const response = await postJson("/v1/sync", { stepSamples: [step(NOW, { device: "x".repeat(65) })] }, cookie);
    expect(response.status).toBe(400);
  });
});

describe("GET /v1/restore", () => {
  it("pages steps by timestamp and applies the from filter", async () => {
    const { cookie } = signUp("alice");
    const stamps = Array.from({ length: 5 }, (_, i) => NOW - 1000 + i);
    await postJson("/v1/sync", { stepSamples: [step(NOW - 10 * DAY, { device: "W1" }), ...stamps.map((t) => step(t))] }, cookie);
    const seen: number[] = [];
    let after: string | number | null = null;
    let pages = 0;
    for (;;) {
      const url: string = `/v1/restore?table=steps&from=${NOW - 1000}&limit=2${after === null ? "" : `&after=${after}`}`;
      const page = (await (await call(url, { cookie })).json()) as Page<{ timestamp: number; device: string | null; heartRate: number }>;
      pages++;
      seen.push(...page.rows.map((r) => r.timestamp));
      expect(page.rows[0]).toMatchObject({ steps: 10, heartRate: 70, device: null });
      if (!page.hasMore) break;
      after = page.cursor;
    }
    expect(pages).toBe(3);
    expect(seen).toEqual(stamps);
    const all = (await (await call(`/v1/restore?table=steps&from=${NOW - 11 * DAY}`, { cookie })).json()) as Page<{ device: string | null }>;
    expect(all.rows).toHaveLength(6);
    expect(all.rows[0]?.device).toBe("W1");
    expect(all.hasMore).toBe(false);
  });

  it("pages sleep by (start, type), filters on end and returns the device", async () => {
    const { cookie } = signUp("alice");
    const start = NOW - 5000;
    await postJson(
      "/v1/sync",
      {
        sleepSegments: [
          sleep(start, 1), sleep(start, 2, { device: "W1" }), sleep(start + 10, 1), sleep(start + 20, 3),
          { start: start - 2000, end: start - 1000, type: 1, stage: null },
        ],
      },
      cookie,
    );
    const seen: string[] = [];
    let after: string | number | null = null;
    for (;;) {
      const url: string = `/v1/restore?table=sleep&from=${start}&limit=3${after === null ? "" : `&after=${after}`}`;
      const page = (await (await call(url, { cookie })).json()) as Page<{ start: number; type: number; device: string | null }>;
      seen.push(...page.rows.map((r) => `${r.start}:${r.type}`));
      if (page.rows.some((r) => r.type === 2)) expect(page.rows.find((r) => r.type === 2)?.device).toBe("W1");
      if (!page.hasMore) break;
      expect(typeof page.cursor).toBe("string");
      after = page.cursor;
    }
    expect(seen).toEqual([`${start}:1`, `${start}:2`, `${start + 10}:1`, `${start + 20}:3`]);
  });

  it("is isolated per user and open to a free account", async () => {
    const alice = signUp("alice");
    const free = signUp("bob", { founder: false });
    await postJson("/v1/sync", { stepSamples: [step(NOW - 50)] }, alice.cookie);
    const bob = (await (await call(`/v1/restore?table=steps&from=${NOW - DAY}`, { cookie: free.cookie })).json()) as Page<unknown>;
    expect(bob).toEqual({ rows: [], cursor: null, hasMore: false });
    const own = (await call(`/v1/restore?table=steps&from=${NOW - DAY}`, { cookie: alice.cookie })).status;
    expect(own).toBe(200);
  });

  it("answers 401 without a session and 400 for bad parameters", async () => {
    const { cookie } = signUp("alice");
    expect((await call(`/v1/restore?table=steps&from=${NOW - DAY}`)).status).toBe(401);
    const bad = async (query: string) => (await call(`/v1/restore?${query}`, { cookie })).status;
    expect(await bad(`table=workouts&from=${NOW}`)).toBe(400);
    expect(await bad("table=steps")).toBe(400);
    expect(await bad("table=steps&from=-1")).toBe(400);
    expect(await bad("table=steps&from=1.5")).toBe(400);
    expect(await bad(`table=steps&from=${NOW}&limit=0`)).toBe(400);
    expect(await bad(`table=steps&from=${NOW}&limit=5001`)).toBe(400);
    expect(await bad(`table=steps&from=${NOW}&after=x`)).toBe(400);
    expect(await bad(`table=sleep&from=${NOW}&after=12`)).toBe(400);
    expect(await bad(`table=steps&from=${NOW - 401 * DAY}`)).toBe(400);
    expect(await bad(`table=steps&from=${NOW - 399 * DAY}`)).toBe(200);
  });
});

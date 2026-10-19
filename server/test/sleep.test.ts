import { describe, expect, it } from "vitest";

import { wibDayStart } from "../src/sleepDays";
import { call, env, signUp, upstream } from "./helpers";

const MIN = 60;
const HOUR = 3600;

/** Unix seconds of `day` (WIB) at `HH:MM` WIB. */
function wib(day: string, time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (wibDayStart(day) ?? NaN) + (h ?? 0) * HOUR + (m ?? 0) * MIN;
}

interface Row {
  start: number;
  end: number;
  stage: string | null;
  type?: number;
  device?: string | null;
}

async function putSleep(userId: string, rows: Row[]): Promise<void> {
  await env.DB.batch(
    rows.map((r) =>
      env.DB.prepare(
        'INSERT INTO sleep_segments (user_id, start, "end", type, stage, rev, updated_at, device) VALUES (?1, ?2, ?3, ?4, ?5, 1, 1, ?6)',
      ).bind(userId, r.start, r.end, r.type ?? 1, r.stage, r.device ?? null),
    ),
  );
}

interface DayJson {
  day: string;
  asleepSec: number;
  napSec: number;
  night: null | {
    start: number;
    end: number;
    asleepSec: number;
    awakeSec: number;
    stages: Record<string, number>;
    hasStages: boolean;
    awakenings: number;
    periods: { start: number; end: number; stage: string }[];
  };
  naps: { start: number; end: number; asleepSec: number }[];
}
interface SleepJson {
  from: string;
  to: string;
  days: DayJson[];
}

async function sleepOf(cookie: string, from: string, to: string): Promise<SleepJson> {
  const response = await call(`/v1/sleep?from=${from}&to=${to}`, { cookie });
  expect(response.status).toBe(200);
  return (await response.json()) as SleepJson;
}

describe("GET /v1/sleep", () => {
  it("answers the exact contract shape for a staged night plus a nap", async () => {
    const { user, cookie } = signUp("alice");
    await putSleep(user.id, [
      { start: wib("2026-10-16", "23:00"), end: wib("2026-10-17", "02:00"), stage: "light", type: 1 },
      { start: wib("2026-10-17", "02:00"), end: wib("2026-10-17", "04:00"), stage: "deep", type: 2 },
      { start: wib("2026-10-17", "04:00"), end: wib("2026-10-17", "04:10"), stage: "awake", type: 3 },
      { start: wib("2026-10-17", "04:10"), end: wib("2026-10-17", "07:00"), stage: "rem", type: 4 },
      { start: wib("2026-10-17", "13:00"), end: wib("2026-10-17", "14:00"), stage: "light", type: 5 },
    ]);
    const json = await sleepOf(cookie, "2026-10-15", "2026-10-20");
    expect(json).toEqual({
      from: "2026-10-15",
      to: "2026-10-20",
      days: [
        {
          day: "2026-10-17",
          asleepSec: 8 * HOUR - 10 * MIN + HOUR,
          napSec: HOUR,
          night: {
            start: wib("2026-10-16", "23:00"),
            end: wib("2026-10-17", "07:00"),
            asleepSec: 8 * HOUR - 10 * MIN,
            awakeSec: 10 * MIN,
            stages: { awake: 10 * MIN, rem: 170 * MIN, light: 3 * HOUR, deep: 2 * HOUR, asleep: 0 },
            hasStages: true,
            awakenings: 1,
            periods: [
              { start: wib("2026-10-16", "23:00"), end: wib("2026-10-17", "02:00"), stage: "light" },
              { start: wib("2026-10-17", "02:00"), end: wib("2026-10-17", "04:00"), stage: "deep" },
              { start: wib("2026-10-17", "04:00"), end: wib("2026-10-17", "04:10"), stage: "awake" },
              { start: wib("2026-10-17", "04:10"), end: wib("2026-10-17", "07:00"), stage: "rem" },
            ],
          },
          naps: [{ start: wib("2026-10-17", "13:00"), end: wib("2026-10-17", "14:00"), asleepSec: HOUR }],
        },
      ],
    });
  });

  it("lists days oldest first and only the days that have sleep", async () => {
    const { user, cookie } = signUp("alice");
    await putSleep(user.id, [
      { start: wib("2026-10-18", "23:00"), end: wib("2026-10-19", "06:00"), stage: "light" },
      { start: wib("2026-10-16", "23:00"), end: wib("2026-10-17", "06:00"), stage: "light" },
      { start: wib("2026-10-20", "13:00"), end: wib("2026-10-20", "14:00"), stage: "light" },
    ]);
    const json = await sleepOf(cookie, "2026-10-10", "2026-10-25");
    expect(json.days.map((d) => [d.day, d.night !== null, d.naps.length])).toEqual([
      ["2026-10-17", true, 0],
      ["2026-10-19", true, 0],
      ["2026-10-20", false, 1],
    ]);
    expect((await sleepOf(cookie, "2026-10-01", "2026-10-02")).days).toEqual([]);
  });

  it("files a session under its WIB wake-up day and includes a night that began before the window", async () => {
    const { user, cookie } = signUp("alice");
    await putSleep(user.id, [
      { start: wib("2026-10-16", "23:00"), end: wib("2026-10-17", "06:00"), stage: "light" },
      { start: wib("2026-10-17", "21:00"), end: wib("2026-10-18", "00:10"), stage: "deep" },
    ]);
    expect((await sleepOf(cookie, "2026-10-17", "2026-10-17")).days.map((d) => d.day)).toEqual(["2026-10-17"]);
    expect((await sleepOf(cookie, "2026-10-18", "2026-10-18")).days.map((d) => d.day)).toEqual(["2026-10-18"]);
    // the 17th alone holds only the night that ends on it, not the one that ends at 00:10 on the 18th
    expect((await sleepOf(cookie, "2026-10-17", "2026-10-17")).days[0]?.night?.asleepSec).toBe(7 * HOUR);
  });

  it("splits a session where the gap passes three hours", async () => {
    const { user, cookie } = signUp("alice");
    await putSleep(user.id, [
      { start: wib("2026-10-17", "00:00"), end: wib("2026-10-17", "03:30"), stage: "light", type: 1 },
      { start: wib("2026-10-17", "06:30"), end: wib("2026-10-17", "10:00"), stage: "light", type: 1 },
      { start: wib("2026-10-17", "13:01"), end: wib("2026-10-17", "14:00"), stage: "light", type: 1 },
    ]);
    const [day] = (await sleepOf(cookie, "2026-10-17", "2026-10-17")).days;
    // 03:30 to 06:30 is exactly three hours: one night from 00:00 to 10:00; 13:01 is more than three hours later: a nap
    expect(day?.night).toMatchObject({ start: wib("2026-10-17", "00:00"), end: wib("2026-10-17", "10:00"), asleepSec: 7 * HOUR });
    expect(day?.naps).toEqual([{ start: wib("2026-10-17", "13:01"), end: wib("2026-10-17", "14:00"), asleepSec: 59 * MIN }]);
    expect(day?.asleepSec).toBe(7 * HOUR + 59 * MIN);
  });

  it("counts a night two watches recorded once, whichever stages and devices they carry", async () => {
    const { user, cookie } = signUp("alice");
    await putSleep(user.id, [
      { start: wib("2026-10-16", "23:00"), end: wib("2026-10-17", "07:00"), stage: "light", type: 1, device: "watch-a" },
      { start: wib("2026-10-16", "23:20"), end: wib("2026-10-17", "07:20"), stage: "light", type: 1, device: "watch-b" },
      { start: wib("2026-10-17", "01:00"), end: wib("2026-10-17", "03:00"), stage: "deep", type: 2, device: "watch-b" },
    ]);
    const [day] = (await sleepOf(cookie, "2026-10-17", "2026-10-17")).days;
    expect(day?.asleepSec).toBe(8 * HOUR + 20 * MIN);
    expect(day?.night?.periods).toEqual([{ start: wib("2026-10-16", "23:00"), end: wib("2026-10-17", "07:20"), stage: "light" }]);
  });

  it("reads a stage-less night as one `asleep` period without stages", async () => {
    const { user, cookie } = signUp("alice");
    await putSleep(user.id, [{ start: wib("2026-10-16", "23:30"), end: wib("2026-10-17", "06:30"), stage: null }]);
    const [day] = (await sleepOf(cookie, "2026-10-17", "2026-10-17")).days;
    expect(day?.night).toMatchObject({
      asleepSec: 7 * HOUR,
      awakeSec: 0,
      stages: { awake: 0, rem: 0, light: 0, deep: 0, asleep: 7 * HOUR },
      hasStages: false,
      awakenings: 0,
    });
  });

  it("cleans a stage-less night with the steps of the same account (a walk splits it) and not with another user's", async () => {
    const alice = signUp("alice");
    const bob = signUp("bob");
    const range = { start: wib("2026-10-16", "23:00"), end: wib("2026-10-17", "07:00"), stage: null };
    await putSleep(alice.user.id, [range]);
    await putSleep(bob.user.id, [range]);
    const steps = (userId: string, at: number) =>
      env.DB.prepare("INSERT INTO step_samples (user_id, timestamp, steps, calories, distance, rev, updated_at) VALUES (?1, ?2, 40, 1, 1, 1, 1)").bind(userId, at);
    // Bob walks for half an hour at 02:00; Alice does not.
    await env.DB.batch(Array.from({ length: 30 }, (_, i) => steps(bob.user.id, wib("2026-10-17", "02:00") + i * MIN)));

    const aliceDay = (await sleepOf(alice.cookie, "2026-10-17", "2026-10-17")).days[0];
    expect(aliceDay?.night?.asleepSec).toBe(8 * HOUR);
    expect(aliceDay?.night?.periods).toHaveLength(1);

    const bobDay = (await sleepOf(bob.cookie, "2026-10-17", "2026-10-17")).days[0];
    expect(bobDay?.asleepSec).toBe(8 * HOUR - 30 * MIN);
    // Bob's walk is 30 minutes of awake evidence inside one session: two pieces, no gap of three hours.
    expect(bobDay?.night?.start).toBe(range.start);
    expect(bobDay?.night?.end).toBe(range.end);
  });

  it("starts a new session after a legacy workout row inside a stage-less night", async () => {
    const { user, cookie } = signUp("alice");
    await putSleep(user.id, [{ start: wib("2026-10-18", "00:00"), end: wib("2026-10-18", "07:00"), stage: null }]);
    await env.DB.prepare(
      `INSERT INTO workouts (user_id, start, workout_number, "end", sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, point_count, rev, updated_at)
       VALUES (?1, ?2, 1, ?3, 1, 'Run', ?4, 1, 1, 1, '{}', 1, 0, 1, 1)`,
    )
      .bind(user.id, wib("2026-10-18", "04:34"), wib("2026-10-18", "05:06"), 32 * MIN)
      .run();
    const [day] = (await sleepOf(cookie, "2026-10-18", "2026-10-18")).days;
    // Two sessions: 00:00 to 04:34 (4 h 34, the night) and 05:06 to 07:00 (1 h 54, a nap).
    expect(day?.night).toMatchObject({ start: wib("2026-10-18", "00:00"), end: wib("2026-10-18", "04:34") });
    expect(day?.naps).toEqual([{ start: wib("2026-10-18", "05:06"), end: wib("2026-10-18", "07:00"), asleepSec: 114 * MIN }]);
  });

  it("never reads another user's rows", async () => {
    const alice = signUp("alice");
    const bob = signUp("bob");
    await putSleep(alice.user.id, [{ start: wib("2026-10-16", "23:00"), end: wib("2026-10-17", "07:00"), stage: "light" }]);
    await putSleep(bob.user.id, [
      { start: wib("2026-10-17", "01:00"), end: wib("2026-10-17", "05:00"), stage: "deep", type: 7 },
      { start: wib("2026-10-17", "13:00"), end: wib("2026-10-17", "14:00"), stage: "light", type: 8 },
    ]);
    const [day] = (await sleepOf(alice.cookie, "2026-10-17", "2026-10-17")).days;
    expect(day?.night?.stages).toEqual({ awake: 0, rem: 0, light: 8 * HOUR, deep: 0, asleep: 0 });
    expect(day?.naps).toEqual([]);
    const carol = signUp("carol");
    expect((await sleepOf(carol.cookie, "2026-10-10", "2026-10-25")).days).toEqual([]);
  });

  it("is open to an account without Pro and needs a session", async () => {
    const free = signUp("free", { founder: false });
    expect((await call("/v1/sleep?from=2026-10-17&to=2026-10-17", { cookie: free.cookie })).status).toBe(200);
    expect((await call("/v1/sleep?from=2026-10-17&to=2026-10-17")).status).toBe(401);
    expect(upstream.calls.every((c) => !c.url.endsWith("cloudAccess"))).toBe(true);
  });
});

describe("GET /v1/sleep window", () => {
  const status = async (query: string): Promise<number> => {
    const { cookie } = signUp("alice");
    return (await call(`/v1/sleep${query}`, { cookie })).status;
  };

  it("accepts one day and 92 days, refuses 93", async () => {
    expect(await status("?from=2026-10-17&to=2026-10-17")).toBe(200);
    expect(await status("?from=2026-09-01&to=2026-11-30")).toBe(200); // 30 + 31 + 30 = 91 days
    expect(await status("?from=2026-08-31&to=2026-11-30")).toBe(200); // 92 days
    expect(await status("?from=2026-08-30&to=2026-11-30")).toBe(400); // 93 days
    expect(await status("?from=2020-01-01&to=2026-11-30")).toBe(400);
  });

  it("answers 400 invalid_range for a missing, reversed or malformed window", async () => {
    const { cookie } = signUp("alice");
    for (const query of [
      "",
      "?from=2026-10-17",
      "?to=2026-10-17",
      "?from=2026-10-18&to=2026-10-17",
      "?from=17-10-2026&to=18-10-2026",
      "?from=2026-02-30&to=2026-03-01",
      "?from=2026-10-17&to=2026-10-17T00:00",
      "?from=&to=",
    ]) {
      const response = await call(`/v1/sleep${query}`, { cookie });
      expect(response.status, query).toBe(400);
      expect(await response.json(), query).toMatchObject({ error: "invalid_range" });
    }
  });
});

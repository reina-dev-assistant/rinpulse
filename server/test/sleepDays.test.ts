import { describe, expect, it } from "vitest";

import {
  MIN_NIGHT_SEC,
  NO_EVIDENCE,
  SESSION_GAP_SEC,
  buildNights,
  cleanUnstagedSleep,
  groupDays,
  isNap,
  startOfWibDay,
  toStage,
  wibDay,
  wibDayStart,
  withoutBlips,
  withoutStrayUnstaged,
  workoutSpan,
  type SleepSegment,
  type SleepStage,
} from "../src/sleepDays";

const MIN = 60;
const HOUR = 3600;

/** Unix seconds of `day` (WIB, `YYYY-MM-DD`) at `HH:MM` WIB. */
function wib(day: string, time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (wibDayStart(day) ?? NaN) + (h ?? 0) * HOUR + (m ?? 0) * MIN;
}

const seg = (day: string, from: string, toDay: string, to: string, stage: SleepStage | null): SleepSegment => ({
  start: wib(day, from),
  end: wib(toDay, to),
  stage,
});

/** The wide window the grouping tests look through. */
const FROM = wib("2026-10-01", "00:00");
const TO = wib("2026-11-01", "00:00");
const days = (segments: SleepSegment[]) => groupDays(buildNights(cleanUnstagedSleep(segments, NO_EVIDENCE)), FROM, TO);

describe("WIB days", () => {
  it("cuts days at 00:00 WIB (17:00 UTC)", () => {
    expect(wibDay(Date.UTC(2026, 9, 17, 16, 59, 59) / 1000)).toBe("2026-10-17");
    expect(wibDay(Date.UTC(2026, 9, 17, 17, 0, 0) / 1000)).toBe("2026-10-18");
    expect(startOfWibDay(Date.UTC(2026, 9, 17, 17, 0, 0) / 1000)).toBe(Date.UTC(2026, 9, 17, 17, 0, 0) / 1000);
    expect(startOfWibDay(Date.UTC(2026, 9, 17, 16, 59, 59) / 1000)).toBe(Date.UTC(2026, 9, 16, 17, 0, 0) / 1000);
  });

  it("parses only real calendar dates", () => {
    expect(wibDayStart("2026-10-17")).toBe(Date.UTC(2026, 9, 16, 17, 0, 0) / 1000);
    expect(wibDayStart("2028-02-29")).not.toBeNull();
    for (const bad of ["", "2026-2-3", "2026-02-30", "2027-02-29", "2026-13-01", "2026-00-10", "2026-10-32", "20261017", "2026-10-17T00:00", " 2026-10-17"]) {
      expect(wibDayStart(bad), bad).toBeNull();
    }
  });

  it("round-trips a day through its start", () => {
    expect(wibDay(wibDayStart("2026-12-31") ?? 0)).toBe("2026-12-31");
    expect(wibDay((wibDayStart("2026-12-31") ?? 0) + 86_399)).toBe("2026-12-31");
    expect(wibDay((wibDayStart("2026-12-31") ?? 0) + 86_400)).toBe("2027-01-01");
  });
});

describe("stage text", () => {
  it("keeps the four decoded stages and reads anything else as stage-less", () => {
    expect(["awake", "rem", "light", "deep"].map(toStage)).toEqual(["awake", "rem", "light", "deep"]);
    for (const other of [null, "", "asleep", "LIGHT", "nap"]) expect(toStage(other)).toBeNull();
  });
});

describe("a night with stages", () => {
  const night = [
    seg("2026-10-16", "23:00", "2026-10-17", "01:00", "light"),
    seg("2026-10-17", "01:00", "2026-10-17", "03:00", "deep"),
    seg("2026-10-17", "03:00", "2026-10-17", "04:30", "rem"),
    seg("2026-10-17", "04:30", "2026-10-17", "04:45", "awake"),
    seg("2026-10-17", "04:45", "2026-10-17", "06:00", "light"),
    seg("2026-10-17", "06:00", "2026-10-17", "07:00", "light"),
  ];

  it("is filed under the day it ends, with seconds per stage and merged periods", () => {
    const result = days(night);
    expect(result).toHaveLength(1);
    const [day] = result;
    expect(day?.day).toBe("2026-10-17");
    expect(day?.naps).toEqual([]);
    expect(day?.napSec).toBe(0);
    expect(day?.night).toEqual({
      start: wib("2026-10-16", "23:00"),
      end: wib("2026-10-17", "07:00"),
      asleepSec: 8 * HOUR - 15 * MIN,
      awakeSec: 15 * MIN,
      stages: { awake: 15 * MIN, rem: 90 * MIN, light: 4 * HOUR + 15 * MIN, deep: 2 * HOUR, asleep: 0 },
      hasStages: true,
      awakenings: 1,
      periods: [
        { start: wib("2026-10-16", "23:00"), end: wib("2026-10-17", "01:00"), stage: "light" },
        { start: wib("2026-10-17", "01:00"), end: wib("2026-10-17", "03:00"), stage: "deep" },
        { start: wib("2026-10-17", "03:00"), end: wib("2026-10-17", "04:30"), stage: "rem" },
        { start: wib("2026-10-17", "04:30"), end: wib("2026-10-17", "04:45"), stage: "awake" },
        { start: wib("2026-10-17", "04:45"), end: wib("2026-10-17", "07:00"), stage: "light" },
      ],
    });
    expect(day?.asleepSec).toBe(day?.night?.asleepSec);
  });

  it("counts only awake periods with sleep on both sides as awakenings", () => {
    const edges = [
      seg("2026-10-16", "23:00", "2026-10-16", "23:20", "awake"),
      seg("2026-10-16", "23:20", "2026-10-17", "03:00", "light"),
      seg("2026-10-17", "03:00", "2026-10-17", "03:10", "awake"),
      seg("2026-10-17", "03:10", "2026-10-17", "05:00", "deep"),
      seg("2026-10-17", "05:00", "2026-10-17", "05:20", "awake"),
      seg("2026-10-17", "05:20", "2026-10-17", "07:00", "rem"),
      seg("2026-10-17", "07:00", "2026-10-17", "07:10", "awake"),
    ];
    const [night] = buildNights(edges);
    expect(night?.awakenings).toBe(2);
    expect(night?.start).toBe(wib("2026-10-16", "23:00"));
    expect(night?.end).toBe(wib("2026-10-17", "07:10"));
  });
});

describe("a night without stages", () => {
  it("is one `asleep` period and says hasStages false", () => {
    const [day] = days([seg("2026-10-16", "23:30", "2026-10-17", "06:30", null)]);
    expect(day?.night).toMatchObject({
      asleepSec: 7 * HOUR,
      awakeSec: 0,
      stages: { awake: 0, rem: 0, light: 0, deep: 0, asleep: 7 * HOUR },
      hasStages: false,
      awakenings: 0,
      periods: [{ start: wib("2026-10-16", "23:30"), end: wib("2026-10-17", "06:30"), stage: "asleep" }],
    });
  });

  it("drops a stage-less fragment next to a staged night (it only stretches it)", () => {
    const staged = seg("2026-10-16", "23:00", "2026-10-17", "06:00", "light");
    const stray = seg("2026-10-17", "07:30", "2026-10-17", "08:30", null);
    expect(withoutStrayUnstaged([staged, stray])).toEqual([staged]);
    const [day] = days([staged, stray]);
    expect(day?.night?.end).toBe(staged.end);
  });

  it("keeps a stage-less nap far from staged sleep", () => {
    const staged = seg("2026-10-16", "23:00", "2026-10-17", "06:00", "light");
    const nap = seg("2026-10-17", "14:00", "2026-10-17", "15:00", null);
    expect(withoutStrayUnstaged([staged, nap])).toEqual([staged, nap]);
    const [day] = days([staged, nap]);
    expect(day?.naps).toEqual([{ start: nap.start, end: nap.end, asleepSec: HOUR }]);
  });

  it("drops stretches with under five minutes of sleep and keeps awake out of the count", () => {
    const blip = seg("2026-10-17", "10:00", "2026-10-17", "10:04", "light");
    const awakeOnly = seg("2026-10-17", "12:00", "2026-10-17", "13:00", "awake");
    const night = seg("2026-10-16", "23:00", "2026-10-17", "07:00", "light");
    expect(withoutBlips([blip, night, awakeOnly])).toEqual([night]);
    // a blip within an hour of real sleep is part of that stretch and stays
    const near = seg("2026-10-17", "07:30", "2026-10-17", "07:34", "light");
    expect(withoutBlips([night, near])).toEqual([night, near]);
  });
});

describe("night and naps of one day", () => {
  const night = seg("2026-10-16", "23:00", "2026-10-17", "07:00", "light");

  it("adds the nap to the day total and lists it apart", () => {
    const nap = seg("2026-10-17", "13:00", "2026-10-17", "14:00", "light");
    const [day] = days([nap, night]);
    expect(day?.day).toBe("2026-10-17");
    expect(day?.night?.asleepSec).toBe(8 * HOUR);
    expect(day?.naps).toEqual([{ start: nap.start, end: nap.end, asleepSec: HOUR }]);
    expect(day?.napSec).toBe(HOUR);
    expect(day?.asleepSec).toBe(9 * HOUR);
  });

  it("lists several naps oldest first", () => {
    const early = seg("2026-10-17", "11:00", "2026-10-17", "11:40", "light");
    const late = seg("2026-10-17", "16:00", "2026-10-17", "16:30", "deep");
    const [day] = days([late, night, early]);
    expect(day?.naps.map((n) => n.start)).toEqual([early.start, late.start]);
    expect(day?.napSec).toBe(70 * MIN);
    expect(day?.asleepSec).toBe(8 * HOUR + 70 * MIN);
  });

  it("files a nap under the day it ends, not the day of the night before", () => {
    const nap = seg("2026-10-17", "13:00", "2026-10-17", "14:00", "light");
    const result = days([night, nap, seg("2026-10-17", "23:00", "2026-10-18", "06:30", "light")]);
    expect(result.map((d) => d.day)).toEqual(["2026-10-17", "2026-10-18"]);
    expect(result[1]?.naps).toEqual([]);
    expect(result[1]?.night?.asleepSec).toBe(7 * HOUR + 30 * MIN);
  });
});

describe("a day with only naps", () => {
  it("has no night and counts the naps as the day", () => {
    const nap = seg("2026-10-17", "13:00", "2026-10-17", "14:30", "light");
    const [day] = days([nap]);
    expect(day).toEqual({
      day: "2026-10-17",
      asleepSec: 90 * MIN,
      napSec: 90 * MIN,
      night: null,
      naps: [{ start: nap.start, end: nap.end, asleepSec: 90 * MIN }],
    });
  });

  it("calls a session a nap below three hours of sleep and a night from three hours", () => {
    expect(isNap({ asleepSeconds: MIN_NIGHT_SEC - 1 })).toBe(true);
    expect(isNap({ asleepSeconds: MIN_NIGHT_SEC })).toBe(false);
    const nearly = days([seg("2026-10-17", "02:00", "2026-10-17", "04:59", "light")]);
    expect(nearly[0]?.night).toBeNull();
    const exactly = days([seg("2026-10-17", "02:00", "2026-10-17", "05:00", "light")]);
    expect(exactly[0]?.night?.asleepSec).toBe(MIN_NIGHT_SEC);
    expect(exactly[0]?.naps).toEqual([]);
  });

  it("does not count awake time as sleep when deciding", () => {
    const [day] = days([
      seg("2026-10-17", "01:00", "2026-10-17", "03:00", "light"),
      seg("2026-10-17", "03:00", "2026-10-17", "05:00", "awake"),
    ]);
    expect(day?.night).toBeNull();
    expect(day?.asleepSec).toBe(2 * HOUR);
    expect(day?.naps[0]).toEqual({ start: wib("2026-10-17", "01:00"), end: wib("2026-10-17", "05:00"), asleepSec: 2 * HOUR });
  });
});

describe("sessions split at the gap", () => {
  const first = seg("2026-10-17", "00:00", "2026-10-17", "04:00", "light");

  it("joins segments exactly the gap apart", () => {
    const second = { start: first.end + SESSION_GAP_SEC, end: first.end + SESSION_GAP_SEC + 4 * HOUR, stage: "deep" as const };
    const nights = buildNights([first, second]);
    expect(nights).toHaveLength(1);
    expect(nights[0]?.start).toBe(first.start);
    expect(nights[0]?.end).toBe(second.end);
    // the gap itself is not sleep: 8 h of sleep inside an 11 h session
    expect(nights[0]?.asleepSeconds).toBe(8 * HOUR);
  });

  it("splits one second beyond it, and the day's longest session is the night (the later one on a tie)", () => {
    const second = { start: first.end + SESSION_GAP_SEC + 1, end: first.end + SESSION_GAP_SEC + 1 + 4 * HOUR, stage: "deep" as const };
    expect(buildNights([first, second])).toHaveLength(2);
    const [day] = groupDays(buildNights([first, second]), FROM, TO);
    expect(day?.day).toBe("2026-10-17");
    expect(day?.night?.start).toBe(second.start);
    expect(day?.naps).toEqual([{ start: first.start, end: first.end, asleepSec: 4 * HOUR }]);
    expect(day?.asleepSec).toBe(8 * HOUR);
    expect(day?.napSec).toBe(4 * HOUR);
  });

  it("splits where cleaning marked a workout or a long stage-less gap in between, however close", () => {
    const range = { start: wib("2026-10-18", "00:00"), end: wib("2026-10-18", "07:00"), stage: null };
    const run = workoutSpan(wib("2026-10-18", "04:34"), wib("2026-10-18", "05:06"), 32 * MIN);
    const cleaned = cleanUnstagedSleep([range], { ...NO_EVIDENCE, workouts: [run] });
    expect(cleaned.map((s) => [s.start, s.end, s.breakBefore ?? false])).toEqual([
      [range.start, run.start, false],
      [run.end, range.end, true],
    ]);
    const nights = buildNights(cleaned);
    expect(nights.map((n) => [n.start, n.end, n.asleepSeconds])).toEqual([
      [range.start, run.start, 4 * HOUR + 34 * MIN],
      [run.end, range.end, 1 * HOUR + 54 * MIN],
    ]);
  });
});

describe("stage-less cleaning (cleanUnstagedSleep)", () => {
  const at = wib("2026-10-16", "14:00");

  it("drops fragments that add up to under 20 minutes, keeps a 20 minute run", () => {
    const fragments = [0, 4, 8, 12].map((m) => ({ start: at + m * MIN, end: at + m * MIN + 3 * MIN, stage: null }));
    expect(cleanUnstagedSleep(fragments, NO_EVIDENCE)).toEqual([]);
    expect(cleanUnstagedSleep([{ start: at, end: at + 20 * MIN, stage: null }], NO_EVIDENCE)).toHaveLength(1);
    expect(cleanUnstagedSleep([{ start: at, end: at + 19 * MIN, stage: null }], NO_EVIDENCE)).toEqual([]);
  });

  it("subtracts minutes with 15 or more steps, so a trip to the bathroom splits a night in two pieces of the same session", () => {
    const range = { start: wib("2026-10-19", "00:00"), end: wib("2026-10-19", "06:00"), stage: null };
    const trip = wib("2026-10-19", "02:10");
    const cleaned = cleanUnstagedSleep([range], { ...NO_EVIDENCE, activeMinutes: [trip] });
    expect(cleaned.map((s) => [s.start, s.end])).toEqual([
      [range.start, trip],
      [trip + MIN, range.end],
    ]);
    const nights = buildNights(cleaned);
    expect(nights).toHaveLength(1);
    expect(nights[0]?.asleepSeconds).toBe(6 * HOUR - MIN);
  });

  it("never touches staged segments, even under a workout", () => {
    const staged = [{ start: at, end: at + 2 * HOUR, stage: "light" as const }];
    expect(cleanUnstagedSleep(staged, { ...NO_EVIDENCE, workouts: [{ start: at, end: at + HOUR }] })).toEqual(staged);
  });
});

describe("two watches", () => {
  it("count a night recorded twice once (same stage, shifted by half an hour)", () => {
    const a = seg("2026-10-16", "23:00", "2026-10-17", "07:00", "light");
    const b = seg("2026-10-16", "23:30", "2026-10-17", "07:30", "light");
    const [day] = days([b, a]);
    expect(day?.asleepSec).toBe(8 * HOUR + 30 * MIN);
    expect(day?.night?.periods).toEqual([{ start: a.start, end: b.end, stage: "light" }]);
  });

  it("let the earlier-starting segment keep the overlap when the stages differ", () => {
    const a = seg("2026-10-16", "23:00", "2026-10-17", "07:00", "light");
    const b = seg("2026-10-17", "01:00", "2026-10-17", "03:00", "deep");
    const [day] = days([a, b]);
    expect(day?.asleepSec).toBe(8 * HOUR);
    expect(day?.night?.stages).toEqual({ awake: 0, rem: 0, light: 8 * HOUR, deep: 0, asleep: 0 });
  });

  it("never lets periods overlap, whatever the order the rows arrive in", () => {
    const rows = [
      seg("2026-10-16", "23:00", "2026-10-17", "03:00", "light"),
      seg("2026-10-17", "01:00", "2026-10-17", "05:00", "deep"),
      seg("2026-10-17", "04:00", "2026-10-17", "08:00", "rem"),
      seg("2026-10-17", "02:00", "2026-10-17", "06:00", "awake"),
      seg("2026-10-16", "22:00", "2026-10-17", "00:30", "rem"),
    ];
    for (const order of [rows, [...rows].reverse(), [rows[2]!, rows[0]!, rows[4]!, rows[1]!, rows[3]!]]) {
      const [night] = buildNights(order);
      const periods = night?.periods ?? [];
      expect(periods.length).toBeGreaterThan(0);
      for (let i = 1; i < periods.length; i++) {
        expect(periods[i]!.start).toBeGreaterThanOrEqual(periods[i - 1]!.end);
        expect(periods[i]!.stage).not.toBe(periods[i - 1]!.stage);
      }
      const total = Object.values(night?.seconds ?? {}).reduce((a, b) => a + b, 0);
      expect(total).toBe((night?.end ?? 0) - (night?.start ?? 0));
    }
  });
});

describe("the WIB day boundary", () => {
  it("files a session that ends at 23:59 on that day and one that ends at 00:00 on the next", () => {
    const late = seg("2026-10-17", "20:30", "2026-10-17", "23:59", "light");
    const after = seg("2026-10-18", "21:00", "2026-10-19", "00:00", "light");
    const result = days([late, after]);
    expect(result.map((d) => d.day)).toEqual(["2026-10-17", "2026-10-19"]);
  });

  it("is not the UTC day: a night ending 06:30 WIB is 23:30 UTC of the day before", () => {
    const [day] = days([seg("2026-10-16", "23:00", "2026-10-17", "06:30", "light")]);
    expect(day?.day).toBe("2026-10-17");
    expect(new Date((day?.night?.end ?? 0) * 1000).toISOString()).toBe("2026-10-16T23:30:00.000Z");
  });

  it("keeps the sessions whose end is inside the window: `from` inclusive, the day after `to` excluded", () => {
    const nights = buildNights([
      seg("2026-10-16", "21:00", "2026-10-17", "00:00", "light"),
      seg("2026-10-17", "22:00", "2026-10-18", "05:00", "light"),
      seg("2026-10-18", "22:00", "2026-10-19", "05:00", "light"),
    ]);
    const window = (from: string, to: string) => groupDays(nights, wibDayStart(from) ?? 0, (wibDayStart(to) ?? 0) + 86_400).map((d) => d.day);
    expect(window("2026-10-17", "2026-10-18")).toEqual(["2026-10-17", "2026-10-18"]);
    expect(window("2026-10-18", "2026-10-18")).toEqual(["2026-10-18"]);
    expect(window("2026-10-19", "2026-10-19")).toEqual(["2026-10-19"]);
    expect(window("2026-10-20", "2026-10-25")).toEqual([]);
  });
});

describe("empty and odd input", () => {
  it("has no days without segments", () => {
    expect(days([])).toEqual([]);
  });

  it("ignores empty and inverted segments", () => {
    const bad = [
      { start: wib("2026-10-17", "03:00"), end: wib("2026-10-17", "03:00"), stage: "light" as const },
      { start: wib("2026-10-17", "06:00"), end: wib("2026-10-17", "05:00"), stage: "light" as const },
    ];
    expect(days(bad)).toEqual([]);
  });
});

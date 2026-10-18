import { describe, expect, test } from "bun:test";

import { IntervalTracker, dailyChallenge, medalFor, targetGapS, wibDay, workoutDurationS, type Workout } from "./modes.ts";
import { ROUTES } from "./routes.ts";

const W: Workout = {
  id: "t",
  blocks: [
    { kind: "warm", durS: 10, cadLo: 70, cadHi: 80 },
    { kind: "hard", durS: 5, cadLo: 95, cadHi: 105 },
  ],
};

describe("IntervalTracker", () => {
  test("advances blocks across a step that spans the boundary and scores only in-band time", () => {
    const tr = new IntervalTracker(W);
    tr.drainEvents();
    tr.step(8, 75); // in band
    tr.step(4, 75); // 2 s in warm (in band), 2 s in hard (below band)
    const snap = tr.snapshot();
    expect(snap.index).toBe(1);
    expect(snap.remainingS).toBeCloseTo(3);
    expect(snap.position).toBe(-1);
    expect(tr.blockScores[0]).toBeCloseTo(10);
    expect(tr.blockScores[1]).toBeCloseTo(0);
    expect(tr.drainEvents()).toEqual([{ type: "block", index: 1, block: W.blocks[1]! }]);
  });

  test("finishes once, stops counting, and compliance is the in-band share", () => {
    const tr = new IntervalTracker(W);
    tr.step(10, 75);
    tr.step(5, 120); // above the hard band
    tr.step(5, 100); // after the end: ignored
    expect(tr.done).toBe(true);
    expect(tr.snapshot().elapsedS).toBeCloseTo(15);
    expect(tr.compliance).toBeCloseTo(10 / 15);
    expect(tr.drainEvents().filter((e) => e.type === "done")).toHaveLength(1);
  });

  test("no cadence is never in band", () => {
    const tr = new IntervalTracker(W);
    tr.step(3, undefined);
    expect(tr.snapshot().position).toBeNull();
    expect(tr.compliance).toBe(0);
    expect(workoutDurationS(W)).toBe(15);
  });
});

describe("daily challenge", () => {
  test("is the same all WIB day and changes at WIB midnight, not UTC midnight", () => {
    // 2026-10-18 17:30 UTC = 2026-10-19 00:30 WIB.
    const lateUtc = Date.UTC(2026, 9, 18, 17, 30);
    const earlyUtc = Date.UTC(2026, 9, 18, 16, 30); // 23:30 WIB on the 18th
    expect(wibDay(lateUtc)).toBe("2026-10-19");
    expect(wibDay(earlyUtc)).toBe("2026-10-18");
    expect(dailyChallenge(earlyUtc)).toEqual(dailyChallenge(Date.UTC(2026, 9, 18, 1, 0)));
  });

  test("targets are plausible for every route the hash can pick", () => {
    const seen = new Set<string>();
    for (let d = 0; d < 120; d++) {
      const c = dailyChallenge(Date.UTC(2026, 0, 1) + d * 86400_000);
      seen.add(c.routeId);
      const route = ROUTES.find((r) => r.id === c.routeId)!;
      const kmh = route.lengthM / c.targetS * 3.6;
      expect(kmh).toBeGreaterThan(10);
      expect(kmh).toBeLessThan(34);
      expect(c.targetS % 5).toBe(0);
    }
    expect(seen.size).toBe(ROUTES.length);
  });
});

describe("medals and pace", () => {
  test("medal bands", () => {
    expect(medalFor(600, 600)).toBe("gold");
    expect(medalFor(630, 600)).toBe("silver");
    expect(medalFor(631, 600)).toBe("bronze");
    expect(medalFor(691, 600)).toBeNull();
    expect(medalFor(0, 600)).toBeNull();
  });

  test("gap to an even pace", () => {
    expect(targetGapS(290, 5000, 10000, 600)).toBe(-10);
    expect(targetGapS(700, 12000, 10000, 600)).toBe(100);
  });
});

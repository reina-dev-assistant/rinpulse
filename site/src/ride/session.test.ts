import { describe, expect, test } from "bun:test";

import { COUNTDOWN_S, DRAFT_MAX_M, RideSession, hrZone, type GhostRun } from "./session.ts";
import { ROUTES } from "./routes.ts";
import { Track } from "./track.ts";

const pantai = ROUTES.find((r) => r.id === "pantai")!;
const bukit = ROUTES.find((r) => r.id === "bukit")!;

function make(route = pantai, ghost: GhostRun | null = null, bests: Record<string, number> = {}) {
  return new RideSession(route, new Track(route), { ghost, segmentBests: bests });
}

function ride(s: RideSession, seconds: number, input = { cad: 85, hr: 130 }) {
  for (let t = 0; t < seconds; t += 0.05) s.step(0.05, input);
}

function begin(s: RideSession) {
  s.startCountdown();
  ride(s, COUNTDOWN_S + 0.2);
}

describe("flow", () => {
  test("countdown then riding; nothing moves before the go", () => {
    const s = make();
    s.startCountdown();
    ride(s, COUNTDOWN_S - 0.5);
    expect(s.phase).toBe("countdown");
    expect(s.distM).toBe(0);
    ride(s, 1);
    expect(s.phase).toBe("riding");
  });

  test("pause freezes time and distance, resume continues", () => {
    const s = make();
    begin(s);
    ride(s, 5);
    s.pause();
    const { distM, timeS } = s;
    ride(s, 5);
    expect(s.distM).toBe(distM);
    expect(s.timeS).toBe(timeS);
    s.resume();
    ride(s, 2);
    expect(s.distM).toBeGreaterThan(distM);
  });

  test("a loop ride restarts the route at the finish, keeps counting distance, and is never a route best", () => {
    const kebun = ROUTES.find((r) => r.id === "kebun")!;
    const s = new RideSession(kebun, new Track(kebun), { ghost: { routeId: "kebun", timeS: 1, trace: [0, 3000] }, segmentBests: {}, loop: true });
    expect(s.ghost).toBeNull();
    begin(s);
    s.distM = kebun.lengthM - 5;
    s.speedMs = 8;
    ride(s, 2, { cad: 95, hr: 130 });
    expect(s.phase).toBe("riding");
    expect(s.loops).toBe(1);
    expect(s.distM).toBeLessThan(50);
    expect(s.totalDistM).toBeGreaterThan(kebun.lengthM);
    s.stop();
    expect(s.result!.complete).toBe(false);
    expect(s.result!.newBest).toBe(false);
    expect(s.result!.distM).toBeCloseTo(s.totalDistM);
  });

  test("lap records splits and a final partial lap at stop", () => {
    const s = make();
    begin(s);
    ride(s, 10);
    s.lap();
    ride(s, 6);
    s.stop();
    expect(s.laps.length).toBe(2);
    expect(s.laps[0]!.sec).toBeCloseTo(10, 0);
    expect(s.result!.complete).toBe(false);
    expect(s.result!.newBest).toBe(false);
  });

  test("reaching the finish ends the ride as complete and builds the sum message", () => {
    const s = make();
    begin(s);
    s.distM = pantai.lengthM - 5;
    ride(s, 3);
    expect(s.phase).toBe("finished");
    expect(s.result!.complete).toBe(true);
    expect(s.result!.newBest).toBe(true);
    const sum = s.summaryMessage()!;
    expect(sum.t).toBe("sum");
    expect(sum.route).toBe("Pantai");
    expect(sum.distM).toBeCloseTo(pantai.lengthM, 0);
  });
});

describe("physics wiring", () => {
  test("coasting on a flat road slows the bike and reads no power", () => {
    const s = make();
    begin(s);
    ride(s, 8);
    const fast = s.speedMs;
    ride(s, 6, { cad: 0, hr: 100 });
    expect(s.speedMs).toBeLessThan(fast);
    expect(s.powerW).toBe(0);
  });

  test("a harder gear at the same cadence is faster", () => {
    const a = make();
    const b = make();
    begin(a);
    begin(b);
    for (let i = 0; i < 3; i++) b.shift(1);
    ride(a, 20);
    ride(b, 20);
    expect(b.speedMs).toBeGreaterThan(a.speedMs);
  });

  test("the same input is slower on the hilly route's climb than on the flat one", () => {
    const flat = make(pantai);
    const hill = make(bukit);
    begin(flat);
    begin(hill);
    hill.distM = 2900;
    ride(flat, 30);
    ride(hill, 30);
    expect(hill.speedMs).toBeLessThan(flat.speedMs);
  });

  test("power is flagged estimated unless a meter sends it", () => {
    const s = make();
    begin(s);
    ride(s, 5);
    expect(s.powerMeasured).toBe(false);
    for (let t = 0; t < 5; t += 0.05) s.step(0.05, { cad: 85, pwr: 200 });
    expect(s.powerMeasured).toBe(true);
    expect(s.powerW).toBe(200);
  });

  test("elevation gain only counts climbing", () => {
    const s = make(bukit);
    begin(s);
    s.distM = 5200;
    s.step(0.05, { cad: 0, hr: 90 });
    const before = s.elevGainM;
    ride(s, 20, { cad: 0, hr: 90 });
    expect(s.elevGainM).toBeCloseTo(before, 1);
  });
});

describe("segments", () => {
  test("a segment starts, times, and flags a personal best", () => {
    const seg = pantai.segments[0]!;
    const s = make(pantai, null, { [seg.id]: 1000 });
    begin(s);
    s.distM = seg.startM - 10;
    ride(s, 120);
    const done = s.segments.find((x) => x.def.id === seg.id)!;
    expect(done.state).toBe("done");
    expect(done.elapsedS).toBeGreaterThan(10);
    expect(done.pb).toBe(true);
    const events = s.drainEvents().map((e) => e.type);
    expect(events).toContain("segment-start");
    expect(events).toContain("segment-end");
  });

  test("a slower run is not a best", () => {
    const seg = pantai.segments[0]!;
    const s = make(pantai, null, { [seg.id]: 1 });
    begin(s);
    s.distM = seg.startM - 10;
    ride(s, 120);
    expect(s.segments.find((x) => x.def.id === seg.id)!.pb).toBe(false);
  });
});

describe("ghost", () => {
  const ghost: GhostRun = { routeId: "pantai", timeS: 100, trace: Array.from({ length: 101 }, (_, i) => i * 10) };

  test("interpolates the ghost's distance and holds it at the end", () => {
    const s = make(pantai, ghost);
    expect(s.ghostDistAt(2.5)).toBeCloseTo(25);
    expect(s.ghostDistAt(500)).toBe(1000);
  });

  test("drafting needs to be a few metres behind a live ghost", () => {
    const s = make(pantai, ghost);
    begin(s);
    ride(s, 6);
    const ahead = s.ghostDistM! - s.distM;
    expect(ahead).toBeGreaterThan(0);
    s.distM = s.ghostDistM! - (DRAFT_MAX_M - 2);
    s.step(0.05, { cad: 85 });
    expect(s.drafting).toBe(true);
    s.distM = s.ghostDistM! + 20;
    s.step(0.05, { cad: 85 });
    expect(s.drafting).toBe(false);
  });

  test("beating the ghost is a new best with a negative delta", () => {
    const slow: GhostRun = { routeId: "pantai", timeS: 100000, trace: [0, 1] };
    const s = make(pantai, slow);
    begin(s);
    s.distM = pantai.lengthM - 5;
    ride(s, 3);
    expect(s.result!.newBest).toBe(true);
    expect(s.result!.deltaToBestS!).toBeLessThan(0);
  });
});

describe("hrZone", () => {
  test("zones follow the share of max heart rate", () => {
    expect(hrZone(100)).toBe(1);
    expect(hrZone(125)).toBe(2);
    expect(hrZone(140)).toBe(3);
    expect(hrZone(160)).toBe(4);
    expect(hrZone(180)).toBe(5);
  });
});

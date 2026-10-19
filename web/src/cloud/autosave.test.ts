import { describe, expect, it } from "vitest";
import { createAutosave, type SaveOutcome } from "./autosave";

/** A manual clock: timers run when `advance` passes their time, in order. */
function clock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id: unknown) => void timers.delete(id as number),
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    get pending() {
      return timers.size;
    },
  };
}

/** Lets the promise queue settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(outcomes: SaveOutcome[] = []) {
  const c = clock();
  const gates: Array<(outcome: SaveOutcome) => void> = [];
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const auto = createAutosave({
    delayMs: 4000,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
    save: () => {
      calls++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const preset = outcomes.shift();
      if (preset) {
        inFlight--;
        return Promise.resolve(preset);
      }
      return new Promise<SaveOutcome>((resolve) =>
        gates.push((outcome) => {
          inFlight--;
          resolve(outcome);
        }),
      );
    },
  });
  return { c, auto, gates, calls: () => calls, maxInFlight: () => maxInFlight };
}

describe("autosave scheduler", () => {
  it("waits for the quiet time after the last edit", async () => {
    const s = setup(["ok"]);
    s.auto.touch();
    s.c.advance(3000);
    s.auto.touch();
    s.c.advance(3000);
    expect(s.calls()).toBe(0);
    s.c.advance(1000);
    await settle();
    expect(s.calls()).toBe(1);
  });

  it("writes once for a burst of edits", async () => {
    const s = setup(["ok", "ok"]);
    for (let i = 0; i < 20; i++) {
      s.auto.touch();
      s.c.advance(100);
    }
    s.c.advance(4000);
    await settle();
    expect(s.calls()).toBe(1);
    expect(s.c.pending).toBe(0);
  });

  it("never runs two writes at once, and queues exactly one more for the edits made meanwhile", async () => {
    const s = setup();
    s.auto.touch();
    s.c.advance(4000);
    expect(s.auto.busy).toBe(true);
    // Three edits, each followed by its quiet time, while the first write is still in flight.
    for (let i = 0; i < 3; i++) {
      s.auto.touch();
      s.c.advance(4000);
    }
    expect(s.calls()).toBe(1);
    s.gates.shift()!("ok");
    await settle();
    expect(s.calls()).toBe(2);
    s.gates.shift()!("ok");
    await settle();
    expect(s.calls()).toBe(2);
    expect(s.maxInFlight()).toBe(1);
    expect(s.auto.busy).toBe(false);
  });

  it("stops at a conflict until resumed, dropping the queued write", async () => {
    const s = setup();
    s.auto.touch();
    s.c.advance(4000);
    s.auto.touch();
    s.c.advance(4000);
    s.gates.shift()!("conflict");
    await settle();
    expect(s.auto.paused).toBe(true);
    expect(s.calls()).toBe(1);
    s.auto.touch();
    s.c.advance(10_000);
    await settle();
    expect(s.calls()).toBe(1);
    expect(s.c.pending).toBe(0);
    s.auto.resume();
    s.auto.touch();
    s.c.advance(4000);
    await settle();
    expect(s.calls()).toBe(2);
  });

  it("after a failure does nothing until the next edit, which tries again", async () => {
    const s = setup(["error", "ok"]);
    s.auto.touch();
    s.c.advance(4000);
    await settle();
    expect(s.calls()).toBe(1);
    s.c.advance(60_000);
    await settle();
    expect(s.calls()).toBe(1);
    s.auto.touch();
    s.c.advance(4000);
    await settle();
    expect(s.calls()).toBe(2);
  });

  it("treats a thrown write as a failure", async () => {
    const c = clock();
    let calls = 0;
    const auto = createAutosave({
      delayMs: 10,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
      save: () => {
        calls++;
        return Promise.reject(new Error("boom"));
      },
    });
    auto.touch();
    c.advance(10);
    await settle();
    expect(calls).toBe(1);
    expect(auto.busy).toBe(false);
    expect(auto.paused).toBe(false);
  });

  it("cancel drops the countdown and the queued write", async () => {
    const s = setup(["ok"]);
    s.auto.touch();
    s.auto.cancel();
    s.c.advance(10_000);
    await settle();
    expect(s.calls()).toBe(0);
  });
});

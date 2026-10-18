import { describe, expect, test } from "bun:test";
import { CadenceEstimator, parseCsc, parseHeartRate } from "./ble-parse.ts";

const view = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);

describe("parseHeartRate", () => {
  test("8-bit value", () => {
    expect(parseHeartRate(view([0x00, 72]))).toEqual({ hr: 72, rr: [] });
  });
  test("16-bit value", () => {
    expect(parseHeartRate(view([0x01, 0x2c, 0x01])).hr).toBe(300);
  });
  test("RR intervals converted to ms", () => {
    const r = parseHeartRate(view([0x10, 60, 0x00, 0x04, 0x00, 0x02]));
    expect(r.hr).toBe(60);
    expect(r.rr).toEqual([1000, 500]);
  });
  test("energy expended is skipped before RR", () => {
    const r = parseHeartRate(view([0x18, 80, 0xff, 0xff, 0x00, 0x04]));
    expect(r.hr).toBe(80);
    expect(r.rr).toEqual([1000]);
  });
  test("truncated buffers never throw", () => {
    expect(parseHeartRate(view([]))).toEqual({ hr: 0, rr: [] });
    expect(parseHeartRate(view([0x00]))).toEqual({ hr: 0, rr: [] });
    expect(parseHeartRate(view([0x01, 0x10]))).toEqual({ hr: 0, rr: [] });
    expect(parseHeartRate(view([0x10, 60, 0x00])).rr).toEqual([]);
  });
});

describe("parseCsc", () => {
  test("crank only", () => {
    expect(parseCsc(view([0x02, 0x05, 0x00, 0x00, 0x04]))).toEqual({ crank: { revs: 5, time: 1024 } });
  });
  test("wheel and crank", () => {
    const r = parseCsc(view([0x03, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x03, 0x00, 0x04, 0x00]));
    expect(r.wheel).toEqual({ revs: 65537, time: 512 });
    expect(r.crank).toEqual({ revs: 3, time: 4 });
  });
  test("truncated", () => {
    expect(parseCsc(view([]))).toEqual({});
    expect(parseCsc(view([0x03, 0x01, 0x00]))).toEqual({});
    expect(parseCsc(view([0x02, 0x01]))).toEqual({});
  });
});

describe("CadenceEstimator", () => {
  test("first event is undefined, then 60 rpm", () => {
    const c = new CadenceEstimator();
    expect(c.push({ revs: 0, time: 0 }, 0)).toBeUndefined();
    expect(c.push({ revs: 1, time: 1024 }, 1000)).toBeCloseTo(60);
  });
  test("90 rpm", () => {
    const c = new CadenceEstimator();
    c.push({ revs: 0, time: 0 }, 0);
    expect(c.push({ revs: 3, time: 2048 }, 2000)).toBeCloseTo(90);
  });
  test("revs rollover", () => {
    const c = new CadenceEstimator();
    c.push({ revs: 65535, time: 1000 }, 0);
    expect(c.push({ revs: 0, time: 2024 }, 1000)).toBeCloseTo(60);
  });
  test("time rollover", () => {
    const c = new CadenceEstimator();
    c.push({ revs: 10, time: 65000 }, 0);
    expect(c.push({ revs: 11, time: 488 }, 1000)).toBeCloseTo(60);
  });
  test("duplicate event yields no new reading", () => {
    const c = new CadenceEstimator();
    c.push({ revs: 0, time: 0 }, 0);
    c.push({ revs: 1, time: 1024 }, 1000);
    expect(c.push({ revs: 1, time: 1024 }, 1500)).toBeUndefined();
  });
  test("idle falls to 0 after 2s without a new event", () => {
    const c = new CadenceEstimator();
    expect(c.idle(10000)).toBeUndefined();
    c.push({ revs: 0, time: 0 }, 0);
    c.push({ revs: 1, time: 1024 }, 1000);
    expect(c.idle(2500)).toBeUndefined();
    expect(c.idle(3500)).toBe(0);
    expect(c.push({ revs: 1, time: 1024 }, 4000)).toBe(0);
  });
  test("absurd jump is ignored", () => {
    const c = new CadenceEstimator();
    c.push({ revs: 0, time: 0 }, 0);
    expect(c.push({ revs: 50, time: 1024 }, 1000)).toBeUndefined();
    expect(c.push({ revs: 1, time: 1024 }, 1000)).toBeCloseTo(60);
  });
});

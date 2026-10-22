import { describe, expect, it } from 'bun:test';

import { GATT_INTERVAL_MS, gattBackoffMs, GattPoller } from './gattPoller';
import type { GattResult } from './gattRead';

const MIN = 60_000;
const OK: GattResult = { ok: true, sample: { tempC: 22.5, rhPct: 55, batteryMv: 3000, batteryPct: 90 }, ts: 1 };
const BUSY: GattResult = { ok: false, reason: 'unreachable', detail: null };

/** A manual clock and timer: `advance` runs what became due, in order, and lets async reads finish. */
function harness(results: GattResult[]) {
  let now = 1_000_000;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let seq = 0;
  const reads: { id: string; at: number }[] = [];
  const stored: { id: string; ok: boolean; at: number }[] = [];
  const poller = new GattPoller({
    now: () => now,
    read: async (id) => {
      reads.push({ id, at: now });
      return results.shift() ?? OK;
    },
    onResult: (id, result, at) => void stored.push({ id, ok: result.ok, at }),
    setTimer: (fn, ms) => {
      const t = { at: now + ms, fn, id: ++seq };
      timers.push(t);
      return t.id;
    },
    clearTimer: (handle) => {
      const i = timers.findIndex((t) => t.id === handle);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const advance = async (ms: number) => {
    const target = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > target) break;
      timers.shift();
      now = Math.max(now, next.at);
      next.fn();
      await flush();
    }
    now = target;
  };
  return { poller, advance, reads, stored, timers, now: () => now, flush };
}

describe('gattBackoffMs', () => {
  it('backs off 2, 4, 8 minutes and then settles at the interval', () => {
    expect([1, 2, 3, 4, 5, 9].map(gattBackoffMs)).toEqual([2 * MIN, 4 * MIN, 8 * MIN, 10 * MIN, 10 * MIN, 10 * MIN]);
  });
});

describe('GattPoller', () => {
  it('reads at once when there is no sample, then every ten minutes', async () => {
    const h = harness([]);
    h.poller.start(['A'], new Map());
    await h.advance(0);
    expect(h.reads.length).toBe(1);
    await h.advance(GATT_INTERVAL_MS - 1);
    expect(h.reads.length).toBe(1);
    await h.advance(1);
    expect(h.reads.length).toBe(2);
    await h.advance(GATT_INTERVAL_MS);
    expect(h.reads.length).toBe(3);
    expect(h.stored.every((s) => s.ok)).toBe(true);
  });

  it('waits out the interval after a sample that is already stored', async () => {
    const h = harness([]);
    h.poller.start(['A'], new Map([['A', h.now() - 3 * MIN]]));
    await h.advance(6 * MIN);
    expect(h.reads.length).toBe(0);
    await h.advance(MIN + 1);
    expect(h.reads.length).toBe(1);
  });

  it('retries sooner after a failure, backing off, and goes back to the interval after a success', async () => {
    const h = harness([BUSY, BUSY, OK]);
    h.poller.start(['A'], new Map());
    await h.advance(0);
    expect(h.reads.length).toBe(1);
    await h.advance(2 * MIN);
    expect(h.reads.length).toBe(2);
    await h.advance(4 * MIN - 1);
    expect(h.reads.length).toBe(2);
    await h.advance(1);
    expect(h.reads.length).toBe(3);
    expect(h.stored.map((s) => s.ok)).toEqual([false, false, true]);
    await h.advance(GATT_INTERVAL_MS - 1);
    expect(h.reads.length).toBe(3);
    await h.advance(1);
    expect(h.reads.length).toBe(4);
  });

  it('reads sensors one after the other', async () => {
    const h = harness([]);
    h.poller.start(['A', 'B'], new Map());
    await h.advance(0);
    expect(h.reads.map((r) => r.id)).toEqual(['A', 'B']);
  });

  it('does nothing after stop and picks up again on start', async () => {
    const h = harness([]);
    h.poller.start(['A'], new Map());
    await h.advance(0);
    h.poller.stop();
    expect(h.timers.length).toBe(0);
    await h.advance(3 * GATT_INTERVAL_MS);
    expect(h.reads.length).toBe(1);
    h.poller.start(['A'], new Map([['A', h.now() - 30 * MIN]]));
    await h.advance(0);
    expect(h.reads.length).toBe(2);
  });

  it('readNow reads out of turn and moves the schedule', async () => {
    const h = harness([]);
    h.poller.start(['A'], new Map([['A', h.now()]]));
    const result = await h.poller.readNow('A');
    expect(result.ok).toBe(true);
    await h.advance(GATT_INTERVAL_MS - 1);
    expect(h.reads.length).toBe(1);
    await h.advance(1);
    expect(h.reads.length).toBe(2);
  });

  it('forgets a sensor that left the set', async () => {
    const h = harness([]);
    h.poller.start(['A', 'B'], new Map());
    await h.advance(0);
    h.poller.start(['B'], new Map());
    await h.advance(GATT_INTERVAL_MS);
    expect(h.reads.filter((r) => r.id === 'A').length).toBe(1);
    expect(h.reads.filter((r) => r.id === 'B').length).toBe(2);
  });
});

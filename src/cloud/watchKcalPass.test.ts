import { describe, expect, it } from 'bun:test';

import { runWatchKcalPass, type SendFailure, type WatchKcalIo } from './watchKcalPass';
import { WATCH_KCAL_MAX_PER_PASS, type WatchKcalPayload, type WatchKcalSent, type WatchWorkoutRow } from './watchKcalPlan';

const NOW = 1_792_100_000;
const workout = (start: number, over: Partial<WatchWorkoutRow> = {}): WatchWorkoutRow => ({
  start,
  end: start + 600,
  duration: 600,
  calories: 50,
  sportType: 2,
  sportName: 'Walking',
  imported: 0,
  complete: 1,
  cloudHash: null,
  ...over,
});

interface Harness {
  io: WatchKcalIo;
  requests: WatchKcalPayload[];
  sent: Map<number, WatchKcalSent>;
  errors: unknown[];
  sentNotes: () => number;
}

function harness(
  workouts: WatchWorkoutRow[],
  opts: { bound?: string | null; paused?: boolean; fail?: (payload: WatchKcalPayload) => unknown } = {},
): Harness {
  const requests: WatchKcalPayload[] = [];
  const sent = new Map<number, WatchKcalSent>();
  const errors: unknown[] = [];
  let notes = 0;
  const io: WatchKcalIo = {
    paused: () => opts.paused ?? false,
    boundAccount: async () => (opts.bound === undefined ? 'acc-1' : opts.bound),
    workouts: async () => workouts,
    sentFor: async (start) => sent.get(start) ?? null,
    label: (name) => name,
    send: async (payload) => {
      const failure = opts.fail?.(payload);
      if (failure) throw failure;
      requests.push(payload);
    },
    markSent: async (start, accountId, payload) => {
      sent.set(start, { accountId, externalId: payload.externalId, date: payload.date, kcal: payload.kcal });
    },
    classify: (error): SendFailure => (error as { failure?: SendFailure }).failure ?? 'stop',
    onSent: async () => {
      notes += 1;
    },
    onError: async (_start, error) => {
      errors.push(error);
    },
    detachedHash: 'detached',
    nowSec: () => NOW,
  };
  return { io, requests, sent, errors, sentNotes: () => notes };
}

const failing = (failure: SendFailure) => ({ failure });

describe('runWatchKcalPass: the gates', () => {
  it('sends every eligible workout of the account the phone is bound to, once', async () => {
    const h = harness([workout(NOW - 100), workout(NOW - 5000)]);
    expect(await runWatchKcalPass(h.io, 'acc-1')).toEqual({ sent: 2, stopped: false });
    expect(h.requests.map((p) => p.externalId)).toEqual([`watch:${NOW - 100}`, `watch:${NOW - 5000}`]);
    expect(h.sentNotes()).toBe(2);
    // The next sync repeats the pass: nothing is sent twice.
    expect(await runWatchKcalPass(h.io, 'acc-1')).toEqual({ sent: 0, stopped: false });
    expect(h.requests).toHaveLength(2);
  });

  it('does nothing while an account question is open (sync paused)', async () => {
    const h = harness([workout(NOW - 100)], { paused: true });
    expect(await runWatchKcalPass(h.io, 'acc-1')).toEqual({ sent: 0, stopped: false });
    expect(h.requests).toHaveLength(0);
  });

  it('does nothing while the phone\'s data is bound to another account, or to none', async () => {
    const other = harness([workout(NOW - 100)], { bound: 'acc-old' });
    expect(await runWatchKcalPass(other.io, 'acc-1')).toEqual({ sent: 0, stopped: false });
    const none = harness([workout(NOW - 100)], { bound: null });
    expect(await runWatchKcalPass(none.io, 'acc-1')).toEqual({ sent: 0, stopped: false });
    expect(other.requests.length + none.requests.length).toBe(0);
  });

  it('skips imports, incomplete workouts, ones kept apart, ones without energy and ones older than 30 days', async () => {
    const h = harness([
      workout(NOW - 100, { imported: 1 }),
      workout(NOW - 200, { complete: 0 }),
      workout(NOW - 300, { cloudHash: 'detached' }),
      workout(NOW - 400, { calories: 0 }),
      workout(NOW - 31 * 86_400),
      workout(NOW - 500),
    ]);
    expect(await runWatchKcalPass(h.io, 'acc-1')).toEqual({ sent: 1, stopped: false });
    expect(h.requests.map((p) => p.externalId)).toEqual([`watch:${NOW - 500}`]);
  });

  it('a changed energy is sent again, a workout the account was told about before an account switch is sent to the new one', async () => {
    const rows = [workout(NOW - 100)];
    const h = harness(rows);
    await runWatchKcalPass(h.io, 'acc-1');
    rows[0] = workout(NOW - 100, { calories: 80 });
    expect(await runWatchKcalPass(h.io, 'acc-1')).toEqual({ sent: 1, stopped: false });
    h.io.boundAccount = async () => 'acc-2';
    expect(await runWatchKcalPass(h.io, 'acc-2')).toEqual({ sent: 1, stopped: false });
    expect(h.requests).toHaveLength(3);
  });

  it('is capped per pass, and the next pass carries on', async () => {
    const rows = Array.from({ length: WATCH_KCAL_MAX_PER_PASS + 5 }, (_, i) => workout(NOW - 100 - i * 1000));
    const h = harness(rows);
    expect((await runWatchKcalPass(h.io, 'acc-1')).sent).toBe(WATCH_KCAL_MAX_PER_PASS);
    expect((await runWatchKcalPass(h.io, 'acc-1')).sent).toBe(5);
  });
});

describe('runWatchKcalPass: failures', () => {
  it('a quiet failure (signed out, no such procedure on this JoyoRogo) ends the pass without an error', async () => {
    const h = harness([workout(NOW - 100), workout(NOW - 200)], { fail: () => failing('quiet') });
    expect(await runWatchKcalPass(h.io, 'acc-1')).toEqual({ sent: 0, stopped: true });
    expect(h.errors).toHaveLength(0);
    expect(h.sent.size).toBe(0);
  });

  it('no usable answer (offline, a server error) is remembered and ends the pass; nothing is marked as sent', async () => {
    const h = harness([workout(NOW - 100), workout(NOW - 200)], { fail: () => failing('stop') });
    expect(await runWatchKcalPass(h.io, 'acc-1')).toEqual({ sent: 0, stopped: true });
    expect(h.errors).toHaveLength(1);
    expect(h.sent.size).toBe(0);
    // Back online: the same workouts go.
    const retry = harness([workout(NOW - 100), workout(NOW - 200)]);
    expect((await runWatchKcalPass(retry.io, 'acc-1')).sent).toBe(2);
  });

  it('a refusal of one workout is remembered, and the next workouts still go', async () => {
    const h = harness([workout(NOW - 100), workout(NOW - 200), workout(NOW - 300)], {
      fail: (payload) => (payload.externalId === `watch:${NOW - 200}` ? failing('refused') : null),
    });
    expect(await runWatchKcalPass(h.io, 'acc-1')).toEqual({ sent: 2, stopped: false });
    expect(h.errors).toHaveLength(1);
    expect([...h.sent.keys()].sort()).toEqual([NOW - 300, NOW - 100]);
  });

  it('a failure outside the request (the database) is remembered and never thrown', async () => {
    const h = harness([workout(NOW - 100)]);
    h.io.workouts = async () => {
      throw new Error('disk');
    };
    expect(await runWatchKcalPass(h.io, 'acc-1')).toEqual({ sent: 0, stopped: true });
    expect(h.errors).toHaveLength(1);
  });
});

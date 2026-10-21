import { describe, expect, it } from 'bun:test';

import type { WatchWorkoutOutcome, WatchWorkoutResult, WatchWorkoutStatus } from '../../../modules/huawei-wear/src/HuaweiWear.types';
import { refusedNoticeKey, StrengthWatchSession, watchWorkoutAvailability, type WatchWorkoutNative } from './watchWorkout';

const STRENGTH = 140;

class FakeWatch implements WatchWorkoutNative {
  calls: string[] = [];
  status: WatchWorkoutStatus = { connected: true, supported: true, active: false, sport: null, state: null, watchOperator: null };
  startOutcome: WatchWorkoutOutcome = 'confirmed';
  failWith: Error | null = null;
  /** Resolves a call only when released, to test the order of the queue. */
  gate: Promise<void> | null = null;

  getWatchWorkout() {
    return this.status;
  }
  private async answer(call: string, outcome: WatchWorkoutOutcome = 'confirmed'): Promise<WatchWorkoutResult> {
    this.calls.push(call);
    if (this.gate) await this.gate;
    if (this.failWith) throw this.failWith;
    return { outcome, code: null };
  }
  startWatchWorkout(sport: number) {
    return this.answer(`start:${sport}`, this.startOutcome);
  }
  pauseWatchWorkout() {
    return this.answer('pause');
  }
  resumeWatchWorkout() {
    return this.answer('resume');
  }
  stopWatchWorkout() {
    return this.answer('stop');
  }
}

const make = (watch: FakeWatch | null = new FakeWatch()) => {
  const logs: string[] = [];
  const session = new StrengthWatchSession({ native: () => watch, log: (m) => logs.push(m) });
  return { watch, session, logs };
};

describe('watchWorkoutAvailability', () => {
  it('hides everything without the native function or without a watch in the person\'s life', () => {
    expect(watchWorkoutAvailability(null, true)).toBe('unavailable');
    expect(watchWorkoutAvailability(new FakeWatch(), false)).toBe('unavailable');
  });

  it('tells a disconnected watch, a watch without the command and a ready one apart', () => {
    const watch = new FakeWatch();
    watch.status = { ...watch.status, connected: false, supported: false };
    expect(watchWorkoutAvailability(watch, true)).toBe('offline');
    watch.status = { ...watch.status, connected: true, supported: false };
    expect(watchWorkoutAvailability(watch, true)).toBe('unsupported');
    watch.status = { ...watch.status, supported: true };
    expect(watchWorkoutAvailability(watch, true)).toBe('ready');
  });
});

describe('StrengthWatchSession', () => {
  it('starts strength training on the watch and follows pause, resume and the end', async () => {
    const { watch, session } = make();
    expect(await session.begin({ workoutId: 'w1', sport: STRENGTH, startedBefore: false })).toBe('running');
    expect(session.getSnapshot()).toEqual({ workoutId: 'w1', phase: 'running', outcome: 'confirmed', code: null, worn: null });

    await session.setPaused(true);
    expect(session.getSnapshot().phase).toBe('paused');
    await session.setPaused(true);
    await session.setPaused(false);
    expect(session.getSnapshot().phase).toBe('running');
    await session.end();
    expect(watch.calls).toEqual(['start:140', 'pause', 'resume', 'stop']);
    expect(session.getSnapshot()).toEqual({ workoutId: null, phase: 'idle', outcome: null, code: null, worn: null });
  });

  it('keeps an unconfirmed start controllable but says so', async () => {
    const { watch, session } = make();
    watch.startOutcome = 'sent';
    expect(await session.begin({ workoutId: 'w1', sport: STRENGTH, startedBefore: false })).toBe('unconfirmed');
    await session.setPaused(true);
    expect(session.getSnapshot().phase).toBe('unconfirmed');
    await session.end();
    expect(watch.calls).toEqual(['start:140', 'pause', 'stop']);
  });

  it('fails without sending more when the watch refuses, is not connected or does not support it', async () => {
    for (const outcome of ['refused', 'not_connected', 'unsupported'] as const) {
      const { watch, session } = make();
      watch.startOutcome = outcome;
      expect(await session.begin({ workoutId: 'w1', sport: STRENGTH, startedBefore: false })).toBe('failed');
      expect(session.getSnapshot()).toEqual({ workoutId: 'w1', phase: 'failed', outcome, code: null, worn: null });
      await session.setPaused(true);
      await session.end();
      expect(watch.calls).toEqual(['start:140']);
    }
  });

  it('turns a rejected start into a failure instead of throwing', async () => {
    const { watch, session, logs } = make();
    watch.failWith = new Error('boom');
    expect(await session.begin({ workoutId: 'w1', sport: STRENGTH, startedBefore: false })).toBe('failed');
    expect(logs.some((l) => l.includes('boom'))).toBe(true);
  });

  it('fails on a binary without the native functions', async () => {
    const { session } = make(null);
    expect(await session.begin({ workoutId: 'w1', sport: STRENGTH, startedBefore: false })).toBe('failed');
    await session.setPaused(true);
    await session.end();
    expect(session.getSnapshot().phase).toBe('idle');
  });

  it('takes over a workout the native side still owns instead of starting again', async () => {
    const { watch, session } = make();
    watch.status = { ...watch.status, active: true, sport: STRENGTH, state: 'paused' };
    expect(await session.begin({ workoutId: 'w1', sport: STRENGTH, startedBefore: true })).toBe('paused');
    await session.setPaused(false);
    expect(watch.calls).toEqual(['resume']);
  });

  it('does not start a second time after an app restart and cannot stop what it no longer owns', async () => {
    const { watch, session } = make();
    expect(await session.begin({ workoutId: 'w1', sport: STRENGTH, startedBefore: true })).toBe('lost');
    await session.setPaused(true);
    await session.end();
    expect(watch.calls).toEqual([]);
  });

  it('sends pause, resume and stop in the order they were asked', async () => {
    const { watch, session } = make();
    await session.begin({ workoutId: 'w1', sport: STRENGTH, startedBefore: false });
    let release = () => {};
    watch.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = [session.setPaused(true), session.setPaused(false), session.end()];
    release();
    await Promise.all(done);
    expect(watch.calls).toEqual(['start:140', 'pause', 'resume', 'stop']);
  });

  it('notifies subscribers of every phase change', async () => {
    const { session } = make();
    const seen: string[] = [];
    const off = session.subscribe(() => seen.push(session.getSnapshot().phase));
    await session.begin({ workoutId: 'w1', sport: STRENGTH, startedBefore: false });
    await session.end();
    off();
    expect(seen).toEqual(['starting', 'running', 'idle']);
  });
});

describe('a refused start', () => {
  it('keeps the code and the wear state the watch gave, for the notice and the log', async () => {
    const watch = new FakeWatch();
    watch.startWatchWorkout = async () => ({ outcome: 'refused', code: 123002, worn: false });
    const { session, logs } = make(watch);
    expect(await session.begin({ workoutId: 'w1', sport: STRENGTH, startedBefore: false })).toBe('failed');
    expect(session.getSnapshot()).toEqual({ workoutId: 'w1', phase: 'failed', outcome: 'refused', code: 123002, worn: false });
    expect(logs).toContain('watch workout start: refused (123002), watch not worn');
  });

  it('says "not on the wrist" only when the watch said so, else the code, else the plain refusal', () => {
    expect(refusedNoticeKey(123002, false)).toBe('watch.notWorn');
    expect(refusedNoticeKey(123002, true)).toBe('watch.refusedCode');
    expect(refusedNoticeKey(123002, null)).toBe('watch.refusedCode');
    expect(refusedNoticeKey(null, null)).toBe('watch.refused');
  });
});

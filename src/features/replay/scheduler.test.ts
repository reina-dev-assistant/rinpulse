import { describe, expect, it } from 'bun:test';

import {
  EXPORT_FPS,
  EXPORT_TAIL_SEC,
  ExportCancelled,
  advanceClock,
  exportFrameCount,
  frameJobs,
  frameTime,
  isEnded,
  runExport,
  type Clock,
  type ExportDeps,
  type FrameJob,
  type FrameSink,
} from './scheduler';

describe('frame schedule', () => {
  it('has fps x (duration + tail) frames, rounded up', () => {
    expect(exportFrameCount(20, 1)).toBe(Math.ceil((20 + EXPORT_TAIL_SEC) * EXPORT_FPS));
    expect(exportFrameCount(20, 2)).toBe(Math.ceil((10 + EXPORT_TAIL_SEC) * EXPORT_FPS));
    expect(exportFrameCount(20, 0.5)).toBe(Math.ceil((40 + EXPORT_TAIL_SEC) * EXPORT_FPS));
    expect(exportFrameCount(15, 1, 24)).toBe(Math.ceil((15 + EXPORT_TAIL_SEC) * 24));
  });

  it('timestamps come from the integer index and never drift', () => {
    expect(frameTime(0, 20, 1)).toBe(0);
    expect(frameTime(30, 20, 1)).toBe(1);
    expect(frameTime(300, 20, 1)).toBe(10);
    expect(frameTime(30, 20, 2)).toBe(2);
    expect(frameTime(30 * 600, 1e9, 1)).toBe(600);
    expect(frameTime(99999, 20, 1)).toBe(20);
  });

  it('jobs are 0..n-1 in order with non-decreasing times', () => {
    const jobs = [...frameJobs(18, 1)];
    expect(jobs).toHaveLength(exportFrameCount(18, 1));
    jobs.forEach((j, i) => expect(j.index).toBe(i));
    for (let i = 1; i < jobs.length; i++) expect(jobs[i]!.t).toBeGreaterThanOrEqual(jobs[i - 1]!.t);
    expect(jobs[0]).toEqual({ index: 0, t: 0, repeat: false });
  });

  it('the tail hold is repeats of the final frame', () => {
    const jobs = [...frameJobs(18, 1)];
    const repeats = jobs.filter((j) => j.repeat);
    expect(repeats.length).toBeGreaterThanOrEqual(EXPORT_FPS - 1);
    expect(repeats.every((j) => j.t === 18)).toBe(true);
    expect(jobs.filter((j) => !j.repeat && j.t === 18)).toHaveLength(1);
  });

  it('a faster speed shortens the video, a slower one lengthens it', () => {
    expect(exportFrameCount(30, 2)).toBeLessThan(exportFrameCount(30, 1));
    expect(exportFrameCount(30, 0.5)).toBeGreaterThan(exportFrameCount(30, 1));
  });
});

describe('playback clock', () => {
  const base: Clock = { t: 0, playing: true, speed: 1 };

  it('advances by dt x speed and stops at the end', () => {
    expect(advanceClock(base, 0.5, 20).t).toBe(0.5);
    expect(advanceClock({ ...base, speed: 2 }, 0.5, 20).t).toBe(1);
    expect(advanceClock({ ...base, speed: 0.5 }, 0.5, 20).t).toBe(0.25);
    const end = advanceClock({ ...base, t: 19.9 }, 1, 20);
    expect(end).toEqual({ t: 20, playing: false, speed: 1 });
    expect(isEnded(end, 20)).toBe(true);
    expect(isEnded(base, 20)).toBe(false);
  });

  it('does nothing while paused and ignores a negative step', () => {
    const paused = { ...base, playing: false, t: 3 };
    expect(advanceClock(paused, 1, 20)).toBe(paused);
    expect(advanceClock(base, -1, 20).t).toBe(0);
  });
});

interface Log {
  events: string[];
  appended: number[];
  discarded: string[];
  rendered: number[];
}

function harness(over: Partial<{ failAppendAt: number; failRenderAt: number; abortAfter: number; slowAppend: boolean }> = {}) {
  const log: Log = { events: [], appended: [], discarded: [], rendered: [] };
  const ctl = new AbortController();
  let live = 0;
  let maxLive = 0;
  const sink: FrameSink = {
    async appendFrame(index, uri) {
      log.events.push(`append:${index}`);
      if (over.failAppendAt === index) throw new Error('encoder said no');
      // Yield a few microtasks so the next render can start while this append is still open.
      if (over.slowAppend) for (let i = 0; i < 5; i++) await Promise.resolve();
      log.appended.push(index);
      expect(uri.startsWith('file://')).toBe(true);
    },
    async finish() {
      log.events.push('finish');
      return { uri: 'file:///out.mp4', bytes: 1234, frames: log.appended.length, durationMs: 1000 };
    },
    async cancel() {
      log.events.push('cancel');
    },
  };
  const deps = (totalSec: number, speed = 1): ExportDeps => ({
    totalSec,
    speed,
    renderFrame: async (job: FrameJob) => {
      if (over.failRenderAt === job.index) throw new Error('capture failed');
      log.rendered.push(job.index);
      live++;
      maxLive = Math.max(maxLive, live);
      if (over.abortAfter !== undefined && job.index === over.abortAfter) ctl.abort();
      return `file:///f${job.index}.raw`;
    },
    sink,
    discard: (uri) => {
      live--;
      log.discarded.push(uri);
    },
    signal: ctl.signal,
  });
  return { log, deps, ctl, maxLive: () => maxLive, live: () => live };
}

describe('export run', () => {
  it('appends every frame once, in order, then finishes', async () => {
    const h = harness();
    const result = await runExport(h.deps(3));
    const n = exportFrameCount(3, 1);
    expect(h.log.appended).toEqual(Array.from({ length: n }, (_, i) => i));
    expect(h.log.events[h.log.events.length - 1]).toBe('finish');
    expect(result.uri).toBe('file:///out.mp4');
  });

  it('captures the repeated tail frames only once', async () => {
    const h = harness();
    await runExport(h.deps(3));
    expect(h.log.rendered.length).toBeLessThan(exportFrameCount(3, 1) - EXPORT_FPS + 3);
    // Every captured file was discarded, none twice.
    expect(new Set(h.log.discarded).size).toBe(h.log.discarded.length);
    expect(h.log.discarded.length).toBe(h.log.rendered.length);
  });

  it('keeps at most two frame files alive at once', async () => {
    const h = harness({ slowAppend: true });
    await runExport(h.deps(2));
    expect(h.maxLive()).toBeLessThanOrEqual(2);
    expect(h.live()).toBe(0);
  });

  it('reports progress from 0 to 1 and never backwards', async () => {
    const h = harness();
    const seen: number[] = [];
    await runExport({ ...h.deps(2), onProgress: (p) => seen.push(p.fraction) });
    expect(seen[seen.length - 1]).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
  });

  it('cancel stops rendering, cancels the encoder, discards the files and throws ExportCancelled', async () => {
    const h = harness({ abortAfter: 10 });
    await expect(runExport(h.deps(5))).rejects.toBeInstanceOf(ExportCancelled);
    expect(h.log.rendered.length).toBeLessThan(15);
    expect(h.log.events).toContain('cancel');
    expect(h.log.events).not.toContain('finish');
    expect(h.live()).toBe(0);
  });

  it('a cancel before the first frame does no work but still cancels the encoder', async () => {
    const h = harness();
    h.ctl.abort();
    await expect(runExport(h.deps(5))).rejects.toBeInstanceOf(ExportCancelled);
    expect(h.log.rendered).toEqual([]);
    expect(h.log.events).toEqual(['cancel']);
  });

  it('an encoder failure cancels the encoder and surfaces that error', async () => {
    const h = harness({ failAppendAt: 7 });
    await expect(runExport(h.deps(5))).rejects.toThrow('encoder said no');
    expect(h.log.events).toContain('cancel');
    expect(h.live()).toBe(0);
  });

  it('a capture failure cancels the encoder and surfaces that error', async () => {
    const h = harness({ failRenderAt: 4 });
    await expect(runExport(h.deps(5))).rejects.toThrow('capture failed');
    expect(h.log.events).toContain('cancel');
    expect(h.live()).toBe(0);
  });
});

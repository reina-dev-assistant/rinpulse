import { describe, expect, it } from 'bun:test';

import {
  INTRO_SEC,
  LONG_WORKOUT_SEC,
  OUTRO_SEC,
  REPLAY_MAX_SEC,
  REPLAY_MIN_SEC,
  SHORT_WORKOUT_SEC,
  buildTiming,
  phaseAt,
  playbackSec,
  replayDurationSec,
  runProgress,
  timeOfProgress,
} from './timing';

describe('replay duration', () => {
  it('is 15 s up to 10 minutes and 45 s from 4 hours', () => {
    expect(replayDurationSec(0)).toBe(REPLAY_MIN_SEC);
    expect(replayDurationSec(SHORT_WORKOUT_SEC)).toBe(REPLAY_MIN_SEC);
    expect(replayDurationSec(LONG_WORKOUT_SEC)).toBe(REPLAY_MAX_SEC);
    expect(replayDurationSec(10 * 3600)).toBe(REPLAY_MAX_SEC);
  });

  it('grows monotonically in between and stays inside 15..45 s', () => {
    let last = 0;
    for (let min = 5; min <= 400; min += 5) {
      const d = replayDurationSec(min * 60);
      expect(d).toBeGreaterThanOrEqual(last);
      expect(d).toBeGreaterThanOrEqual(REPLAY_MIN_SEC);
      expect(d).toBeLessThanOrEqual(REPLAY_MAX_SEC);
      last = d;
    }
  });

  it('a one hour ride is not three times a 20 minute one (log scale)', () => {
    const hour = replayDurationSec(3600);
    expect(hour).toBeGreaterThan(replayDurationSec(1200));
    expect(hour / replayDurationSec(1200)).toBeLessThan(1.6);
  });

  it('survives garbage input', () => {
    expect(replayDurationSec(Number.NaN)).toBe(REPLAY_MIN_SEC);
    expect(replayDurationSec(-5)).toBe(REPLAY_MIN_SEC);
  });
});

describe('timeline', () => {
  const timing = buildTiming(2 * 3600);

  it('splits into intro, run and outro that add up to the total', () => {
    expect(timing.introSec).toBe(INTRO_SEC);
    expect(timing.outroSec).toBe(OUTRO_SEC);
    expect(timing.introSec + timing.runSec + timing.outroSec).toBeCloseTo(timing.totalSec, 9);
    expect(timing.runSec).toBeGreaterThan(8);
  });

  it('every length from 15 to 45 s leaves a run of at least 9 s', () => {
    for (const sec of [0, 600, 1800, 3600, 3 * 3600, 5 * 3600]) expect(buildTiming(sec).runSec).toBeGreaterThanOrEqual(9);
  });

  it('phaseAt walks intro, run, outro with progress 0 -> 1', () => {
    expect(phaseAt(timing, 0)).toMatchObject({ phase: 'intro', p: 0, introP: 0 });
    expect(phaseAt(timing, timing.introSec + timing.runSec / 2).phase).toBe('run');
    expect(phaseAt(timing, timing.introSec + timing.runSec / 2).p).toBeCloseTo(0.5, 6);
    const end = phaseAt(timing, timing.totalSec);
    expect(end).toMatchObject({ phase: 'outro', p: 1, outroP: 1 });
    expect(phaseAt(timing, 999)).toMatchObject({ phase: 'outro', outroP: 1 });
    expect(phaseAt(timing, -3).phase).toBe('intro');
  });

  it('route progress is continuous and monotonic through the whole run', () => {
    let last = -1;
    for (let i = 0; i <= 2000; i++) {
      const p = phaseAt(timing, (i / 2000) * timing.totalSec).p;
      expect(p).toBeGreaterThanOrEqual(last - 1e-12);
      last = p;
    }
    expect(last).toBe(1);
  });

  it('eases in and out: slow at both ends of the run, constant in the middle', () => {
    const dt = 0.05;
    const speed = (t: number) => (phaseAt(timing, t + dt).p - phaseAt(timing, t).p) / dt;
    const mid = timing.introSec + timing.runSec / 2;
    expect(speed(timing.introSec + 0.05)).toBeLessThan(speed(mid) / 2);
    expect(speed(timing.introSec + timing.runSec - 0.1)).toBeLessThan(speed(mid) / 2);
    expect(speed(mid)).toBeCloseTo(speed(mid + 1), 6);
  });

  it('runProgress hits the corners exactly', () => {
    expect(runProgress(0)).toBe(0);
    expect(runProgress(1)).toBeCloseTo(1, 12);
    expect(runProgress(-1)).toBe(0);
    expect(runProgress(2)).toBeCloseTo(1, 12);
  });

  it('timeOfProgress inverts the run mapping', () => {
    for (const p of [0.05, 0.25, 0.5, 0.9]) {
      const t = timeOfProgress(timing, p);
      expect(phaseAt(timing, t).p).toBeCloseTo(p, 6);
    }
    expect(timeOfProgress(timing, 0)).toBeCloseTo(timing.introSec, 6);
    expect(timeOfProgress(timing, 1)).toBeCloseTo(timing.introSec + timing.runSec, 6);
  });

  it('the speed control only changes the wall time', () => {
    expect(playbackSec(timing, 1)).toBe(timing.totalSec);
    expect(playbackSec(timing, 2)).toBe(timing.totalSec / 2);
    expect(playbackSec(timing, 0.5)).toBe(timing.totalSec * 2);
  });
});

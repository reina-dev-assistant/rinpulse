import { describe, expect, it } from 'bun:test';

import { AutoPause, type AutoPauseAction } from './autoPause';

const T0 = 1_700_000_000_000;

/** Drives one reading per second from `startSec`, `n` seconds, returning the actions with their second. */
function run(
  ap: AutoPause,
  speeds: readonly (number | null)[],
  recording: () => boolean,
  startSec = 0,
  onAction?: (a: AutoPauseAction, sec: number) => void,
): { sec: number; action: AutoPauseAction }[] {
  const out: { sec: number; action: AutoPauseAction }[] = [];
  speeds.forEach((v, i) => {
    const sec = startSec + i;
    const a = ap.update(v, T0 + sec * 1000, recording());
    if (a !== null) {
      out.push({ sec, action: a });
      onAction?.(a, sec);
    }
  });
  return out;
}

describe('pause', () => {
  it('pauses after 3 s under 1 m/s', () => {
    const ap = new AutoPause();
    const actions = run(ap, [5, 5, 0.2, 0.2, 0.2, 0.2], () => true);
    // Slow from second 2: 3 s later is second 5.
    expect(actions).toEqual([{ sec: 5, action: 'pause' }]);
  });

  it('does not pause in 2.9 s', () => {
    const ap = new AutoPause();
    expect(ap.update(0, T0, true)).toBeNull();
    expect(ap.update(0, T0 + 2900, true)).toBeNull();
    expect(ap.update(0, T0 + 3000, true)).toBe('pause');
  });

  it('a reading at the stop speed itself is moving', () => {
    const ap = new AutoPause();
    expect(run(ap, Array(10).fill(1.0), () => true)).toEqual([]);
  });

  it('one fast reading restarts the stop timer', () => {
    const ap = new AutoPause();
    const actions = run(ap, [0, 0, 0.5, 2, 0, 0, 0, 0], () => true);
    // The 2 m/s at second 3 clears the run; the new run starts at second 4 and fires at 7.
    expect(actions).toEqual([{ sec: 7, action: 'pause' }]);
  });

  it('never pauses while the recorder is not running', () => {
    const ap = new AutoPause();
    ap.notePaused('manual');
    expect(run(ap, Array(30).fill(0), () => false)).toEqual([]);
  });

  it('pause is not repeated on every call while the recorder has not paused yet', () => {
    const ap = new AutoPause();
    const actions = run(ap, Array(8).fill(0), () => true);
    // The caller ignored the first pause: the timer restarts at the next reading, so the retry is 3 s after that.
    expect(actions).toEqual([
      { sec: 3, action: 'pause' },
      { sec: 7, action: 'pause' },
    ]);
  });
});

describe('resume', () => {
  it('resumes after 1 s over 1.5 m/s, only after it caused the pause', () => {
    const ap = new AutoPause();
    let recording = true;
    const actions = run(ap, [0, 0, 0, 0, 0, 3, 3, 3], () => recording, 0, (a) => {
      recording = a === 'resume';
    });
    expect(actions).toEqual([
      { sec: 3, action: 'pause' },
      { sec: 6, action: 'resume' },
    ]);
  });

  it('resumes after exactly resumeAfterMs', () => {
    const ap = new AutoPause();
    ap.notePaused('auto');
    expect(ap.update(3, T0, false)).toBeNull();
    expect(ap.update(3, T0 + 999, false)).toBeNull();
    expect(ap.update(3, T0 + 1000, false)).toBe('resume');
  });

  it('the hysteresis band: 1.2 m/s neither pauses a rider nor resumes a stopped one', () => {
    const rolling = new AutoPause();
    expect(run(rolling, Array(30).fill(1.2), () => true)).toEqual([]);

    const stopped = new AutoPause();
    stopped.notePaused('auto');
    expect(run(stopped, Array(30).fill(1.2), () => false)).toEqual([]);
    expect(run(stopped, Array(30).fill(1.5), () => false, 30)).toEqual([]);
    expect(run(stopped, [1.6, 1.6], () => false, 60)).toEqual([{ sec: 61, action: 'resume' }]);
  });

  it('a dip into the band restarts the resume timer', () => {
    const ap = new AutoPause();
    ap.notePaused('auto');
    const actions = run(ap, [3, 1.2, 3, 3], () => false);
    expect(actions).toEqual([{ sec: 3, action: 'resume' }]);
  });

  it('does not flap on speed jitter around the thresholds', () => {
    const ap = new AutoPause();
    let recording = true;
    const jitter = Array.from({ length: 120 }, (_, i) => (i % 2 === 0 ? 0.8 : 1.6));
    const actions = run(ap, jitter, () => recording, 0, (a) => {
      recording = a === 'resume';
    });
    expect(actions).toEqual([]);
  });

  it('a full stop and go cycle twice', () => {
    const ap = new AutoPause();
    let recording = true;
    const speeds = [6, 6, 0, 0, 0, 0, 0, 4, 4, 4, 6, 0, 0, 0, 0, 0, 5, 5, 5];
    const actions = run(ap, speeds, () => recording, 0, (a) => {
      recording = a === 'resume';
    });
    expect(actions).toEqual([
      { sec: 5, action: 'pause' },
      { sec: 8, action: 'resume' },
      { sec: 14, action: 'pause' },
      { sec: 17, action: 'resume' },
    ]);
  });
});

describe('manual pause', () => {
  it('is never auto-resumed, told by notePaused', () => {
    const ap = new AutoPause();
    ap.notePaused('manual');
    expect(run(ap, Array(20).fill(8), () => false)).toEqual([]);
  });

  it('is never auto-resumed, learned from update when nobody told the engine', () => {
    const ap = new AutoPause();
    run(ap, [8, 8], () => true);
    expect(run(ap, Array(20).fill(8), () => false, 2)).toEqual([]);
  });

  it('a pause made by hand while the engine had paused it earlier is the rider own', () => {
    const ap = new AutoPause();
    let recording = true;
    run(ap, [0, 0, 0, 0], () => recording, 0, () => {
      recording = false;
    });
    // The rider resumes by hand, rides, then pauses by hand and tells the engine.
    recording = true;
    run(ap, [5, 5], () => recording, 4);
    ap.notePaused('manual');
    recording = false;
    expect(run(ap, Array(10).fill(9), () => recording, 6)).toEqual([]);
  });

  it('a manual resume of an auto pause clears it, so a later unannounced pause is manual too', () => {
    const ap = new AutoPause();
    let recording = true;
    run(ap, [0, 0, 0, 0], () => recording, 0, () => {
      recording = false;
    });
    // One second paused, seen by the engine, then the rider resumes by hand.
    run(ap, [0], () => recording, 4);
    recording = true;
    run(ap, [5, 5], () => recording, 5);
    recording = false;
    expect(run(ap, Array(10).fill(9), () => recording, 7)).toEqual([]);
  });

  it('reset forgets an auto pause', () => {
    const ap = new AutoPause();
    ap.notePaused('auto');
    ap.reset();
    expect(run(ap, Array(10).fill(9), () => false)).toEqual([]);
  });
});

describe('GPS null', () => {
  it('null is no information: it neither pauses nor resumes within 5 s', () => {
    const ap = new AutoPause();
    ap.update(8, T0, true);
    expect(run(ap, [null, null, null, null, null], () => true, 1)).toEqual([]);
  });

  it('null does not cut a stop run short, the next slow reading finishes it', () => {
    const ap = new AutoPause();
    const actions = run(ap, [0, null, null, 0], () => true);
    expect(actions).toEqual([{ sec: 3, action: 'pause' }]);
  });

  it('null for more than 5 s counts as stopped, then pauses 3 s later', () => {
    const ap = new AutoPause();
    ap.update(8, T0, true);
    const actions = run(ap, Array(12).fill(null), () => true, 1);
    // Last reading at 0 s; stale at second 6 (over 5 s); 3 s of stopped later is second 9.
    expect(actions).toEqual([{ sec: 9, action: 'pause' }]);
  });

  it('exactly 5 s of silence is not stale yet', () => {
    const ap = new AutoPause();
    ap.update(8, T0, true);
    expect(ap.update(null, T0 + 5000, true)).toBeNull();
    expect(ap.update(null, T0 + 5001, true)).toBeNull();
    expect(ap.update(null, T0 + 8001, true)).toBe('pause');
  });

  it('a silence never pauses before the first reading', () => {
    const ap = new AutoPause();
    expect(run(ap, Array(30).fill(null), () => true)).toEqual([]);
  });

  it('stale nulls never resume a paused ride', () => {
    const ap = new AutoPause();
    ap.notePaused('auto');
    ap.update(0, T0, false);
    expect(run(ap, Array(30).fill(null), () => false, 1)).toEqual([]);
  });

  it('a signal returning while paused resumes normally', () => {
    const ap = new AutoPause();
    ap.notePaused('auto');
    ap.update(0, T0, false);
    const actions = run(ap, [null, null, null, null, null, null, 4, 4], () => false, 1);
    expect(actions).toEqual([{ sec: 8, action: 'resume' }]);
  });
});

describe('custom thresholds', () => {
  it('takes its own numbers', () => {
    const ap = new AutoPause({ stopBelowMps: 2, stopAfterMs: 1000, resumeAboveMps: 3, resumeAfterMs: 2000 });
    expect(run(ap, [1.5, 1.5], () => true)).toEqual([{ sec: 1, action: 'pause' }]);
    expect(run(ap, [3.5, 3.5, 3.5], () => false, 2)).toEqual([{ sec: 4, action: 'resume' }]);
  });
});

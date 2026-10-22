import { describe, expect, it } from 'bun:test';

import { recoveryWaitHint, sleepWaitHint, strainWaitHint } from './scoresHints';

describe('recoveryWaitHint', () => {
  it('counts the nights left and shows have/need in the ring', () => {
    const hint = recoveryWaitHint({ kind: 'baseline', have: 1, need: 4, unit: 'night' }, false);
    expect(hint.caption).toBe('butuh 3 malam lagi');
    expect(hint.center).toBe('1/4');
    expect(hint.progress).toBeCloseTo(0.25);
  });

  it('counts readings when the baseline is of 1-minute readings', () => {
    expect(recoveryWaitHint({ kind: 'baseline', have: 0, need: 4, unit: 'reading' }, false).caption).toBe('butuh 4 pengukuran lagi');
  });

  it('never says zero left', () => {
    expect(recoveryWaitHint({ kind: 'baseline', have: 4, need: 4, unit: 'night' }, false).caption).toBe('butuh 1 malam lagi');
  });

  it('names recovery when the ring shows the readiness word', () => {
    expect(recoveryWaitHint({ kind: 'baseline', have: 2, need: 4, unit: 'night' }, true).caption).toBe('Pemulihan: butuh 2 malam lagi');
  });

  it('gives a cause without a count for the other waits', () => {
    for (const kind of ['off', 'spot', 'none'] as const) {
      const hint = recoveryWaitHint({ kind }, false);
      expect(hint.center).toBeNull();
      expect(hint.progress).toBeNull();
      expect(hint.caption.length).toBeGreaterThan(0);
    }
  });
});

describe('strain and sleep waits', () => {
  it('say what is missing', () => {
    expect(strainWaitHint().caption).toBe('Belum ada detak jantung hari ini');
    expect(sleepWaitHint().caption).toBe('Tidur semalam belum tercatat');
  });
});

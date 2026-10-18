import { describe, expect, test } from 'bun:test';

import { SAVER_IDLE, saverAccept, saverDismiss, saverStep } from './saver';

describe('saverStep', () => {
  test('nothing above 20 percent, nothing without a reading, nothing while charging', () => {
    expect(saverStep(SAVER_IDLE, 80, false)).toEqual(SAVER_IDLE);
    expect(saverStep(SAVER_IDLE, null, false)).toEqual(SAVER_IDLE);
    expect(saverStep(SAVER_IDLE, 5, true)).toEqual(SAVER_IDLE);
  });

  test('asks at 20 percent, once', () => {
    const asked = saverStep(SAVER_IDLE, 20, false);
    expect(asked).toEqual({ active: false, prompt: 'propose', declined: false });
    expect(saverStep(asked, 19, false)).toBe(asked);
  });

  test('accepting turns it on and it stays on', () => {
    const on = saverAccept(saverStep(SAVER_IDLE, 19, false));
    expect(on).toEqual({ active: true, prompt: 'none', declined: false });
    expect(saverStep(on, 9, false)).toBe(on);
    expect(saverStep(on, 60, false)).toBe(on);
  });

  test('"later" is not asked again, but 10 percent switches it on anyway and says so once', () => {
    const declined = saverDismiss(saverStep(SAVER_IDLE, 19, false));
    expect(declined).toEqual({ active: false, prompt: 'none', declined: true });
    expect(saverStep(declined, 15, false)).toBe(declined);
    const forced = saverStep(declined, 10, false);
    expect(forced).toEqual({ active: true, prompt: 'forced', declined: true });
    const closed = saverDismiss(forced);
    expect(closed.active).toBe(true);
    expect(saverStep(closed, 8, false)).toBe(closed);
  });

  test('a fast drop to 8 percent forces it without a question', () => {
    expect(saverStep(SAVER_IDLE, 8, false)).toEqual({ active: true, prompt: 'forced', declined: false });
  });
});

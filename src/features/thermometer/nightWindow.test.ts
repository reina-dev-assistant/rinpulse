import { describe, expect, it } from 'bun:test';

import { autoArmEnd, captureEnd, MAX_CAPTURE_MS, nextWakeTime } from './nightWindow';

/** Local time, so the tests hold in any zone the machine runs in. */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);
const idle = { active: false, userStoppedAt: null };

describe('nextWakeTime', () => {
  it('is today when the hour is still ahead and tomorrow once it passed', () => {
    expect(nextWakeTime(at(20, 3), 8)).toBe(at(20, 8).getTime());
    expect(nextWakeTime(at(20, 8), 8)).toBe(at(21, 8).getTime());
    expect(nextWakeTime(at(20, 21), 8)).toBe(at(21, 8).getTime());
  });
});

describe('captureEnd', () => {
  it('caps a start far ahead of the wake-up at 18 hours', () => {
    expect(captureEnd(at(20, 21), 8)).toBe(at(21, 8).getTime());
    expect(captureEnd(at(20, 9), 8)).toBe(at(20, 9).getTime() + MAX_CAPTURE_MS);
  });
});

describe('autoArmEnd', () => {
  it('starts in the evening and in the small hours, ending at the coming wake-up', () => {
    expect(autoArmEnd(at(20, 19), 8, idle)).toBe(at(21, 8).getTime());
    expect(autoArmEnd(at(20, 23, 40), 8, idle)).toBe(at(21, 8).getTime());
    expect(autoArmEnd(at(21, 2), 8, idle)).toBe(at(21, 8).getTime());
    expect(autoArmEnd(at(21, 7, 59), 8, idle)).toBe(at(21, 8).getTime());
  });

  it('leaves the daytime alone', () => {
    expect(autoArmEnd(at(20, 8), 8, idle)).toBeNull();
    expect(autoArmEnd(at(20, 13), 8, idle)).toBeNull();
    expect(autoArmEnd(at(20, 18, 59), 8, idle)).toBeNull();
  });

  it('does not start a second scan while one runs', () => {
    expect(autoArmEnd(at(20, 22), 8, { active: true, userStoppedAt: null })).toBeNull();
  });

  it('respects a stop made for this night, but not one from the previous morning', () => {
    const stoppedTonight = at(20, 21, 30).getTime();
    expect(autoArmEnd(at(20, 22), 8, { active: false, userStoppedAt: stoppedTonight })).toBeNull();
    expect(autoArmEnd(at(21, 1), 8, { active: false, userStoppedAt: stoppedTonight })).toBeNull();
    const stoppedMorning = at(20, 7, 30).getTime();
    expect(autoArmEnd(at(20, 22), 8, { active: false, userStoppedAt: stoppedMorning })).toBe(at(21, 8).getTime());
  });
});

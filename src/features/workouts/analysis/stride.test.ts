import { describe, expect, it } from 'bun:test';

import {
  cadenceFromSteps,
  MAX_SPM,
  MAX_STEP_M,
  MIN_SPM,
  MIN_STEP_M,
  MIN_STRIDE_SPEED_MS,
  plausibleStepLength,
  stepLengthFromSpeed,
  stepLengthSeries,
} from './stride';

describe('stepLengthFromSpeed', () => {
  it('is speed over steps per second', () => {
    expect(stepLengthFromSpeed(3, 180)).toBeCloseTo(1, 10);
    expect(stepLengthFromSpeed(2.5, 150)).toBeCloseTo(1, 10);
    // intervals.icu's Huawei run: 0.75 m a step at 74 strides per leg (148 spm).
    expect(stepLengthFromSpeed(1.85, 148)).toBeCloseTo(0.75, 2);
  });

  it('needs the person to be moving: 0.5 m/s counts, just under does not', () => {
    expect(stepLengthFromSpeed(MIN_STRIDE_SPEED_MS, 60)).toBeCloseTo(0.5, 10);
    expect(stepLengthFromSpeed(MIN_STRIDE_SPEED_MS - 0.01, 60)).toBeNull();
    expect(stepLengthFromSpeed(0, 170)).toBeNull();
  });

  it('accepts a cadence from 40 to 260 steps per minute and nothing outside', () => {
    expect(stepLengthFromSpeed(1, MIN_SPM)).toBeCloseTo(1.5, 10);
    expect(stepLengthFromSpeed(1, MIN_SPM - 1)).toBeNull();
    expect(stepLengthFromSpeed(4, MAX_SPM)).toBeCloseTo(0.923, 3);
    expect(stepLengthFromSpeed(4, MAX_SPM + 1)).toBeNull();
  });

  it('accepts a step from 0.2 to 2.5 m and drops what is outside', () => {
    expect(stepLengthFromSpeed(0.5, 150)).toBe(MIN_STEP_M);
    expect(stepLengthFromSpeed(5, 120)).toBe(MAX_STEP_M);
    expect(stepLengthFromSpeed(0.5, 200)).toBeNull();
    expect(stepLengthFromSpeed(9, 120)).toBeNull();
  });

  it('is null without a speed or a cadence', () => {
    expect(stepLengthFromSpeed(null, 170)).toBeNull();
    expect(stepLengthFromSpeed(3, null)).toBeNull();
    expect(stepLengthFromSpeed(Number.NaN, 170)).toBeNull();
  });
});

describe('cadenceFromSteps', () => {
  it('is steps over minutes, inside the human range only', () => {
    expect(cadenceFromSteps(1800, 600)).toBe(180);
    expect(cadenceFromSteps(MIN_SPM * 10, 600)).toBe(MIN_SPM);
    expect(cadenceFromSteps(MIN_SPM * 10 - 1, 600)).toBeNull();
    expect(cadenceFromSteps(MAX_SPM * 10, 600)).toBe(MAX_SPM);
    expect(cadenceFromSteps(MAX_SPM * 10 + 1, 600)).toBeNull();
  });

  it('is null without steps or time', () => {
    expect(cadenceFromSteps(0, 600)).toBeNull();
    expect(cadenceFromSteps(1000, 0)).toBeNull();
    expect(cadenceFromSteps(-5, 600)).toBeNull();
  });
});

describe('plausibleStepLength', () => {
  it('keeps 0.2 to 2.5 m and drops the rest', () => {
    expect(plausibleStepLength(MIN_STEP_M)).toBe(MIN_STEP_M);
    expect(plausibleStepLength(MAX_STEP_M)).toBe(MAX_STEP_M);
    expect(plausibleStepLength(MIN_STEP_M - 0.001)).toBeNull();
    expect(plausibleStepLength(MAX_STEP_M + 0.001)).toBeNull();
    expect(plausibleStepLength(null)).toBeNull();
    expect(plausibleStepLength(undefined)).toBeNull();
  });
});

describe('stepLengthSeries', () => {
  it('derives each sample from pace and cadence and leaves a gap where one is missing or implausible', () => {
    const out = stepLengthSeries({ pace: [300, 300, null, 300, 3000], cad: [170, null, 170, 170, 170] }, 5)!;
    expect(out[0]).toBeCloseTo(1.176, 3);
    expect(out[1]).toBeNull();
    expect(out[2]).toBeNull();
    expect(out[3]).toBeCloseTo(1.176, 3);
    // 3000 s/km is 0.33 m/s: standing.
    expect(out[4]).toBeNull();
  });

  it('lets a measured series win as a whole, dropping impossible readings', () => {
    const out = stepLengthSeries({ pace: [300, 300, 300], cad: [170, 170, 170], stride: [0.9, null, 3.5] }, 3)!;
    expect(out).toEqual([0.9, null, null]);
  });

  it('is null when no sample has a step length', () => {
    expect(stepLengthSeries({ pace: null, cad: [170, 170] }, 2)).toBeNull();
    expect(stepLengthSeries({ pace: [300, 300], cad: null }, 2)).toBeNull();
  });
});

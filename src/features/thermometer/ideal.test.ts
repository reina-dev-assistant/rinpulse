import { describe, expect, it } from 'bun:test';

import { humidityStatus, IDEAL_RH_PCT, IDEAL_TEMP_C, tempStatus } from './ideal';

describe('tempStatus', () => {
  it('calls 18 to 25 C ideal, both ends included', () => {
    expect(tempStatus(IDEAL_TEMP_C.min)).toBe('ideal');
    expect(tempStatus(21.5)).toBe('ideal');
    expect(tempStatus(IDEAL_TEMP_C.max)).toBe('ideal');
  });

  it('turns warm just above 25 C and hot above 29 C', () => {
    expect(tempStatus(25.1)).toBe('warm');
    expect(tempStatus(27)).toBe('warm');
    expect(tempStatus(29)).toBe('warm');
    expect(tempStatus(29.1)).toBe('hot');
    expect(tempStatus(34)).toBe('hot');
  });

  it('turns cool below 18 C and cold below 16 C', () => {
    expect(tempStatus(17.9)).toBe('cool');
    expect(tempStatus(16)).toBe('cool');
    expect(tempStatus(15.9)).toBe('cold');
    expect(tempStatus(8)).toBe('cold');
  });

  it('judges the figure as it is shown, at one decimal', () => {
    expect(tempStatus(25.04)).toBe('ideal');
    expect(tempStatus(25.06)).toBe('warm');
    expect(tempStatus(17.96)).toBe('ideal');
    expect(tempStatus(17.94)).toBe('cool');
  });
});

describe('humidityStatus', () => {
  it('calls 30 to 50 % ideal, both ends included', () => {
    expect(humidityStatus(IDEAL_RH_PCT.min)).toBe('ideal');
    expect(humidityStatus(40)).toBe('ideal');
    expect(humidityStatus(IDEAL_RH_PCT.max)).toBe('ideal');
  });

  it('is a bit humid above 50 % up to 60 % and too humid above 60 %', () => {
    expect(humidityStatus(50.1)).toBe('damp');
    expect(humidityStatus(60)).toBe('damp');
    expect(humidityStatus(60.1)).toBe('wet');
    expect(humidityStatus(85)).toBe('wet');
  });

  it('is too dry below 30 %', () => {
    expect(humidityStatus(29.9)).toBe('dry');
    expect(humidityStatus(12)).toBe('dry');
  });

  it('judges the figure as it is shown, at one decimal', () => {
    expect(humidityStatus(60.04)).toBe('damp');
    expect(humidityStatus(60.06)).toBe('wet');
    expect(humidityStatus(29.96)).toBe('ideal');
  });
});

import { describe, expect, it } from 'bun:test';

import { cleanCode, connectionKey, gameFigures, inRoom, isCompleteCode, sensorParts } from './format';

describe('cleanCode', () => {
  it('keeps digits, drops the rest and stops at six', () => {
    expect(cleanCode('048 213')).toBe('048213');
    expect(cleanCode('04-82-13')).toBe('048213');
    expect(cleanCode('0482139999')).toBe('048213');
    expect(cleanCode('abc')).toBe('');
  });

  it('takes the code out of a pasted link', () => {
    expect(cleanCode('joyofit://ride/join?code=048213')).toBe('048213');
    expect(cleanCode('https://fit.joyorogo.com/ride?x=2&code=999111')).toBe('999111');
  });

  it('is complete at six digits only', () => {
    expect(isCompleteCode('048213')).toBe(true);
    expect(isCompleteCode('04821')).toBe(false);
  });
});

describe('connection', () => {
  it('maps the session phase to a status word', () => {
    expect(connectionKey('connected')).toBe('connected');
    expect(connectionKey('joining')).toBe('connecting');
    expect(connectionKey('connecting')).toBe('connecting');
    expect(connectionKey('reconnecting')).toBe('reconnecting');
    expect(connectionKey('lost')).toBe('lost');
    expect(connectionKey('ended')).toBe('ended');
  });

  it('is in a room from the join until the room ends', () => {
    expect(inRoom('idle')).toBe(false);
    expect(inRoom('ended')).toBe(false);
    for (const phase of ['joining', 'connecting', 'connected', 'reconnecting', 'lost'] as const) expect(inRoom(phase)).toBe(true);
  });
});

describe('figures', () => {
  it('rounds the sensor values and keeps missing ones null', () => {
    expect(sensorParts({ hr: 131.4, cad: 87.6 })).toEqual({ hr: 131, cad: 88 });
    expect(sensorParts({ hr: null, cad: 0 })).toEqual({ hr: null, cad: 0 });
  });

  it('shows the game gear from 1 and nothing before the first frame', () => {
    expect(gameFigures(null)).toBeNull();
    expect(gameFigures({ t: 'st', v: 1, gear: 6, gearCount: 15, route: 'Bukit', phase: 'riding', distM: 1200, elevM: 30, grade: 2.5, vKmh: 29, pwrEst: 180 })).toEqual({
      speedKmh: 29,
      distanceM: 1200,
      gradePct: 2.5,
      gear: 7,
      gearCount: 15,
      powerW: 180,
      route: 'Bukit',
    });
  });
});

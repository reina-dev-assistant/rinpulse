import { describe, expect, it } from 'bun:test';

import { MAX_FIX_ACCURACY_M, type RecordedLap } from '../recorder';
import {
  GPS_READY_ACCURACY_M,
  GPS_SETTLE_SEC,
  GPS_STALE_SEC,
  canPrepare,
  gpsStatus,
  lapRows,
  liveTiles,
  paceSecPerKm,
  paceText,
  permissionPlan,
  sensorErrorKind,
  speedFigure,
  speedKind,
  type SensorChannel,
} from './format';

describe('gpsStatus', () => {
  it('is searching without a fix, with an unknown age or with a stale fix', () => {
    expect(gpsStatus(null)).toBe('searching');
    expect(gpsStatus({ accuracyM: 5, ageSec: null })).toBe('searching');
    expect(gpsStatus({ accuracyM: 5, ageSec: GPS_STALE_SEC + 1 })).toBe('searching');
  });

  it('is ready at once for a fix as accurate as 25 m', () => {
    expect(gpsStatus({ accuracyM: 6, ageSec: 1, usableSec: 0 })).toBe('ready');
    expect(gpsStatus({ accuracyM: GPS_READY_ACCURACY_M, ageSec: GPS_STALE_SEC, usableSec: 0 })).toBe('ready');
  });

  it('is fair for a usable 25-35 m fix until it has held for a few seconds, then ready', () => {
    expect(gpsStatus({ accuracyM: 30, ageSec: 1, usableSec: 0 })).toBe('fair');
    expect(gpsStatus({ accuracyM: MAX_FIX_ACCURACY_M, ageSec: 1, usableSec: GPS_SETTLE_SEC - 1 })).toBe('fair');
    expect(gpsStatus({ accuracyM: MAX_FIX_ACCURACY_M, ageSec: 1, usableSec: null })).toBe('fair');
    expect(gpsStatus({ accuracyM: MAX_FIX_ACCURACY_M, ageSec: 1, usableSec: GPS_SETTLE_SEC })).toBe('ready');
  });

  it('counts a usable fix as settled where nobody measures how long it held (while recording)', () => {
    expect(gpsStatus({ accuracyM: MAX_FIX_ACCURACY_M, ageSec: GPS_STALE_SEC })).toBe('ready');
  });

  it('is weak past that accuracy', () => {
    expect(gpsStatus({ accuracyM: MAX_FIX_ACCURACY_M + 1, ageSec: 0 })).toBe('weak');
  });

  it('counts a fix without an accuracy figure as ready, the recorder uses it', () => {
    expect(gpsStatus({ accuracyM: null, ageSec: 2 })).toBe('ready');
  });
});

describe('pace and speed per sport', () => {
  it('uses pace on foot and speed on wheels', () => {
    for (const sport of ['run', 'walk', 'hike', 'treadmill'] as const) expect(speedKind(sport)).toBe('pace');
    for (const sport of ['ride', 'indoorRide', 'other'] as const) expect(speedKind(sport)).toBe('speed');
  });

  it('turns a speed into seconds per kilometre, null when standing', () => {
    expect(paceSecPerKm(2.5)).toBe(400);
    expect(paceSecPerKm(0.2)).toBeNull();
    expect(paceSecPerKm(null)).toBeNull();
    expect(paceSecPerKm(Number.NaN)).toBeNull();
  });

  it('prints minutes and padded seconds', () => {
    expect(paceText(332)).toBe('5:32');
    expect(paceText(305.4)).toBe('5:05');
    expect(paceText(359.6)).toBe('6:00');
  });

  it('gives the figure of the sport', () => {
    expect(speedFigure('run', 3)).toEqual({ kind: 'pace', value: '5:33' });
    expect(speedFigure('run', 0.1)).toEqual({ kind: 'pace', value: null });
    expect(speedFigure('ride', 5.5)).toEqual({ kind: 'speed', value: '19,8' });
    expect(speedFigure('ride', null)).toEqual({ kind: 'speed', value: null });
    expect(speedFigure('indoorRide', 0)).toEqual({ kind: 'speed', value: '0,0' });
  });
});

describe('permissions before prepare', () => {
  it('asks for location outdoors and Bluetooth when a sensor will connect', () => {
    expect(permissionPlan('run', 0)).toEqual({ location: true, bluetooth: false });
    expect(permissionPlan('treadmill', 2)).toEqual({ location: false, bluetooth: true });
    expect(permissionPlan('ride', 1)).toEqual({ location: true, bluetooth: true });
    expect(permissionPlan('other', 0)).toEqual({ location: false, bluetooth: false });
  });

  it('needs precise location outdoors', () => {
    const plan = permissionPlan('run', 0);
    expect(canPrepare(plan, 'unknown', 'unknown')).toBe(false);
    expect(canPrepare(plan, 'denied', 'unknown')).toBe(false);
    expect(canPrepare(plan, 'blocked', 'unknown')).toBe(false);
    expect(canPrepare(plan, 'granted', 'unknown')).toBe(true);
  });

  it('needs no location indoors', () => {
    expect(canPrepare(permissionPlan('treadmill', 0), 'denied', 'unknown')).toBe(true);
  });

  it('wants the Bluetooth question asked, not answered yes', () => {
    const plan = permissionPlan('treadmill', 1);
    expect(canPrepare(plan, 'unknown', 'unknown')).toBe(false);
    expect(canPrepare(plan, 'unknown', 'granted')).toBe(true);
    expect(canPrepare(plan, 'unknown', 'denied')).toBe(true);
    expect(canPrepare(plan, 'unknown', 'blocked')).toBe(true);
  });
});

describe('sensorErrorKind', () => {
  it('names the codes the native module reports', () => {
    expect(sensorErrorKind('ERR_BLUETOOTH_OFF')).toBe('off');
    expect(sensorErrorKind('ERR_BLUETOOTH_PERMISSION')).toBe('permission');
    expect(sensorErrorKind('ERR_BLUETOOTH_UNAVAILABLE')).toBe('unavailable');
    expect(sensorErrorKind('ERR_TIMEOUT')).toBe('other');
    expect(sensorErrorKind('')).toBe('other');
  });
});

describe('liveTiles', () => {
  const none = new Set<SensorChannel>();
  it('shows only what has a reading when no sensor is in use', () => {
    expect(liveTiles({ hr: null, cadence: null, watts: null }, none)).toEqual({ hr: false, cadence: false, power: false });
    expect(liveTiles({ hr: 120, cadence: 85, watts: 200 }, none)).toEqual({ hr: true, cadence: true, power: true });
  });

  it('keeps a tile of a connected sensor while it has no reading', () => {
    const channels = new Set<SensorChannel>(['hr', 'pod']);
    expect(liveTiles({ hr: null, cadence: null, watts: null }, channels)).toEqual({ hr: true, cadence: true, power: false });
  });
});

describe('lapRows', () => {
  const lap = (distanceM: number, movingSec: number, avgHr: number | null): RecordedLap => ({
    startTs: 0,
    endTs: 0,
    distanceM,
    avgHr,
    maxHr: avgHr,
    avgCadence: null,
    movingSec,
  });

  it('lists the latest lap first with the recorder numbering', () => {
    const rows = lapRows([lap(1000, 300, 150), lap(980, 310, null)]);
    expect(rows.map((r) => r.number)).toEqual([2, 1]);
    expect(rows[0]).toEqual({ number: 2, distanceM: 980, movingSec: 310, avgHr: null });
  });

  it('is empty without laps', () => {
    expect(lapRows([])).toEqual([]);
  });
});

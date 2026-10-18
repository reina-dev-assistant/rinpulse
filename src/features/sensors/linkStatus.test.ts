import { describe, expect, it } from 'bun:test';

import { failureKind, QUIET_AFTER_S, sensorStatus, type StatusLink } from './linkStatus';

const NOW = 1_700_000_000_000;

const link = (over: Partial<StatusLink>): StatusLink => ({
  state: 'disconnected',
  frames: 0,
  lastValueAt: null,
  cscMode: null,
  lastFailure: null,
  error: null,
  ...over,
});

describe('failureKind', () => {
  it('reads the texts the Android link reports (seen in logcat from the XOSS Vortex)', () => {
    expect(failureKind('connecting timed out')).toBe('notFound');
    expect(failureKind('Link ended: GATT status 133 (generic GATT error)')).toBe('notFound');
    expect(failureKind('Link ended: GATT status 62 (connection failed to establish)')).toBe('notFound');
    expect(failureKind('Link ended: GATT status 8 (connection timeout)')).toBe('lost');
    expect(failureKind('Link ended: GATT status 19 (the sensor ended the connection)')).toBe('lost');
    expect(failureKind('service discovery timed out')).toBe('lost');
    expect(failureKind('Bluetooth turned off')).toBe('bluetoothOff');
    expect(failureKind('BLUETOOTH_CONNECT permission denied')).toBe('permission');
    expect(failureKind('no supported service')).toBe('other');
  });

  it('reads the iOS texts', () => {
    expect(failureKind('Connection failed')).toBe('notFound');
    expect(failureKind('Disconnected by the sensor')).toBe('lost');
    expect(failureKind('GATT discovery timed out')).toBe('lost');
  });

  it('no error, no failure', () => {
    expect(failureKind(null)).toBeNull();
    expect(failureKind('')).toBeNull();
  });
});

describe('sensorStatus', () => {
  it('an unknown or untouched sensor is idle', () => {
    expect(sensorStatus(undefined, NOW)).toEqual({ phase: 'idle', failure: null, ageSec: null, mode: null });
    expect(sensorStatus(link({}), NOW).phase).toBe('idle');
  });

  it('the first attempt is "connecting"', () => {
    expect(sensorStatus(link({ state: 'connecting' }), NOW).phase).toBe('connecting');
  });

  it('a failed attempt keeps the link "searching" in the background, also while the next attempt runs', () => {
    const failed = link({ state: 'disconnected', lastFailure: 'connecting timed out', error: 'connecting timed out' });
    expect(sensorStatus(failed, NOW)).toMatchObject({ phase: 'searching', failure: 'notFound' });
    expect(sensorStatus({ ...failed, state: 'connecting', error: null }, NOW)).toMatchObject({ phase: 'searching', failure: 'notFound' });
    const lost = link({ lastFailure: 'Link ended: GATT status 8 (connection timeout)' });
    expect(sensorStatus(lost, NOW)).toMatchObject({ phase: 'searching', failure: 'lost' });
  });

  it('Bluetooth off or a missing permission is a failure retrying will not fix', () => {
    expect(sensorStatus(link({ lastFailure: 'Bluetooth turned off' }), NOW)).toMatchObject({ phase: 'failed', failure: 'bluetoothOff' });
    expect(sensorStatus(link({ lastFailure: 'BLUETOOTH_CONNECT permission denied' }), NOW)).toMatchObject({ phase: 'failed', failure: 'permission' });
  });

  it('connected without a value is "waiting"; with a fresh one "receiving" and its age; later "quiet"', () => {
    expect(sensorStatus(link({ state: 'connected' }), NOW).phase).toBe('waiting');
    const frame = { state: 'connected' as const, frames: 12, cscMode: 'cadence' as const };
    expect(sensorStatus(link({ ...frame, lastValueAt: NOW - 2400 }), NOW)).toEqual({ phase: 'receiving', failure: null, ageSec: 2, mode: 'cadence' });
    expect(sensorStatus(link({ ...frame, lastValueAt: NOW - QUIET_AFTER_S * 1000 }), NOW).phase).toBe('receiving');
    expect(sensorStatus(link({ ...frame, lastValueAt: NOW - (QUIET_AFTER_S + 1) * 1000 }), NOW)).toMatchObject({ phase: 'quiet', ageSec: QUIET_AFTER_S + 1 });
  });

  it('a value from an earlier connection does not make a new connection "receiving"', () => {
    expect(sensorStatus(link({ state: 'connected', frames: 0, lastValueAt: NOW - 60_000 }), NOW)).toMatchObject({ phase: 'waiting', ageSec: 60 });
  });

  it('once connected the old failure is not reported any more', () => {
    expect(sensorStatus(link({ state: 'connected', lastFailure: 'connecting timed out' }), NOW).failure).toBeNull();
  });

  it('the last value time survives a drop, so the row can say how long ago the sensor was heard', () => {
    expect(sensorStatus(link({ lastValueAt: NOW - 90_000, lastFailure: 'Link ended: GATT status 8 (connection timeout)' }), NOW)).toMatchObject({
      phase: 'searching',
      ageSec: 90,
    });
  });
});

import { describe, expect, it } from 'bun:test';

import { FakeScaleNative } from '@/features/scale/fakeNative.testkit';

import { batteryPctFromMv, LYWSD_DATA, LYWSD_SERVICE, parseLywsdNotification, readLywsdOnce } from './gattRead';

// Laid out as the MiTemperature2 / LYWSD03MMC projects document the notification (not a capture from a unit):
// 22.50 C = 2250 = 0x08ca, 55 %, 3000 mV = 0x0bb8.
const NOTIFY = 'ca08' + '37' + 'b80b';
const ID = 'A4:C1:38:02:83:F4';
const SERVICES = [{ uuid: LYWSD_SERVICE, characteristics: [{ uuid: LYWSD_DATA, properties: ['read', 'notify'] as const }] }];

describe('parseLywsdNotification', () => {
  it('reads 0.01 C, whole percent and the cell voltage', () => {
    expect(parseLywsdNotification(NOTIFY)).toEqual({ tempC: 22.5, rhPct: 55, batteryMv: 3000, batteryPct: 90 });
    expect(parseLywsdNotification('CA0837B80B')?.tempC).toBe(22.5);
  });

  it('reads a negative temperature', () => {
    // -3.25 C = -325 = 0xfebb
    expect(parseLywsdNotification('bbfe' + '40' + 'b80b')?.tempC).toBe(-3.25);
  });

  it('tolerates extra trailing bytes', () => {
    expect(parseLywsdNotification(NOTIFY + '00ff')?.rhPct).toBe(55);
  });

  it('rejects short, odd, non-hex and out-of-range values', () => {
    expect(parseLywsdNotification('')).toBeNull();
    expect(parseLywsdNotification('ca0837b8')).toBeNull();
    expect(parseLywsdNotification(NOTIFY + '0')).toBeNull();
    expect(parseLywsdNotification('zz0837b80b')).toBeNull();
    expect(parseLywsdNotification('1027' + '37' + 'b80b')).toBeNull(); // 100 C
    expect(parseLywsdNotification('ca08' + '65' + 'b80b')).toBeNull(); // 101 %
    expect(parseLywsdNotification('ca08' + '37' + '0000')).toBeNull(); // no battery voltage
  });

  it('turns the cell voltage into a percentage between empty and full', () => {
    expect(batteryPctFromMv(3100)).toBe(100);
    expect(batteryPctFromMv(3300)).toBe(100);
    expect(batteryPctFromMv(3000)).toBe(90);
    expect(batteryPctFromMv(2600)).toBe(50);
    expect(batteryPctFromMv(2100)).toBe(0);
    expect(batteryPctFromMv(1900)).toBe(0);
  });
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('readLywsdOnce', () => {
  it('connects, subscribes, resolves with the first sample and drops the link', async () => {
    const native = new FakeScaleNative();
    const result = readLywsdOnce(native, ID);
    await tick();
    native.emit('onScaleLink', { id: ID, state: 'connecting', services: [], error: null });
    native.emit('onScaleLink', { id: ID, state: 'connected', services: SERVICES, error: null });
    await tick();
    native.emit('onScaleValue', { id: ID, ts: 5, service: LYWSD_SERVICE, characteristic: LYWSD_DATA, value: NOTIFY });
    expect(await result).toEqual({ ok: true, sample: { tempC: 22.5, rhPct: 55, batteryMv: 3000, batteryPct: 90 }, ts: 5 });
    expect(native.calls).toEqual([`connect ${ID}`, `subscribe ${LYWSD_SERVICE}/${LYWSD_DATA}`, `disconnect ${ID}`]);
    expect(native.writes).toEqual([]);
    expect(native.listenerCount('onScaleLink')).toBe(0);
    expect(native.listenerCount('onScaleValue')).toBe(0);
  });

  it('skips a value that is not a sample and takes the next one', async () => {
    const native = new FakeScaleNative();
    const result = readLywsdOnce(native, ID);
    await tick();
    native.emit('onScaleLink', { id: ID, state: 'connected', services: SERVICES, error: null });
    await tick();
    native.emit('onScaleValue', { id: ID, ts: 1, service: LYWSD_SERVICE, characteristic: LYWSD_DATA, value: 'ff' });
    native.emit('onScaleValue', { id: 'other', ts: 2, service: LYWSD_SERVICE, characteristic: LYWSD_DATA, value: NOTIFY });
    native.emit('onScaleValue', { id: ID, ts: 3, service: LYWSD_SERVICE, characteristic: LYWSD_DATA, value: NOTIFY });
    expect((await result).ok).toBe(true);
  });

  it('is unreachable when the link ends before it connected (out of range, or held by the Xiaomi app)', async () => {
    const native = new FakeScaleNative();
    const result = readLywsdOnce(native, ID);
    await tick();
    native.emit('onScaleLink', { id: ID, state: 'connecting', services: [], error: null });
    native.emit('onScaleLink', { id: ID, state: 'disconnected', services: [], error: 'Link ended: GATT status 133' });
    expect(await result).toEqual({ ok: false, reason: 'unreachable', detail: 'Link ended: GATT status 133' });
    expect(native.calls.at(-1)).toBe(`disconnect ${ID}`);
  });

  it('is unreachable when nothing happens in time', async () => {
    const native = new FakeScaleNative();
    const result = await readLywsdOnce(native, ID, { connectTimeoutMs: 10 });
    expect(result).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(native.listenerCount('onScaleLink')).toBe(0);
  });

  it('reports a unit without the service (community firmware, another model)', async () => {
    const native = new FakeScaleNative();
    const result = readLywsdOnce(native, ID);
    await tick();
    native.emit('onScaleLink', { id: ID, state: 'connected', services: [{ uuid: '180a', characteristics: [] }], error: null });
    expect(await result).toMatchObject({ ok: false, reason: 'noService' });
    expect(native.calls).not.toContain(`subscribe ${LYWSD_SERVICE}/${LYWSD_DATA}`);
  });

  it('reports no data when the sensor stays silent after subscribing, or drops the link', async () => {
    const quiet = new FakeScaleNative();
    const first = readLywsdOnce(quiet, ID, { dataTimeoutMs: 10 });
    await tick();
    quiet.emit('onScaleLink', { id: ID, state: 'connected', services: SERVICES, error: null });
    expect(await first).toMatchObject({ ok: false, reason: 'noData' });

    const dropped = new FakeScaleNative();
    const second = readLywsdOnce(dropped, ID);
    await tick();
    dropped.emit('onScaleLink', { id: ID, state: 'connected', services: SERVICES, error: null });
    dropped.emit('onScaleLink', { id: ID, state: 'disconnected', services: [], error: 'Disconnected' });
    expect(await second).toMatchObject({ ok: false, reason: 'noData' });
  });

  it('maps native errors to reasons and never rejects', async () => {
    const off = new FakeScaleNative();
    off.scaleConnect = () => Promise.reject(Object.assign(new Error('off'), { code: 'ERR_BLUETOOTH_OFF' }));
    expect(await readLywsdOnce(off, ID)).toMatchObject({ ok: false, reason: 'bluetooth' });

    const denied = new FakeScaleNative();
    denied.scaleConnect = () => Promise.reject(Object.assign(new Error('no'), { code: 'ERR_BLUETOOTH_PERMISSION' }));
    expect(await readLywsdOnce(denied, ID)).toMatchObject({ ok: false, reason: 'permission' });

    const odd = new FakeScaleNative();
    odd.scaleConnect = () => Promise.reject(new Error('boom'));
    expect(await readLywsdOnce(odd, ID)).toEqual({ ok: false, reason: 'error', detail: 'boom' });

    const noChar = new FakeScaleNative();
    noChar.failing.add('subscribe');
    const result = readLywsdOnce(noChar, ID);
    await tick();
    noChar.emit('onScaleLink', { id: ID, state: 'connected', services: SERVICES, error: null });
    expect(await result).toMatchObject({ ok: false, reason: 'noService' });
  });
});

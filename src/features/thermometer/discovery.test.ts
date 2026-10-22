import { describe, expect, it } from 'bun:test';

import type { AdFrame } from '@/features/scale/types';

import { checkBindkey, foldThermometer, readingFromFrames, MI_FRAMES_KEPT, STALE_MS, visibleThermometers, type FoundThermometer } from './discovery';

const ATC = 'a4c1388d18b2' + '00ea' + '37' + '57' + '0ba1' + '12';

const frame = (patch: Partial<AdFrame>): AdFrame => ({
  id: 'A4:C1:38:8D:18:B2',
  name: null,
  rssi: -60,
  ts: 0,
  serviceUuids: [],
  serviceData: {},
  manufacturerData: {},
  ...patch,
});

describe('foldThermometer', () => {
  it('lists a readable thermometer with its reading, and keeps the name from an earlier advertisement', () => {
    let list = foldThermometer(new Map(), frame({ name: 'ATC_8D18B2', serviceData: { '181a': ATC } }), 1000);
    list = foldThermometer(list, frame({ serviceData: { '181a': ATC }, rssi: -50 }), 2000);
    expect(list.get('A4:C1:38:8D:18:B2')).toMatchObject({ name: 'ATC_8D18B2', rssi: -50, seenAt: 2000, readable: true, reading: { tempC: 23.4, rhPct: 55 } });
  });

  it('lists a stock-named unit as not readable', () => {
    const list = foldThermometer(new Map(), frame({ id: 'AA', name: 'LYWSD03MMC', serviceData: { fe95: '7120' } }), 1000);
    expect(list.get('AA')).toMatchObject({ readable: false, reading: null });
  });

  it('lists nothing else', () => {
    expect(foldThermometer(new Map(), frame({ id: 'BB', name: 'Polar H10', serviceData: { '180d': '00' } }), 1000).size).toBe(0);
    expect(foldThermometer(new Map(), frame({ id: 'CC' }), 1000).size).toBe(0);
  });

  it('lists a device whose service data is in the thermometer UUID but unreadable, until a readable frame turns it readable', () => {
    let list = foldThermometer(new Map(), frame({ serviceData: { '181a': 'ff' } }), 1000);
    expect(list.get('A4:C1:38:8D:18:B2')?.readable).toBe(false);
    list = foldThermometer(list, frame({ serviceData: { '181a': ATC } }), 2000);
    expect(list.get('A4:C1:38:8D:18:B2')?.readable).toBe(true);
    // A later unreadable frame does not take that back.
    list = foldThermometer(list, frame({ serviceData: { '181a': 'ff' } }), 3000);
    expect(list.get('A4:C1:38:8D:18:B2')).toMatchObject({ readable: true, reading: { tempC: 23.4 } });
  });
});

describe('visibleThermometers', () => {
  const device = (id: string, over: Partial<FoundThermometer>): FoundThermometer => ({ id, name: null, rssi: -70, seenAt: 100_000, reading: null, readable: false, miFrames: [], ...over });

  it('puts readable ones first, then strongest signal, and drops the quiet ones', () => {
    const map = new Map([
      ['a', device('a', { rssi: -40 })],
      ['b', device('b', { readable: true, rssi: -80 })],
      ['c', device('c', { readable: true, rssi: -60 })],
      ['gone', device('gone', { readable: true, seenAt: 100_000 - STALE_MS - 1 })],
    ]);
    expect(visibleThermometers(map, 100_000).map((d) => d.id)).toEqual(['c', 'b', 'a']);
  });
});

// ble_monitor's LYWSD03MMC frame (key e9ea895f...f3a8, humidity 46.7 %) and the synthetic frames of miBeacon.test.ts.
const LYWSD_FRAME = '58585b0550f4830238c1a495ef58763c26000097e2abb5';
const LYWSD_KEY = 'e9ea895fac7cca6d30532432a516f3a8';
const MI_ID = 'A4:C1:38:02:83:F4';

describe('stock Xiaomi units', () => {
  it('lists an unnamed unit by its MiBeacon product id and remembers its frames', () => {
    let list = foldThermometer(new Map(), frame({ id: MI_ID, serviceData: { fe95: LYWSD_FRAME } }), 1000);
    expect(list.get(MI_ID)).toMatchObject({ readable: false, reading: null, miFrames: [LYWSD_FRAME] });
    list = foldThermometer(list, frame({ id: MI_ID, serviceData: { fe95: LYWSD_FRAME } }), 2000);
    expect(list.get(MI_ID)?.miFrames).toEqual([LYWSD_FRAME]);
    list = foldThermometer(list, frame({ id: MI_ID, serviceData: { fe95: '58585b0551aa' } }), 3000);
    expect(list.get(MI_ID)?.miFrames).toEqual([LYWSD_FRAME, '58585b0551aa']);
  });

  it('does not list a Xiaomi gadget that is no thermometer (a band, a scale)', () => {
    // product id 0x0098 (a plant sensor), 0x1949 (a switch)
    expect(foldThermometer(new Map(), frame({ id: 'X1', serviceData: { fe95: '5830980001' } }), 1000).size).toBe(0);
    expect(foldThermometer(new Map(), frame({ id: 'X2', serviceData: { fe95: '5858491901' } }), 1000).size).toBe(0);
  });

  it('keeps only the newest few distinct frames', () => {
    let list = new Map<string, FoundThermometer>();
    for (let i = 0; i < MI_FRAMES_KEPT + 4; i++) {
      list = foldThermometer(list, frame({ id: MI_ID, name: 'LYWSD03MMC', serviceData: { fe95: '58585b05' + i.toString(16).padStart(2, '0') } }), 1000 + i);
    }
    const frames = list.get(MI_ID)!.miFrames;
    expect(frames.length).toBe(MI_FRAMES_KEPT);
    expect(frames.at(-1)).toBe('58585b05' + (MI_FRAMES_KEPT + 3).toString(16).padStart(2, '0'));
  });
});

describe('checkBindkey', () => {
  const device = (miFrames: string[], id = MI_ID) => ({ id, miFrames });

  it('accepts the key a frame opens with', () => {
    expect(checkBindkey(device([LYWSD_FRAME]), LYWSD_KEY)).toBe('ok');
  });

  it('rejects another key: the integrity tag does not verify', () => {
    expect(checkBindkey(device([LYWSD_FRAME]), '00112233445566778899aabbccddeeff')).toBe('wrongKey');
  });

  it('says so when no frame carries an object yet', () => {
    expect(checkBindkey(device([]), LYWSD_KEY)).toBe('noFrames');
    expect(checkBindkey(device(['1030' + '5b05' + '03' + '4c94b438c1a4']), LYWSD_KEY)).toBe('noFrames');
  });

  it('says a legacy frame (MiBeacon v3, 12 byte key) is not supported', () => {
    expect(checkBindkey(device(['5830' + '5b05' + '03' + '4c94b438c1a4' + '0d1004' + '1001ea01']), LYWSD_KEY)).toBe('unsupported');
  });

  it('takes the frame that opens, even among others', () => {
    expect(checkBindkey(device(['58585b05', LYWSD_FRAME]), LYWSD_KEY)).toBe('ok');
  });

  it('needs the address of the scan only for a frame without a MAC', () => {
    const noMac = '4859' + '0312' + 'a4' + '1b776e7c96add7' + '000000' + 'f2bf545b';
    const key = 'b2cf9a553d53571b5657defd582d676e';
    expect(checkBindkey(device([noMac], '2C:11:65:25:70:04'), key)).toBe('ok');
    expect(checkBindkey(device([noMac], '6E400001-B5A3-F393-E0A9-E50E24DCCA9E'), key)).toBe('unsupported');
  });
});


describe('readingFromFrames', () => {
  const key = '00112233445566778899aabbccddeeff';
  const T = '58585b050af4830238c1a41126c09dcb010204cc9db9a4'; // 25.4 C
  const H = '58585b050cf4830238c1a445871853e8010206e5a78aa5'; // 46.7 %
  const B = '58585b050bf4830238c1a4867216e301020580628699'; // 90 %

  it('puts the heard halves together', () => {
    expect(readingFromFrames({ id: MI_ID, miFrames: [T, B, H] }, key, 5)).toMatchObject({ tempC: 25.4, rhPct: 46.7, batteryPct: 90, format: 'mibeacon' });
  });

  it('is null with one half, with another key and with no frames', () => {
    expect(readingFromFrames({ id: MI_ID, miFrames: [T, B] }, key, 5)).toBeNull();
    expect(readingFromFrames({ id: MI_ID, miFrames: [T, H] }, 'ffeeddccbbaa99887766554433221100', 5)).toBeNull();
    expect(readingFromFrames({ id: MI_ID, miFrames: [] }, key, 5)).toBeNull();
  });
});

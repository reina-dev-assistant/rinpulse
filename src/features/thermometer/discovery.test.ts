import { describe, expect, it } from 'bun:test';

import type { AdFrame } from '@/features/scale/types';

import { foldThermometer, STALE_MS, visibleThermometers, type FoundThermometer } from './discovery';

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
  const device = (id: string, over: Partial<FoundThermometer>): FoundThermometer => ({ id, name: null, rssi: -70, seenAt: 100_000, reading: null, readable: false, ...over });

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

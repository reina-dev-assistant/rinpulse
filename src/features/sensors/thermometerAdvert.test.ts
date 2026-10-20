import { describe, expect, it } from 'bun:test';

import {
  CounterDeduper,
  decodeThermometerAdvert,
  hasThermometerService,
  isThermometerName,
  SERVICE_BTHOME,
  SERVICE_ENVIRONMENT,
} from './thermometerAdvert';

const env = (hex: string) => ({ serviceData: { [SERVICE_ENVIRONMENT]: hex } });
const bthome = (hex: string) => ({ serviceData: { [SERVICE_BTHOME]: hex } });

// A4:C1:38:8D:18:B2, 23.4 C / 55 %, 87 %, 2977 mV, counter 0x12 (laid out as pvvx's ATC1441 wiki page documents it).
const ATC_FRAME = 'a4c1388d18b2' + '00ea' + '37' + '57' + '0ba1' + '12';
// The same room in the PVVX custom format: MAC little-endian, 23.45 C, 55.67 %, 2977 mV, 87 %, counter 0x12, flags 0x05.
const PVVX_FRAME = 'b2188d38c1a4' + '2909' + 'bf15' + 'a10b' + '57' + '12' + '05';
// BTHome v2: info 0x40, packet id 0x2a, battery 87 %, temperature 23.45 C, humidity 55.67 %.
const BTHOME_FRAME = '40' + '002a' + '0157' + '022909' + '03bf15';

describe('ATC1441', () => {
  it('decodes MAC, 0.1 C, whole percent, battery and counter', () => {
    expect(decodeThermometerAdvert(env(ATC_FRAME))).toEqual({
      format: 'atc1441',
      mac: 'A4:C1:38:8D:18:B2',
      tempC: 23.4,
      rhPct: 55,
      batteryPct: 87,
      batteryMv: 2977,
      counter: 0x12,
    });
  });

  it('reads a negative temperature as signed big-endian (-5.3 C)', () => {
    const frame = 'a4c1388d18b2' + 'ffcb' + '30' + '64' + '0bb8' + '01';
    expect(decodeThermometerAdvert(env(frame))).toMatchObject({ tempC: -5.3, rhPct: 48, batteryPct: 100 });
  });

  it('accepts upper case hex', () => {
    expect(decodeThermometerAdvert(env(ATC_FRAME.toUpperCase()))?.tempC).toBe(23.4);
  });
});

describe('PVVX custom', () => {
  it('decodes little-endian fields to 0.01 C and 0.01 %', () => {
    expect(decodeThermometerAdvert(env(PVVX_FRAME))).toEqual({
      format: 'pvvx',
      mac: 'A4:C1:38:8D:18:B2',
      tempC: 23.45,
      rhPct: 55.67,
      batteryPct: 87,
      batteryMv: 2977,
      counter: 0x12,
    });
  });

  it('reads a negative temperature as signed little-endian (-5.30 C)', () => {
    const frame = 'b2188d38c1a4' + 'eefd' + 'dc12' + 'b80b' + '64' + '01' + '00';
    expect(decodeThermometerAdvert(env(frame))).toMatchObject({ tempC: -5.3, rhPct: 48.28 });
  });

  it('reports the MAC in reading order although it is stored reversed', () => {
    expect(decodeThermometerAdvert(env(PVVX_FRAME))?.mac).toBe(decodeThermometerAdvert(env(ATC_FRAME))?.mac);
  });

  it('keeps a battery percentage above 100 out of the reading', () => {
    const frame = 'b2188d38c1a4' + '2909' + 'bf15' + 'a10b' + 'ff' + '12' + '05';
    expect(decodeThermometerAdvert(env(frame))).toMatchObject({ batteryPct: null, batteryMv: 2977 });
  });
});

describe('BTHome v2', () => {
  it('decodes temperature, humidity, battery and packet id', () => {
    expect(decodeThermometerAdvert(bthome(BTHOME_FRAME))).toEqual({
      format: 'bthome',
      mac: null,
      tempC: 23.45,
      rhPct: 55.67,
      batteryPct: 87,
      batteryMv: null,
      counter: 0x2a,
    });
  });

  it('skips an encrypted payload', () => {
    expect(decodeThermometerAdvert(bthome('41' + BTHOME_FRAME.slice(2)))).toBeNull();
  });

  it('skips another BTHome version', () => {
    expect(decodeThermometerAdvert(bthome('20' + BTHOME_FRAME.slice(2)))).toBeNull();
  });

  it('keeps what was read before an object it cannot size, and walks past one it can', () => {
    // 0x0c voltage (2 bytes) between battery and temperature, then an unknown id 0x7e ends the walk.
    const withVoltage = '40' + '0157' + '0c0b0b' + '022909' + '03bf15';
    expect(decodeThermometerAdvert(bthome(withVoltage))).toMatchObject({ tempC: 23.45, rhPct: 55.67 });
    const unknownFirst = '40' + '7e00' + '022909' + '03bf15';
    expect(decodeThermometerAdvert(bthome(unknownFirst))).toBeNull();
    const unknownAfter = '40' + '022909' + '03bf15' + '7e00';
    expect(decodeThermometerAdvert(bthome(unknownAfter))).toMatchObject({ tempC: 23.45 });
  });

  it('needs temperature and humidity both, and a whole object', () => {
    expect(decodeThermometerAdvert(bthome('40' + '022909'))).toBeNull();
    expect(decodeThermometerAdvert(bthome('40' + '022909' + '03bf'))).toBeNull();
  });
});

describe('rejection', () => {
  it('rejects temperatures outside -20..60 C', () => {
    expect(decodeThermometerAdvert(env('a4c1388d18b2' + '0259' + '37' + '57' + '0ba1' + '12'))).toBeNull(); // 60.1 C
    expect(decodeThermometerAdvert(env('a4c1388d18b2' + 'ff37' + '37' + '57' + '0ba1' + '12'))).toBeNull(); // -20.1 C
    expect(decodeThermometerAdvert(env('a4c1388d18b2' + '0258' + '37' + '57' + '0ba1' + '12'))?.tempC).toBe(60);
    expect(decodeThermometerAdvert(env('a4c1388d18b2' + 'ff38' + '37' + '57' + '0ba1' + '12'))?.tempC).toBe(-20);
  });

  it('rejects humidity above 100 %', () => {
    expect(decodeThermometerAdvert(env('a4c1388d18b2' + '00ea' + '65' + '57' + '0ba1' + '12'))).toBeNull(); // 101 %
    expect(decodeThermometerAdvert(env('b2188d38c1a4' + '2909' + '1127' + 'a10b' + '57' + '12' + '05'))).toBeNull(); // 100.01 %
    expect(decodeThermometerAdvert(env('b2188d38c1a4' + '2909' + '1027' + 'a10b' + '57' + '12' + '05'))?.rhPct).toBe(100);
  });

  it('rejects a length that fits neither format, odd or non-hex data and a missing UUID', () => {
    expect(decodeThermometerAdvert(env(ATC_FRAME + '00'))).toBeNull();
    expect(decodeThermometerAdvert(env(ATC_FRAME.slice(2)))).toBeNull();
    expect(decodeThermometerAdvert(env('zz'))).toBeNull();
    expect(decodeThermometerAdvert(env('abc'))).toBeNull();
    expect(decodeThermometerAdvert(env(''))).toBeNull();
    expect(decodeThermometerAdvert({ serviceData: {} })).toBeNull();
    expect(decodeThermometerAdvert({ serviceData: { fe95: '71209800a8' } })).toBeNull();
  });
});

describe('scan filter helpers', () => {
  it('sees thermometer service data, readable or not', () => {
    expect(hasThermometerService(env('00'))).toBe(true);
    expect(hasThermometerService(bthome('41'))).toBe(true);
    expect(hasThermometerService({ serviceData: { fe95: '00' } })).toBe(false);
  });

  it('recognises the names the firmwares advertise', () => {
    for (const name of ['ATC_8D18B2', 'atc_8d18b2', 'LYWSD03MMC', 'MJ_HT_V1', 'PVVX_B218', 'BTH_8D18B2']) expect(isThermometerName(name)).toBe(true);
    for (const name of ['Polar H10', 'ATC_', 'ATC_XYZ', '', null, undefined]) expect(isThermometerName(name)).toBe(false);
  });
});

describe('CounterDeduper', () => {
  it('drops a repeat of the same counter per sensor and passes a new one', () => {
    const d = new CounterDeduper();
    expect(d.isNew('A', 5)).toBe(true);
    expect(d.isNew('A', 5)).toBe(false);
    expect(d.isNew('B', 5)).toBe(true);
    expect(d.isNew('A', 6)).toBe(true);
    expect(d.isNew('A', 5)).toBe(true); // a counter that wrapped around is a new measurement
  });

  it('treats a frame without a counter as new and forgets a sensor on request', () => {
    const d = new CounterDeduper();
    expect(d.isNew('A', null)).toBe(true);
    expect(d.isNew('A', null)).toBe(true);
    d.isNew('A', 1);
    d.forget('A');
    expect(d.isNew('A', 1)).toBe(true);
  });
});

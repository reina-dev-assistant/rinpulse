import { describe, expect, it } from 'bun:test';

import { ThermometerSampler } from './sampler';

const MIN = 60_000;
const T0 = 1_700_000_000_000;

/** ATC1441 frame for 23.4 C / 55 % with the given counter. */
const atc = (counter: number, temp10 = 234) =>
  'a4c1388d18b2' + temp10.toString(16).padStart(4, '0') + '37' + '57' + '0ba1' + counter.toString(16).padStart(2, '0');

const advert = (ts: number, counter: number, id = 'A4:C1:38:8D:18:B2', temp10 = 234) => ({ id, ts, serviceData: { '181a': atc(counter, temp10) } });

describe('ThermometerSampler', () => {
  it('ignores sensors that are not paired and frames it cannot read', () => {
    const s = new ThermometerSampler();
    s.setPaired(['A4:C1:38:8D:18:B2']);
    expect(s.accept(advert(T0, 1, 'AA:BB:CC:DD:EE:FF'))).toBeNull();
    expect(s.accept({ id: 'A4:C1:38:8D:18:B2', ts: T0, serviceData: { fe95: '7120' } })).toBeNull();
    expect(s.accept(advert(T0, 1, 'A4:C1:38:8D:18:B2', 700))).toBeNull(); // 70 C
  });

  it('takes the first advertisement and then one per five minutes', () => {
    const s = new ThermometerSampler();
    s.setPaired(['A4:C1:38:8D:18:B2']);
    expect(s.accept(advert(T0, 1))?.sample).toEqual({ sensorId: 'A4:C1:38:8D:18:B2', ts: T0, tempC: 23.4, rhPct: 55, batteryPct: 87 });
    // The sensor advertises every few seconds with a new counter every ten: all too soon.
    for (let sec = 10, c = 2; sec < 300; sec += 10, c++) expect(s.accept(advert(T0 + sec * 1000, c))).toBeNull();
    expect(s.accept(advert(T0 + 5 * MIN, 40))?.sample.ts).toBe(T0 + 5 * MIN);
    expect(s.accept(advert(T0 + 7 * MIN, 41))).toBeNull();
    expect(s.accept(advert(T0 + 10 * MIN, 42))).not.toBeNull();
  });

  it('drops a repeat of the same counter even when the interval has passed', () => {
    const s = new ThermometerSampler();
    s.setPaired(['A4:C1:38:8D:18:B2']);
    expect(s.accept(advert(T0, 7))).not.toBeNull();
    expect(s.accept(advert(T0 + 6 * MIN, 7))).toBeNull(); // the sensor sent nothing new: the same measurement
    expect(s.accept(advert(T0 + 6 * MIN, 8))).not.toBeNull();
  });

  it('does not let a dropped repeat move the throttle', () => {
    const s = new ThermometerSampler();
    s.setPaired(['A4:C1:38:8D:18:B2']);
    s.accept(advert(T0, 1));
    expect(s.accept(advert(T0 + 4 * MIN, 1))).toBeNull(); // repeat
    expect(s.accept(advert(T0 + 5 * MIN, 2))).not.toBeNull(); // five minutes after the sample, not after the repeat
  });

  it('keeps a throttle per sensor and matches ids in any case, storing the paired spelling', () => {
    const s = new ThermometerSampler();
    s.setPaired(['A4:C1:38:8D:18:B2', 'A4:C1:38:00:00:01']);
    expect(s.accept(advert(T0, 1, 'a4:c1:38:8d:18:b2'))?.sample.sensorId).toBe('A4:C1:38:8D:18:B2');
    expect(s.accept(advert(T0 + MIN, 1, 'A4:C1:38:00:00:01'))).not.toBeNull();
    expect(s.accept(advert(T0 + 2 * MIN, 2, 'A4:C1:38:8D:18:B2'))).toBeNull();
  });

  it('accepts an advertisement older than the last sample (a drained batch after live ones)', () => {
    const s = new ThermometerSampler();
    s.setPaired(['A4:C1:38:8D:18:B2']);
    s.accept(advert(T0 + 60 * MIN, 9));
    expect(s.accept(advert(T0, 1))).not.toBeNull();
  });

  it('seeds from the newest stored sample so a restart does not take a second one', () => {
    const s = new ThermometerSampler();
    s.setPaired(['A4:C1:38:8D:18:B2']);
    s.seed('A4:C1:38:8D:18:B2', T0);
    expect(s.accept(advert(T0 + 2 * MIN, 3))).toBeNull();
    expect(s.accept(advert(T0 + 5 * MIN, 4))).not.toBeNull();
  });

  it('starts fresh for a sensor that was forgotten and paired again', () => {
    const s = new ThermometerSampler();
    s.setPaired(['A4:C1:38:8D:18:B2']);
    s.accept(advert(T0, 1));
    s.setPaired([]);
    expect(s.accept(advert(T0 + MIN, 2))).toBeNull();
    s.setPaired(['A4:C1:38:8D:18:B2']);
    expect(s.accept(advert(T0 + MIN, 1))).not.toBeNull();
  });
});

/** Synthetic MiBeacon v5 frames (key below, MAC A4:C1:38:02:83:F4) encrypted with Node's crypto; see miBeacon.test.ts. */
const KEY = '00112233445566778899aabbccddeeff';
const MI = 'A4:C1:38:02:83:F4';
const FRAME_TH = '58585b0509f4830238c1a446f5b48dae6c8b0102033f3edee9'; // counter 9, 0x100D: 27.2 C / 49 %
const FRAME_T = '58585b050af4830238c1a41126c09dcb010204cc9db9a4'; // counter 10, 0x1004: 25.4 C
const FRAME_BATT = '58585b050bf4830238c1a4867216e301020580628699'; // counter 11, 0x100A: 90 %
const FRAME_H = '58585b050cf4830238c1a445871853e8010206e5a78aa5'; // counter 12, 0x1006: 46.7 %

const mi = (ts: number, hex: string, id = MI) => ({ id, ts, serviceData: { fe95: hex } });

describe('stock firmware (MiBeacon with a bind key)', () => {
  it('reads nothing without a key, and nothing for an unpaired sensor', () => {
    const s = new ThermometerSampler();
    s.setPaired([MI]);
    expect(s.accept(mi(T0, FRAME_TH))).toBeNull();
    s.setBindkey(MI, KEY);
    expect(s.accept(mi(T0, FRAME_TH, 'A4:C1:38:00:00:01'))).toBeNull();
  });

  it('takes a reading from a frame with both objects', () => {
    const s = new ThermometerSampler();
    s.setPaired([MI]);
    s.setBindkey(MI, KEY);
    expect(s.accept(mi(T0, FRAME_TH))?.sample).toEqual({ sensorId: MI, ts: T0, tempC: 27.2, rhPct: 49, batteryPct: null });
  });

  it('puts one-object frames together: temperature, battery, then humidity', () => {
    const s = new ThermometerSampler();
    s.setPaired([MI]);
    s.setBindkey(MI, KEY);
    expect(s.accept(mi(T0, FRAME_T))).toBeNull();
    expect(s.accept(mi(T0 + 1000, FRAME_BATT))).toBeNull();
    expect(s.accept(mi(T0 + 2000, FRAME_H))?.sample).toEqual({ sensorId: MI, ts: T0 + 2000, tempC: 25.4, rhPct: 46.7, batteryPct: 90 });
  });

  it('does not pair a temperature with a humidity heard more than ten minutes apart', () => {
    const s = new ThermometerSampler();
    s.setPaired([MI]);
    s.setBindkey(MI, KEY);
    expect(s.accept(mi(T0, FRAME_T))).toBeNull();
    expect(s.accept(mi(T0 + 11 * MIN, FRAME_H))).toBeNull();
  });

  it('keeps the five minute throttle and the counter dedupe', () => {
    const s = new ThermometerSampler();
    s.setPaired([MI]);
    s.setBindkey(MI, KEY);
    expect(s.accept(mi(T0, FRAME_TH))).not.toBeNull();
    expect(s.accept(mi(T0 + MIN, FRAME_TH))).toBeNull();
    expect(s.accept(mi(T0 + 6 * MIN, FRAME_TH))).toBeNull(); // the same frame again
    expect(s.accept(mi(T0 + 6 * MIN, FRAME_H))).not.toBeNull();
  });

  it('ignores a frame of another key and forgets the key with the sensor', () => {
    const s = new ThermometerSampler();
    s.setPaired([MI]);
    s.setBindkey(MI, 'ffeeddccbbaa99887766554433221100');
    expect(s.accept(mi(T0, FRAME_TH))).toBeNull();
    s.setBindkey(MI, KEY);
    expect(s.accept(mi(T0, FRAME_TH))).not.toBeNull();
    s.setBindkey(MI, null);
    expect(s.accept(mi(T0 + 10 * MIN, FRAME_H))).toBeNull();
    s.setBindkey(MI, KEY);
    s.setPaired([]);
    s.setPaired([MI]);
    expect(s.accept(mi(T0 + 20 * MIN, FRAME_H))).toBeNull(); // the key went with the pairing
  });

  it('drains an overnight batch the way a live stream would', () => {
    const s = new ThermometerSampler();
    s.setPaired([MI]);
    s.setBindkey(MI, KEY);
    expect(s.accept(mi(T0, FRAME_T))).toBeNull();
    expect(s.accept(mi(T0 + 500, FRAME_H))?.sample.tempC).toBe(25.4);
  });
});


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

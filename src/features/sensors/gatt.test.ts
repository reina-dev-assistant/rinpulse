import { describe, expect, it } from 'bun:test';
import {
  COAST_TIMEOUT_MS,
  CRANK_REVS_MODULO,
  CRANK_TICKS,
  CSC_TICKS,
  POWER_WHEEL_TICKS,
  SensorTracker,
  WHEEL_REVS_MODULO,
  bytesToHex,
  cadenceRpm,
  counterDelta,
  hexToBytes,
  kindsOfServices,
  parseBatteryLevel,
  parseCsc,
  parseHeartRate,
  parseInfoString,
  parsePower,
  parseRsc,
  revolutionStep,
  wheelSpeed,
} from './gatt';

const b = (hex: string) => hexToBytes(hex.replaceAll(' ', ''));

describe('hex helpers', () => {
  it('round-trips and tolerates odd length', () => {
    expect(bytesToHex(b('00 48 ff'))).toBe('0048ff');
    expect(Array.from(hexToBytes('abc'))).toEqual([0x0a, 0xbc]);
  });
});

describe('kindsOfServices', () => {
  it('maps the four sensor services in a stable order and ignores battery / device information', () => {
    expect(kindsOfServices(['1816', '180d', '180f', '180a'])).toEqual(['hr', 'csc']);
    expect(kindsOfServices(['1814', '1818', '1816', '180D'])).toEqual(['hr', 'power', 'csc', 'rsc']);
    expect(kindsOfServices([])).toEqual([]);
  });
});

describe('Heart Rate Measurement (0x2A37)', () => {
  it('8-bit value, no optional fields', () => {
    expect(parseHeartRate(b('00 48'))).toEqual({ bpm: 72, contact: 'unsupported', rrMs: [] });
  });

  it('16-bit value', () => {
    expect(parseHeartRate(b('01 2c 01'))?.bpm).toBe(300);
  });

  it('sensor contact: supported and detected / supported and lost / not supported', () => {
    expect(parseHeartRate(b('06 48'))?.contact).toBe('detected');
    expect(parseHeartRate(b('04 48'))?.contact).toBe('lost');
    // bit1 alone (detected) without bit2 (supported) means the strap cannot tell
    expect(parseHeartRate(b('02 48'))?.contact).toBe('unsupported');
  });

  it('energy expended in kJ', () => {
    expect(parseHeartRate(b('08 48 e8 03'))).toEqual({ bpm: 72, contact: 'unsupported', energyKj: 1000, rrMs: [] });
  });

  it('R-R intervals in 1/1024 s, as many as the packet holds', () => {
    const m = parseHeartRate(b('10 48 00 04 00 02 80 03'));
    expect(m?.rrMs).toEqual([1000, 500, (896 * 1000) / 1024]);
  });

  it('everything at once: 16-bit HR, contact, energy, two R-R', () => {
    // flags 0b00011111 = 0x1f
    const m = parseHeartRate(b('1f 5a 00 0a 00 00 04 00 04'));
    expect(m).toEqual({ bpm: 90, contact: 'detected', energyKj: 10, rrMs: [1000, 1000] });
  });

  it('a Polar-style packet: flags 0x16 (contact + R-R), 72 bpm, one R-R of 0x032c', () => {
    const m = parseHeartRate(b('16 48 2c 03'));
    expect(m?.bpm).toBe(72);
    expect(m?.contact).toBe('detected');
    expect(m?.rrMs[0]).toBeCloseTo(793.0, 0);
  });

  it('rejects truncated values', () => {
    expect(parseHeartRate(b(''))).toBeNull();
    expect(parseHeartRate(b('00'))).toBeNull();
    expect(parseHeartRate(b('01 48'))).toBeNull();
    expect(parseHeartRate(b('08 48 e8'))).toBeNull();
  });
});

describe('CSC Measurement (0x2A5B)', () => {
  it('wheel only', () => {
    expect(parseCsc(b('01 64 00 00 00 00 04'))).toEqual({ wheel: { revs: 100, time: 1024 } });
  });

  it('crank only', () => {
    expect(parseCsc(b('02 32 00 00 04'))).toEqual({ crank: { revs: 50, time: 1024 } });
  });

  it('both, wheel first', () => {
    expect(parseCsc(b('03 64 00 00 00 00 04 32 00 00 08'))).toEqual({
      wheel: { revs: 100, time: 1024 },
      crank: { revs: 50, time: 2048 },
    });
  });

  it('uint32 wheel counter near its top', () => {
    expect(parseCsc(b('01 ff ff ff ff 01 00'))?.wheel).toEqual({ revs: 4294967295, time: 1 });
  });

  it('rejects truncated values', () => {
    expect(parseCsc(b(''))).toBeNull();
    expect(parseCsc(b('01 64 00 00'))).toBeNull();
    expect(parseCsc(b('03 64 00 00 00 00 04 32 00'))).toBeNull();
  });
});

describe('rollover maths', () => {
  it('counterDelta wraps at the width', () => {
    expect(counterDelta(10, 15, 65536)).toBe(5);
    expect(counterDelta(65535, 2, CRANK_REVS_MODULO)).toBe(3);
    expect(counterDelta(4294967295, 1, WHEEL_REVS_MODULO)).toBe(2);
  });

  it('wheel step across a 16-bit time wrap and a 32-bit revolution wrap', () => {
    // 2 revs in exactly 1024 ticks (1 s): time 65500 -> 988 (65536 - 65500 + 988 = 1024)
    const step = revolutionStep({ revs: 4294967295, time: 65500 }, { revs: 1, time: 988 }, { revsModulo: WHEEL_REVS_MODULO, ticksPerSecond: CSC_TICKS });
    expect(step).toEqual({ revs: 2, seconds: 1 });
    const { speedMps, distanceM } = wheelSpeed(step!, 2.105);
    expect(distanceM).toBeCloseTo(4.21, 6);
    expect(speedMps).toBeCloseTo(4.21, 6);
  });

  it('crank step: 1 rev in 0.5 s is 120 rpm, time wraps', () => {
    // prev time 65200, now 65200 + 512 = 65712 -> wraps to 176
    const step = revolutionStep({ revs: 65535, time: 65200 }, { revs: 0, time: 176 }, { revsModulo: CRANK_REVS_MODULO, ticksPerSecond: CRANK_TICKS });
    expect(step).toEqual({ revs: 1, seconds: 0.5 });
    expect(cadenceRpm(step!)).toBe(120);
  });

  it('power wheel time uses 1/2048 s', () => {
    const step = revolutionStep({ revs: 0, time: 0 }, { revs: 4, time: 2048 }, { revsModulo: WHEEL_REVS_MODULO, ticksPerSecond: POWER_WHEEL_TICKS });
    expect(step).toEqual({ revs: 4, seconds: 1 });
  });

  it('a repeated event (time unchanged), the first sample and a long gap give no step', () => {
    const opts = { revsModulo: CRANK_REVS_MODULO, ticksPerSecond: CRANK_TICKS };
    expect(revolutionStep(null, { revs: 1, time: 1 }, opts)).toBeNull();
    expect(revolutionStep({ revs: 5, time: 100 }, { revs: 5, time: 100 }, opts)).toBeNull();
    // 20 s between events
    expect(revolutionStep({ revs: 5, time: 0 }, { revs: 6, time: 20 * 1024 }, opts)).toBeNull();
  });
});

describe('Cycling Power Measurement (0x2A63)', () => {
  it('flags 0, instantaneous power only', () => {
    expect(parsePower(b('00 00 fa 00'))).toEqual({ watts: 250 });
  });

  it('negative power is a signed value', () => {
    expect(parsePower(b('00 00 fb ff'))?.watts).toBe(-5);
  });

  it('pedal power balance in 0.5 % steps', () => {
    expect(parsePower(b('01 00 fa 00 64'))).toEqual({ watts: 250, balancePct: 50 });
  });

  it('accumulated torque is skipped, crank revolution data read in bit order', () => {
    // flags 0x0024: accumulated torque (bit2) + crank (bit5); torque 0x0123, crank 10 revs at 1024
    expect(parsePower(b('24 00 fa 00 23 01 0a 00 00 04'))).toEqual({ watts: 250, crank: { revs: 10, time: 1024 } });
  });

  it('wheel and crank data together with balance and energy', () => {
    // flags 0x0831: balance(0) + wheel(4) + crank(5) + energy(11)
    const m = parsePower(b('31 08 c8 00 60 e8 03 00 00 00 08 14 00 00 04 2a 00'));
    expect(m).toEqual({
      watts: 200,
      balancePct: 48,
      wheel: { revs: 1000, time: 2048 },
      crank: { revs: 20, time: 1024 },
      energyKj: 42,
    });
  });

  it('skips extreme force, torque, angles and dead spots before reading energy', () => {
    // flags 0x0FC0: force (6), torque (7), angles (8), top (9), bottom (10), energy (11): 4 + 4 + 3 + 2 + 2 bytes then energy 7
    const payload = 'c0 0f 64 00' + ' 00 00 00 00' + ' 00 00 00 00' + ' 00 00 00' + ' 00 00' + ' 00 00' + ' 07 00';
    expect(parsePower(b(payload))).toEqual({ watts: 100, energyKj: 7 });
  });

  it('rejects values cut off inside promised data', () => {
    expect(parsePower(b('00 00'))).toBeNull();
    expect(parsePower(b('20 00 fa 00 0a 00'))).toBeNull();
    expect(parsePower(b('10 00 fa 00 01 00 00 00'))).toBeNull();
  });
});

describe('RSC Measurement (0x2A53)', () => {
  it('speed in 1/256 m/s and cadence in steps per minute', () => {
    expect(parseRsc(b('00 00 03 a0'))).toEqual({ speedMps: 3, cadenceSpm: 160, running: false });
  });

  it('stride length, total distance and the running flag', () => {
    expect(parseRsc(b('07 00 03 a0 6e 00 e8 03 00 00'))).toEqual({
      speedMps: 3,
      cadenceSpm: 160,
      running: true,
      strideM: 1.1,
      totalDistanceM: 100,
    });
  });

  it('rejects truncated values', () => {
    expect(parseRsc(b('00 00 03'))).toBeNull();
    expect(parseRsc(b('01 00 03 a0 6e'))).toBeNull();
    expect(parseRsc(b('02 00 03 a0 e8 03'))).toBeNull();
  });
});

describe('Battery Level and Device Information', () => {
  it('battery 0..100', () => {
    expect(parseBatteryLevel(b('64'))).toBe(100);
    expect(parseBatteryLevel(b('00'))).toBe(0);
    expect(parseBatteryLevel(b('65'))).toBeNull();
    expect(parseBatteryLevel(b(''))).toBeNull();
  });

  it('strings: trailing NULs and UTF-8', () => {
    expect(parseInfoString(b('506f6c617220 4831 30 00 00'))).toBe('Polar H10');
    expect(parseInfoString(b('c3 a9'))).toBe('é');
    expect(parseInfoString(b('00 00'))).toBeNull();
  });
});

describe('SensorTracker', () => {
  const hr = (bpm: number) => bytesToHex(new Uint8Array([0x00, bpm]));
  const csc = (flags: number, ...rest: number[]) => bytesToHex(new Uint8Array([flags, ...rest]));
  const u32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const u16 = (v: number) => [v & 255, (v >>> 8) & 255];

  it('holds heart rate for 5 s, then drops it', () => {
    const t = new SensorTracker(2.105);
    expect(t.ingest('2a37', hr(140), 1000)).toBe(true);
    expect(t.read(2000).hr).toBe(140);
    expect(t.read(6000).hr).toBe(140);
    expect(t.read(6001).hr).toBeUndefined();
  });

  it('does not take a heart rate from a strap that lost contact', () => {
    const t = new SensorTracker(2.105);
    t.ingest('2a37', bytesToHex(new Uint8Array([0x04, 180])), 0);
    expect(t.read(0).hr).toBeUndefined();
    expect(t.read(0).hrContact).toBe('lost');
  });

  it('collects R-R intervals once', () => {
    const t = new SensorTracker(2.105);
    t.ingest('2a37', bytesToHex(new Uint8Array([0x10, 60, 0x00, 0x04])), 0);
    expect(t.read(0).rrMs).toEqual([1000]);
    expect(t.read(0).rrMs).toBeUndefined();
  });

  it('counts strap energy across a 16-bit wrap and ignores a counter reset', () => {
    const t = new SensorTracker(2.105);
    const e = (kj: number) => bytesToHex(new Uint8Array([0x08, 100, ...u16(kj)]));
    t.ingest('2a37', e(65530), 0);
    t.ingest('2a37', e(4), 1000);
    expect(t.energyKj).toBe(10);
    t.ingest('2a37', e(30000), 2000);
    expect(t.energyKj).toBe(10);
  });

  it('speed, distance and cadence from CSC, with coasting to zero', () => {
    const t = new SensorTracker(2.105);
    // first event: nothing to compare
    t.ingest('2a5b', csc(0x03, ...u32(1000), ...u16(1000), ...u16(500), ...u16(1000)), 0);
    expect(t.read(0).speedMps).toBeUndefined();
    // one second later: 3 wheel revs, 2 crank revs
    t.ingest('2a5b', csc(0x03, ...u32(1003), ...u16(2024), ...u16(502), ...u16(2024)), 1000);
    const r = t.read(1000);
    expect(r.speedMps).toBeCloseTo(3 * 2.105, 6);
    expect(r.cadenceRpm).toBeCloseTo(120, 6);
    expect(t.wheelDistanceM).toBeCloseTo(3 * 2.105, 6);
    // still the same last event 3.5 s later: stopped
    expect(t.read(1000 + COAST_TIMEOUT_MS + 500).speedMps).toBe(0);
    expect(t.read(1000 + COAST_TIMEOUT_MS + 500).cadenceRpm).toBe(0);
  });

  it('a CSC sensor repeating its last event does not invent distance', () => {
    const t = new SensorTracker(2.105);
    const p = csc(0x01, ...u32(10), ...u16(1000));
    t.ingest('2a5b', p, 0);
    t.ingest('2a5b', p, 500);
    expect(t.wheelDistanceM).toBe(0);
  });

  it('power meter: watts, clamped at 0, and cadence from its crank data', () => {
    const t = new SensorTracker(2.105);
    const pw = (watts: number, revs: number, time: number) =>
      bytesToHex(new Uint8Array([0x20, 0x00, ...u16(watts & 0xffff), ...u16(revs), ...u16(time)]));
    t.ingest('2a63', pw(250, 100, 0), 0);
    t.ingest('2a63', pw(260, 101, 1024), 1000);
    expect(t.read(1000).watts).toBe(260);
    expect(t.read(1000).cadenceRpm).toBe(60);
    t.ingest('2a63', pw(-10, 101, 1024), 1200);
    expect(t.read(1200).watts).toBe(0);
  });

  it('foot pod channel', () => {
    const t = new SensorTracker(2.105);
    t.ingest('2a53', '07 00 03 a0 6e 00 e8 03 00 00'.replaceAll(' ', ''), 0);
    expect(t.read(0)).toMatchObject({ podSpeedMps: 3, podCadenceSpm: 160, podStrideM: 1.1 });
  });

  it('ignores characteristics it does not use and malformed values', () => {
    const t = new SensorTracker(2.105);
    expect(t.ingest('2a19', '64', 0)).toBe(false);
    expect(t.ingest('2a37', '00', 0)).toBe(false);
  });
});

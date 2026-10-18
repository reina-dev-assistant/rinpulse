// Parsers for the standard Bluetooth SIG sensor characteristics, working on the raw bytes the native module forwards as hex.
// Sources: Heart Rate Service 1.0 (HRS), Cycling Speed and Cadence Service 1.0 (CSCS), Cycling Power Service 1.1 (CPS),
// Running Speed and Cadence Service 1.0 (RSCS), Battery Service 1.1 (BAS). All multi-byte fields are little-endian.
// No React Native imports: this file runs under bun test.

export type SensorKind = 'hr' | 'csc' | 'power' | 'rsc';

/** Service UUID (4 hex) to the kind of sensor it announces. Battery and Device Information announce nothing by themselves. */
const KIND_OF_SERVICE: Readonly<Record<string, SensorKind>> = {
  '180d': 'hr',
  '1816': 'csc',
  '1818': 'power',
  '1814': 'rsc',
};

/** The sensor kinds a list of 4-hex service UUIDs stands for, in a stable order (hr, power, csc, rsc). */
export function kindsOfServices(services: readonly string[]): SensorKind[] {
  const found = new Set<SensorKind>();
  for (const s of services) {
    const kind = KIND_OF_SERVICE[s.toLowerCase()];
    if (kind) found.add(kind);
  }
  return (['hr', 'power', 'csc', 'rsc'] as const).filter((k) => found.has(k));
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    out[i] = Number.isNaN(byte) ? 0 : byte;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

class Reader {
  private pos = 0;
  constructor(private readonly b: Uint8Array) {}
  get left(): number {
    return this.b.length - this.pos;
  }
  u8(): number {
    return this.b[this.pos++];
  }
  u16(): number {
    const v = this.b[this.pos] | (this.b[this.pos + 1] << 8);
    this.pos += 2;
    return v;
  }
  s16(): number {
    const v = this.u16();
    return v >= 0x8000 ? v - 0x10000 : v;
  }
  u32(): number {
    const v =
      (this.b[this.pos] | (this.b[this.pos + 1] << 8) | (this.b[this.pos + 2] << 16) | (this.b[this.pos + 3] << 24)) >>> 0;
    this.pos += 4;
    return v;
  }
  skip(n: number): void {
    this.pos += n;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Heart Rate Measurement (0x2A37)

/** `unsupported`: the strap cannot tell; `detected`: skin contact; `lost`: it can tell and has no contact (the value is then not trusted). */
export type SensorContact = 'unsupported' | 'detected' | 'lost';

export interface HeartRateMeasurement {
  bpm: number;
  contact: SensorContact;
  /** Accumulated energy expended in kJ (the strap's own counter; it wraps at 65535 and some straps reset it), absent when not sent. */
  energyKj?: number;
  /** R-R intervals in milliseconds, oldest first (the wire unit is 1/1024 s). */
  rrMs: number[];
}

/**
 * Flags: bit0 value format (0 = uint8, 1 = uint16), bit1 contact detected, bit2 contact feature supported, bit3 energy expended present
 * (uint16, kJ), bit4 R-R interval(s) present (uint16 each, as many as fit). Returns null for a truncated value.
 */
export function parseHeartRate(bytes: Uint8Array): HeartRateMeasurement | null {
  if (bytes.length < 2) return null;
  const r = new Reader(bytes);
  const flags = r.u8();
  const wide = (flags & 0x01) !== 0;
  const contactSupported = (flags & 0x04) !== 0;
  const contactDetected = (flags & 0x02) !== 0;
  const hasEnergy = (flags & 0x08) !== 0;
  const hasRr = (flags & 0x10) !== 0;
  if (r.left < (wide ? 2 : 1)) return null;
  const bpm = wide ? r.u16() : r.u8();
  const out: HeartRateMeasurement = {
    bpm,
    contact: !contactSupported ? 'unsupported' : contactDetected ? 'detected' : 'lost',
    rrMs: [],
  };
  if (hasEnergy) {
    if (r.left < 2) return null;
    out.energyKj = r.u16();
  }
  if (hasRr) {
    while (r.left >= 2) out.rrMs.push((r.u16() * 1000) / 1024);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Cycling Speed and Cadence Measurement (0x2A5B)

export interface CscMeasurement {
  /** Cumulative wheel revolutions (uint32) and the time of the last wheel event (uint16, 1/1024 s, wraps every 64 s). */
  wheel?: { revs: number; time: number };
  /** Cumulative crank revolutions (uint16) and the time of the last crank event (uint16, 1/1024 s). */
  crank?: { revs: number; time: number };
}

/** Flags: bit0 wheel revolution data present, bit1 crank revolution data present. */
export function parseCsc(bytes: Uint8Array): CscMeasurement | null {
  if (bytes.length < 1) return null;
  const r = new Reader(bytes);
  const flags = r.u8();
  const out: CscMeasurement = {};
  if (flags & 0x01) {
    if (r.left < 6) return null;
    out.wheel = { revs: r.u32(), time: r.u16() };
  }
  if (flags & 0x02) {
    if (r.left < 4) return null;
    out.crank = { revs: r.u16(), time: r.u16() };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Cycling Power Measurement (0x2A63)

export interface PowerMeasurement {
  /** Instantaneous power in watts (sint16; negative values are possible and mean "not pedalling forwards"). */
  watts: number;
  /** Pedal power balance in percent (left pedal share, 0.5 % resolution on the wire), absent when not sent. */
  balancePct?: number;
  /** Cumulative wheel revolutions with the time of the last wheel event in 1/2048 s (this service's own unit, not 1/1024). */
  wheel?: { revs: number; time: number };
  crank?: { revs: number; time: number };
  /** Accumulated energy in kJ. */
  energyKj?: number;
}

/**
 * Flags (uint16): bit0 pedal power balance, bit1 balance reference, bit2 accumulated torque, bit3 torque source, bit4 wheel revolution
 * data, bit5 crank revolution data, bit6 extreme force magnitudes, bit7 extreme torque magnitudes, bit8 extreme angles, bit9 top dead spot,
 * bit10 bottom dead spot, bit11 accumulated energy, bit12 offset compensation. Fields follow in bit order after the sint16 power.
 * Returns null when the value is cut off before the crank/wheel data the flags promise.
 */
export function parsePower(bytes: Uint8Array): PowerMeasurement | null {
  if (bytes.length < 4) return null;
  const r = new Reader(bytes);
  const flags = r.u16();
  const out: PowerMeasurement = { watts: r.s16() };
  if (flags & 0x0001) {
    if (r.left < 1) return null;
    out.balancePct = r.u8() / 2;
  }
  if (flags & 0x0004) {
    if (r.left < 2) return null;
    r.skip(2);
  }
  if (flags & 0x0010) {
    if (r.left < 6) return null;
    out.wheel = { revs: r.u32(), time: r.u16() };
  }
  if (flags & 0x0020) {
    if (r.left < 4) return null;
    out.crank = { revs: r.u16(), time: r.u16() };
  }
  if (flags & 0x0040) {
    if (r.left < 4) return null;
    r.skip(4);
  }
  if (flags & 0x0080) {
    if (r.left < 4) return null;
    r.skip(4);
  }
  if (flags & 0x0100) {
    if (r.left < 3) return null;
    r.skip(3);
  }
  if (flags & 0x0200) {
    if (r.left < 2) return null;
    r.skip(2);
  }
  if (flags & 0x0400) {
    if (r.left < 2) return null;
    r.skip(2);
  }
  if (flags & 0x0800 && r.left >= 2) out.energyKj = r.u16();
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Running Speed and Cadence Measurement (0x2A53)

export interface RscMeasurement {
  /** m/s (wire unit 1/256 m/s). */
  speedMps: number;
  /** Steps per minute. */
  cadenceSpm: number;
  /** Stride length in metres (wire unit 1/100 m), absent when not sent. */
  strideM?: number;
  /** The pod's own total distance in metres (wire unit 1/10 m), absent when not sent. */
  totalDistanceM?: number;
  running: boolean;
}

/** Flags: bit0 stride length present, bit1 total distance present, bit2 walking (0) or running (1). */
export function parseRsc(bytes: Uint8Array): RscMeasurement | null {
  if (bytes.length < 4) return null;
  const r = new Reader(bytes);
  const flags = r.u8();
  const out: RscMeasurement = { speedMps: r.u16() / 256, cadenceSpm: r.u8(), running: (flags & 0x04) !== 0 };
  if (flags & 0x01) {
    if (r.left < 2) return null;
    out.strideM = r.u16() / 100;
  }
  if (flags & 0x02) {
    if (r.left < 4) return null;
    out.totalDistanceM = r.u32() / 10;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Battery Level (0x2A19) and Device Information strings

/** 0..100, or null for an empty or out-of-range value. */
export function parseBatteryLevel(bytes: Uint8Array): number | null {
  if (bytes.length < 1 || bytes[0] > 100) return null;
  return bytes[0];
}

/** A Device Information string characteristic: UTF-8, may carry trailing NULs. */
export function parseInfoString(bytes: Uint8Array): string | null {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  if (end === 0) return null;
  const s = decodeUtf8(bytes.subarray(0, end)).trim();
  return s === '' ? null : s;
}

/** Hermes ships no guaranteed TextDecoder; invalid sequences become U+FFFD. */
function decodeUtf8(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const c = bytes[i];
    const extra = c >= 0xf0 ? 3 : c >= 0xe0 ? 2 : c >= 0xc0 ? 1 : 0;
    if (c >= 0x80 && extra === 0) {
      s += '\ufffd';
      i++;
      continue;
    }
    let cp = extra === 0 ? c : c & (0x3f >> extra);
    let ok = i + extra < bytes.length || extra === 0;
    for (let k = 1; ok && k <= extra; k++) {
      const next = bytes[i + k];
      if (next === undefined || (next & 0xc0) !== 0x80) ok = false;
      else cp = (cp << 6) | (next & 0x3f);
    }
    if (!ok) {
      s += '\ufffd';
      i++;
      continue;
    }
    s += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------
// Revolution counters: rollover-safe deltas

/** `(now - prev)` on a counter that wraps at `modulo` (65536 for uint16 fields, 2^32 for the wheel counter). */
export function counterDelta(prev: number, now: number, modulo: number): number {
  const d = now - prev;
  return d >= 0 ? d : d + modulo;
}

export interface RevolutionSample {
  revs: number;
  time: number;
}

export interface RevolutionStep {
  /** Revolutions since the previous event; 0 when the sensor repeated its last event. */
  revs: number;
  /** Seconds between the two events; 0 when the sensor repeated its last event. */
  seconds: number;
}

/**
 * One step of a wheel or crank counter. `prev` is the previous sample or null. Returns null when there is nothing to compare yet or the
 * sensor repeated the same event (event time unchanged: coasting, or a notification between two events). The 16-bit time wraps every
 * 64 s (CSC, 1/1024 s) or 32 s (power wheel, 1/2048 s), the revolution counters at their width; both are handled. A gap of more than
 * `maxGapSeconds` between events is reported as null too: the counters are then no longer comparable to a real speed (the sensor slept,
 * or a time wrap could have hidden a whole lap of the counter).
 */
export function revolutionStep(
  prev: RevolutionSample | null,
  now: RevolutionSample,
  opts: { revsModulo: number; ticksPerSecond: number; maxGapSeconds?: number },
): RevolutionStep | null {
  if (prev === null) return null;
  const dTicks = counterDelta(prev.time, now.time, 65536);
  if (dTicks === 0) return null;
  const seconds = dTicks / opts.ticksPerSecond;
  if (seconds > (opts.maxGapSeconds ?? 10)) return null;
  const revs = counterDelta(prev.revs, now.revs, opts.revsModulo);
  return { revs, seconds };
}

/** Event-time resolution of each field: 1/1024 s everywhere except the wheel time inside the Cycling Power Measurement (1/2048 s). */
export const CSC_TICKS = 1024;
export const POWER_WHEEL_TICKS = 2048;
export const CRANK_TICKS = 1024;
export const WHEEL_REVS_MODULO = 4294967296;
export const CRANK_REVS_MODULO = 65536;

/** Cadence in rpm from one crank step; 0 when the crank did not turn. */
export function cadenceRpm(step: RevolutionStep): number {
  return step.seconds === 0 ? 0 : (step.revs * 60) / step.seconds;
}

/** Speed in m/s and distance in metres from one wheel step. */
export function wheelSpeed(step: RevolutionStep, circumferenceM: number): { speedMps: number; distanceM: number } {
  const distanceM = step.revs * circumferenceM;
  return { speedMps: step.seconds === 0 ? 0 : distanceM / step.seconds, distanceM };
}

/** Rider-set wheel size presets in millimetres (circumference), the usual ETRTO/Garmin table values. */
export const WHEEL_CIRCUMFERENCE_MM = {
  '700x23c': 2096,
  '700x25c': 2105,
  '700x28c': 2136,
  '700x32c': 2155,
  '700x38c': 2180,
  '26x1.95': 2055,
  '27.5x2.1': 2200,
  '29x2.1': 2288,
} as const;

export const DEFAULT_WHEEL_CIRCUMFERENCE_MM = WHEEL_CIRCUMFERENCE_MM['700x25c'];

// ---------------------------------------------------------------------------------------------------------------------
// Stream tracker: turns a sequence of raw events into current speed / cadence / power

/** After this long without a new wheel or crank event the rider has stopped: speed and cadence read 0 (longer for a slow crank, see `holdMs`). */
export const COAST_TIMEOUT_MS = 3000;
/** The longest a slow crank or wheel is waited for before it reads 0. */
export const COAST_TIMEOUT_MAX_MS = 5000;
/** A heart rate or power value older than this is dropped from the sample instead of being held. */
export const VALUE_FRESH_MS = 5000;
/** A crank step faster than this is a counter glitch (a sensor that reset its revolutions), not a rider. */
export const MAX_CADENCE_RPM = 250;
/** A wheel step faster than this (m/s, 144 km/h) is a counter glitch too. */
export const MAX_WHEEL_MPS = 40;

/**
 * How long a speed or cadence from a revolution counter holds after its last event before it reads 0: the shortest the timeout allows,
 * or a revolution and a half plus a second for a slow crank (a sensor only reports at each revolution, and the radio delivers
 * in connection-interval steps), never more than `COAST_TIMEOUT_MAX_MS`.
 */
export function holdMs(stepSeconds: number): number {
  return Math.min(COAST_TIMEOUT_MAX_MS, Math.max(COAST_TIMEOUT_MS, stepSeconds * 1500 + 1000));
}

/**
 * What a Cycling Speed and Cadence sensor measures, from the flags of the frames it sent: `speed` = wheel revolutions only (a sensor in
 * speed mode, e.g. an XOSS Vortex set to speed in its app), `cadence` = crank revolutions only, `both` = a sensor that sends both.
 */
export type CscMode = 'speed' | 'cadence' | 'both';

/** The mode of a CSC sensor whose frames carried a wheel part and/or a crank part so far; null before the first frame. */
export function cscModeOf(wheelSeen: boolean, crankSeen: boolean): CscMode | null {
  if (wheelSeen && crankSeen) return 'both';
  if (wheelSeen) return 'speed';
  return crankSeen ? 'cadence' : null;
}

export interface SensorReadings {
  hr?: number;
  hrContact?: SensorContact;
  rrMs?: number[];
  watts?: number;
  /** Share of the left pedal in percent, from a power meter that measures balance. */
  balanceLeftPct?: number;
  /** Crank cadence in rpm (cycling). */
  cadenceRpm?: number;
  /** Wheel speed in m/s from a speed sensor. */
  speedMps?: number;
  /** What a CSC sensor sends (wheel, crank or both), known from its first frame; absent for other sensors. */
  cscMode?: CscMode;
  /** Foot pod: speed in m/s, step cadence and stride. */
  podSpeedMps?: number;
  podCadenceSpm?: number;
  podStrideM?: number;
}

interface Timed<T> {
  value: T;
  at: number;
  /** How long the value holds before it reads 0 (revolution counters only). */
  hold?: number;
}

/**
 * Holds the last reading of each channel for one recording and answers "what is the value at time t". Feed it `ValueEvent`s through
 * `ingest`; `read(now)` returns the channels that are still fresh. Wheel distance accumulates in `wheelDistanceM` (only revolutions the
 * sensor reported, so a gap does not invent distance). One tracker serves one workout; it is cheap to recreate.
 */
export class SensorTracker {
  private hr: Timed<number> | null = null;
  private contact: SensorContact = 'unsupported';
  private rr: number[] = [];
  private power: Timed<number> | null = null;
  /** The left pedal's share (percent) the power meter last reported, when it reports one. */
  private balance: Timed<number> | null = null;
  private cadence: Timed<number> | null = null;
  private speed: Timed<number> | null = null;
  private pod: Timed<{ speed: number; cadence: number; stride?: number }> | null = null;
  private prevCscWheel: RevolutionSample | null = null;
  private prevCscCrank: RevolutionSample | null = null;
  private prevPowerWheel: RevolutionSample | null = null;
  private prevPowerCrank: RevolutionSample | null = null;
  private lastEnergyKj: number | null = null;
  /** Metres from the wheel counter since this tracker started. */
  wheelDistanceM = 0;
  /** kJ the strap counted since this tracker started (counter resets are ignored, wraps handled), null while it sent none. */
  energyKj: number | null = null;
  /** Frames of any characteristic this tracker used, and the radio time (ms) of the last one: "data received" for a status line. */
  frames = 0;
  lastValueAt: number | null = null;
  private cscWheelSeen = false;
  private cscCrankSeen = false;

  /** What the CSC frames seen so far carry, null before the first one. */
  get cscMode(): CscMode | null {
    return cscModeOf(this.cscWheelSeen, this.cscCrankSeen);
  }

  constructor(private readonly wheelCircumferenceM: number) {}

  /** Returns true when the event carried a value this tracker uses. `ts` is the radio timestamp in ms. */
  ingest(characteristic: string, hex: string, ts: number): boolean {
    const used = this.apply(characteristic.toLowerCase(), hexToBytes(hex), ts);
    if (used) {
      this.frames += 1;
      this.lastValueAt = ts;
    }
    return used;
  }

  private apply(characteristic: string, bytes: Uint8Array, ts: number): boolean {
    switch (characteristic) {
      case '2a37': {
        const m = parseHeartRate(bytes);
        if (!m) return false;
        this.contact = m.contact;
        if (m.contact !== 'lost' && m.bpm > 0) this.hr = { value: m.bpm, at: ts };
        if (m.rrMs.length > 0) this.rr.push(...m.rrMs);
        if (m.energyKj !== undefined) this.addEnergy(m.energyKj);
        return true;
      }
      case '2a5b': {
        const m = parseCsc(bytes);
        if (!m) return false;
        if (m.wheel) {
          this.cscWheelSeen = true;
          this.wheelEvent(m.wheel, CSC_TICKS, ts, 'csc');
        }
        if (m.crank) {
          this.cscCrankSeen = true;
          this.crankEvent(m.crank, ts, 'csc');
        }
        return true;
      }
      case '2a63': {
        const m = parsePower(bytes);
        if (!m) return false;
        this.power = { value: Math.max(0, m.watts), at: ts };
        if (m.balancePct !== undefined) this.balance = { value: m.balancePct, at: ts };
        if (m.wheel) this.wheelEvent(m.wheel, POWER_WHEEL_TICKS, ts, 'power');
        if (m.crank) this.crankEvent(m.crank, ts, 'power');
        return true;
      }
      case '2a53': {
        const m = parseRsc(bytes);
        if (!m) return false;
        this.pod = { value: { speed: m.speedMps, cadence: m.cadenceSpm, stride: m.strideM }, at: ts };
        return true;
      }
      default:
        return false;
    }
  }

  private addEnergy(kj: number): void {
    if (this.lastEnergyKj !== null) {
      const d = counterDelta(this.lastEnergyKj, kj, 65536);
      // A strap that restarts its counter shows up as a huge forward jump; real energy per notification is a few kJ at most.
      if (d < 1000) this.energyKj = (this.energyKj ?? 0) + d;
    } else {
      this.energyKj = this.energyKj ?? 0;
    }
    this.lastEnergyKj = kj;
  }

  private wheelEvent(now: RevolutionSample, ticksPerSecond: number, ts: number, from: 'csc' | 'power'): void {
    const prev = from === 'csc' ? this.prevCscWheel : this.prevPowerWheel;
    if (from === 'csc') this.prevCscWheel = now;
    else this.prevPowerWheel = now;
    const step = revolutionStep(prev, now, { revsModulo: WHEEL_REVS_MODULO, ticksPerSecond });
    if (!step) return;
    const { speedMps, distanceM } = wheelSpeed(step, this.wheelCircumferenceM);
    // A counter that restarted (a sensor waking from sleep) looks like a lap of the whole counter in a second or two.
    if (speedMps > MAX_WHEEL_MPS) return;
    this.wheelDistanceM += distanceM;
    this.speed = { value: speedMps, at: ts, hold: holdMs(step.seconds) };
  }

  private crankEvent(now: RevolutionSample, ts: number, from: 'csc' | 'power'): void {
    const prev = from === 'csc' ? this.prevCscCrank : this.prevPowerCrank;
    if (from === 'csc') this.prevCscCrank = now;
    else this.prevPowerCrank = now;
    const step = revolutionStep(prev, now, { revsModulo: CRANK_REVS_MODULO, ticksPerSecond: CRANK_TICKS });
    if (!step) return;
    const rpm = cadenceRpm(step);
    if (rpm > MAX_CADENCE_RPM) return;
    this.cadence = { value: rpm, at: ts, hold: holdMs(step.seconds) };
  }

  /**
   * What the sensors say at `nowMs`. Heart rate and power are held for `VALUE_FRESH_MS`; speed and cadence from revolution counters read
   * 0 once their hold (`holdMs`: 3 s, longer for a slow crank) passes without a new event, because a stopped wheel or crank sends no new
   * event; they are absent only while the sensor has never sent a step.
   */
  read(nowMs: number): SensorReadings {
    const out: SensorReadings = {};
    if (this.hr && nowMs - this.hr.at <= VALUE_FRESH_MS) out.hr = this.hr.value;
    out.hrContact = this.contact;
    if (this.rr.length > 0) {
      out.rrMs = this.rr;
      this.rr = [];
    }
    if (this.power && nowMs - this.power.at <= VALUE_FRESH_MS) out.watts = this.power.value;
    if (this.balance && nowMs - this.balance.at <= VALUE_FRESH_MS) out.balanceLeftPct = this.balance.value;
    if (this.cadence) out.cadenceRpm = nowMs - this.cadence.at > (this.cadence.hold ?? COAST_TIMEOUT_MS) ? 0 : this.cadence.value;
    if (this.speed) out.speedMps = nowMs - this.speed.at > (this.speed.hold ?? COAST_TIMEOUT_MS) ? 0 : this.speed.value;
    const mode = this.cscMode;
    if (mode) out.cscMode = mode;
    if (this.pod && nowMs - this.pod.at <= VALUE_FRESH_MS) {
      out.podSpeedMps = this.pod.value.speed;
      out.podCadenceSpm = this.pod.value.cadence;
      if (this.pod.value.stride !== undefined) out.podStrideM = this.pod.value.stride;
    }
    return out;
  }
}

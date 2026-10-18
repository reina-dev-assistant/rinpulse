/** Pure Bluetooth GATT payload parsers (no DOM). All multi-byte fields are little-endian. */

const TICKS_PER_SECOND = 1024;

export function parseHeartRate(view: DataView): { hr: number; rr: number[] } {
  const rr: number[] = [];
  if (view.byteLength < 2) return { hr: 0, rr };
  const flags = view.getUint8(0);
  let offset = 1;
  let hr: number;
  if (flags & 0x01) {
    if (view.byteLength < 3) return { hr: 0, rr };
    hr = view.getUint16(offset, true);
    offset += 2;
  } else {
    hr = view.getUint8(offset);
    offset += 1;
  }
  if (flags & 0x08) offset += 2;
  if (flags & 0x10) {
    for (; offset + 2 <= view.byteLength; offset += 2) {
      rr.push((view.getUint16(offset, true) * 1000) / TICKS_PER_SECOND);
    }
  }
  return { hr, rr };
}

export type CscEvent = { revs: number; time: number };

export function parseCsc(view: DataView): { wheel?: CscEvent; crank?: CscEvent } {
  const out: { wheel?: CscEvent; crank?: CscEvent } = {};
  if (view.byteLength < 1) return out;
  const flags = view.getUint8(0);
  let offset = 1;
  if (flags & 0x01) {
    if (offset + 6 > view.byteLength) return out;
    out.wheel = { revs: view.getUint32(offset, true), time: view.getUint16(offset + 4, true) };
    offset += 6;
  }
  if (flags & 0x02) {
    if (offset + 4 > view.byteLength) return out;
    out.crank = { revs: view.getUint16(offset, true), time: view.getUint16(offset + 2, true) };
  }
  return out;
}

const STALE_MS = 2000;
const MAX_RPM = 250;

export class CadenceEstimator {
  private last: CscEvent | undefined;
  /** Caller timestamp (ms) of the last event that advanced the crank. */
  private lastAdvanceAt = 0;

  push(crank: CscEvent, now: number): number | undefined {
    const prev = this.last;
    if (!prev) {
      this.last = crank;
      this.lastAdvanceAt = now;
      return undefined;
    }
    if (crank.revs === prev.revs && crank.time === prev.time) return this.idle(now);

    const dRevs = (crank.revs - prev.revs) & 0xffff;
    const dTime = (crank.time - prev.time) & 0xffff;
    if (dRevs === 0) {
      this.last = crank;
      return 0;
    }
    if (dTime === 0) return undefined;
    const rpm = (dRevs * 60 * TICKS_PER_SECOND) / dTime;
    if (rpm > MAX_RPM) return undefined;
    this.last = crank;
    this.lastAdvanceAt = now;
    return rpm;
  }

  idle(now: number): number | undefined {
    if (this.last && now - this.lastAdvanceAt > STALE_MS) return 0;
    return undefined;
  }
}

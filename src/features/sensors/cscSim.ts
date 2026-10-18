/**
 * A Cycling Speed and Cadence sensor as the radio delivers it, for the sensor and recorder tests. Not used by the app.
 *
 * Modelled on what a XOSS Vortex does on a phone (captured from logcat, `BtGatt.GattService: onNotify handle=22, length=5`): the sensor
 * queues one notification per revolution and the radio hands them over at connection events (every 750 ms here), so two or three
 * frames often arrive in the same millisecond, and nothing arrives while the part is still.
 */
import { bytesToHex } from './gatt';

export interface CscFrame {
  /** Radio timestamp the phone stamps the notification with, ms. */
  ts: number;
  /** The raw characteristic value, lowercase hex. */
  hex: string;
}

export interface Rotation {
  /** Revolutions per minute while turning. */
  rpm: number;
  /** [fromMs, toMs) windows (relative to the stream start) in which the part does not turn. */
  stops?: readonly (readonly [number, number])[];
  /** The sensor's cumulative revolution counter and event clock (1/1024 s) at the start. */
  startRevs?: number;
  startTicks?: number;
}

export interface CscSimOptions {
  /** `cadence` frames carry crank revolutions only (flags 0x02), `speed` wheel only (0x01), `both` both (0x03). */
  mode: 'cadence' | 'speed' | 'both';
  /** The crank (cadence and both modes) and the wheel (speed and both modes). */
  crank?: Rotation;
  wheel?: Rotation;
  /** Epoch ms of the stream start; the first connection event is one interval later. */
  fromMs: number;
  toMs: number;
  /** Connection interval; notifications are delivered at multiples of it. */
  intervalMs?: number;
  /** [fromMs, toMs) windows relative to `fromMs` with the link down: nothing is delivered, the sensor keeps counting. */
  linkDown?: readonly (readonly [number, number])[];
}

interface Counter {
  revs: number;
  ticks: number;
}

interface Turn extends Counter {
  /** ms since the stream start. */
  at: number;
  part: 'crank' | 'wheel';
}

/** One entry per revolution of a part turning at `rotation.rpm` (not while stopped), each with the counters as they read after it. */
function turns(part: 'crank' | 'wheel', rotation: Rotation, spanMs: number): Turn[] {
  const out: Turn[] = [];
  const period = 60_000 / rotation.rpm;
  const revsModulo = part === 'wheel' ? 4294967296 : 65536;
  const startRevs = rotation.startRevs ?? 0;
  const startTicks = rotation.startTicks ?? 0;
  let moving = 0;
  let done = 0;
  for (let t = 1; t <= spanMs; t++) {
    if (rotation.stops?.some(([from, to]) => t >= from && t < to)) continue;
    moving += 1;
    if (moving >= period * (done + 1)) {
      done += 1;
      out.push({ part, at: t, revs: (startRevs + done) % revsModulo, ticks: (startTicks + Math.round((t / 1000) * 1024)) % 65536 });
    }
  }
  return out;
}

const u16 = (v: number): number[] => [v & 255, (v >>> 8) & 255];
const u32 = (v: number): number[] => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];

/** The notifications the phone receives, in arrival order. */
export function cscFrames(opts: CscSimOptions): CscFrame[] {
  const interval = opts.intervalMs ?? 750;
  const span = opts.toMs - opts.fromMs;
  const all = [
    ...(opts.mode !== 'speed' && opts.crank ? turns('crank', opts.crank, span) : []),
    ...(opts.mode !== 'cadence' && opts.wheel ? turns('wheel', opts.wheel, span) : []),
  ].sort((a, b) => a.at - b.at);

  const frames: CscFrame[] = [];
  let crank: Counter = { revs: opts.crank?.startRevs ?? 0, ticks: opts.crank?.startTicks ?? 0 };
  let wheel: Counter = { revs: opts.wheel?.startRevs ?? 0, ticks: opts.wheel?.startTicks ?? 0 };
  let next = 0;
  for (let c = interval; c <= span; c += interval) {
    const down = opts.linkDown?.some(([from, to]) => c >= from && c < to) ?? false;
    while (next < all.length && (all[next] as Turn).at <= c) {
      const turn = all[next] as Turn;
      next += 1;
      if (turn.part === 'crank') crank = turn;
      else wheel = turn;
      if (down) continue;
      const bytes: number[] = [opts.mode === 'cadence' ? 0x02 : opts.mode === 'speed' ? 0x01 : 0x03];
      if (opts.mode !== 'cadence') bytes.push(...u32(wheel.revs), ...u16(wheel.ticks));
      if (opts.mode !== 'speed') bytes.push(...u16(crank.revs), ...u16(crank.ticks));
      frames.push({ ts: opts.fromMs + c, hex: bytesToHex(new Uint8Array(bytes)) });
    }
  }
  return frames;
}

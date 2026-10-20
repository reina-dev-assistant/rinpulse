import { CounterDeduper, decodeThermometerAdvert, type ThermometerFrame, type ThermometerReading } from '@/features/sensors/thermometerAdvert';

import { SAMPLE_INTERVAL_MS, type EnvSample } from './store';

/** One advertisement as the sampler wants it (a scale-scan `AdFrame`, or a raw advert the overnight service kept). */
export interface ThermometerAdvert extends ThermometerFrame {
  /** Android: MAC address. iOS: peripheral UUID. */
  id: string;
  /** Epoch ms of the advertisement. */
  ts: number;
}

/** What `accept` knew about an advertisement of a paired sensor, whether or not it became a sample. */
export interface Accepted {
  sample: EnvSample;
  reading: ThermometerReading;
}

/** Ids compare as the radio reports them: Android MACs in either case, iOS UUIDs in either case. */
const key = (id: string): string => id.trim().toUpperCase();

/**
 * Turns advertisements into samples: only paired sensors, only readable frames, a repeat of the same counter is the same measurement,
 * and at most one sample per sensor per {@link SAMPLE_INTERVAL_MS}. Holds no I/O, so the throttle and the dedupe run under bun test; the
 * caller stores what `accept` returns (the database refuses anything the sampler's memory missed, see `insertEnvSample`).
 */
export class ThermometerSampler {
  /** Normalised id to the id as it was paired (what samples are stored under). */
  private paired = new Map<string, string>();
  private readonly counters = new CounterDeduper();
  private readonly lastTaken = new Map<string, number>();

  constructor(private readonly intervalMs: number = SAMPLE_INTERVAL_MS) {}

  /** The sensors to listen to. A sensor that left the set loses its memory, so pairing it again starts fresh. */
  setPaired(ids: readonly string[]): void {
    const next = new Map(ids.map((id) => [key(id), id]));
    for (const id of this.paired.keys()) {
      if (!next.has(id)) {
        this.counters.forget(id);
        this.lastTaken.delete(id);
      }
    }
    this.paired = next;
  }

  /** The time of the newest stored sample, so a restart does not take a second one within the interval. */
  seed(sensorId: string, ts: number): void {
    const id = key(sensorId);
    this.lastTaken.set(id, Math.max(ts, this.lastTaken.get(id) ?? 0));
  }

  /** Null for an advertisement that is no sample: not paired, unreadable, a repeat, or too soon after the last one. */
  accept(advert: ThermometerAdvert): Accepted | null {
    const id = key(advert.id);
    const sensorId = this.paired.get(id);
    if (sensorId === undefined) return null;
    const reading = decodeThermometerAdvert(advert);
    if (!reading || !this.counters.isNew(id, reading.counter)) return null;
    const last = this.lastTaken.get(id);
    if (last !== undefined && advert.ts >= last && advert.ts - last < this.intervalMs) return null;
    this.lastTaken.set(id, Math.max(advert.ts, last ?? 0));
    return {
      reading,
      sample: { sensorId, ts: advert.ts, tempC: reading.tempC, rhPct: reading.rhPct, batteryPct: reading.batteryPct },
    };
  }
}

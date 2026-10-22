import type { MiBeaconResult } from './miBeacon';
import { RH_MAX_PCT, RH_MIN_PCT, TEMP_MAX_C, TEMP_MIN_C, type ThermometerReading } from './thermometerAdvert';

/** A temperature and a humidity from separate frames make one reading only when they were heard this close together. */
export const PAIR_MAX_AGE_MS = 10 * 60_000;

interface Held {
  tempC: number | null;
  tempAt: number;
  rhPct: number | null;
  rhAt: number;
  batteryPct: number | null;
}

/**
 * Puts the one-object frames of the stock firmware together. The LYWSD03MMC sends temperature, humidity and battery in separate
 * advertisements; some units (and the 0x100D object) send both in one. `feed` keeps the latest of each per sensor and returns a reading
 * when a frame brought a temperature or a humidity and the other half is no older than {@link PAIR_MAX_AGE_MS}. Pure: time is the
 * advertisement's own, so an overnight batch is assembled the way a live stream would be.
 */
export class MiBeaconTracker {
  private readonly held = new Map<string, Held>();

  feed(sensorKey: string, frame: Extract<MiBeaconResult, { ok: true }>, ts: number): ThermometerReading | null {
    const { measure } = frame;
    const state = this.held.get(sensorKey) ?? { tempC: null, tempAt: 0, rhPct: null, rhAt: 0, batteryPct: null };
    this.held.set(sensorKey, state);
    if (measure.batteryPct !== undefined) state.batteryPct = measure.batteryPct;
    const fresh = measure.tempC !== undefined || measure.rhPct !== undefined;
    if (measure.tempC !== undefined) {
      state.tempC = measure.tempC;
      state.tempAt = ts;
    }
    if (measure.rhPct !== undefined) {
      state.rhPct = measure.rhPct;
      state.rhAt = ts;
    }
    if (!fresh || state.tempC === null || state.rhPct === null) return null;
    if (Math.abs(state.tempAt - state.rhAt) > PAIR_MAX_AGE_MS) return null;
    if (state.tempC < TEMP_MIN_C || state.tempC > TEMP_MAX_C || state.rhPct < RH_MIN_PCT || state.rhPct > RH_MAX_PCT) return null;
    return {
      format: 'mibeacon',
      mac: frame.mac,
      tempC: state.tempC,
      rhPct: state.rhPct,
      batteryPct: state.batteryPct,
      batteryMv: null,
      counter: frame.counter,
    };
  }

  forget(sensorKey: string): void {
    this.held.delete(sensorKey);
  }
}

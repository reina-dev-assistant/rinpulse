/**
 * Auto-lap: says when a lap should start by itself. The caller (the ride loop) asks once per second and, when the answer is true,
 * calls `recorder.lap` and `notifyLap(distance)`; a manual lap calls `notifyLap` too (or passes `lapNow` to `update`), so a distance
 * lap counts from the lap that really happened.
 *
 * - `distance`: every `everyM` of recorded distance since the last lap (or the start). A jump over several multiples (a GPS catch-up,
 *   a restored ride) fires once and re-arms at the next multiple after the distance, never a burst of laps.
 * - `start`: the first fix is the lap point. The engine arms once the rider is 200 m away from it and fires when back within 30 m;
 *   then it needs another 200 m away before it fires again, so a rider waiting at the start line gets one lap per loop.
 * - `off`: never.
 *
 * Pure: no clock, no React Native.
 */
import { haversineM } from '@/features/workouts/analysis/geo';

import type { AutoLapConfig } from '../types';

/** Distance from the start the rider must reach before a return counts as a loop. */
export const START_ARM_M = 200;
/** Distance from the start under which the rider is back at it. */
export const START_RETURN_M = 30;

export interface AutoLapInput {
  /** Recorded distance of the ride so far, metres. */
  distanceM: number;
  lat: number | null;
  lon: number | null;
  /** A manual lap is happening in this very update: counted as the lap, no automatic one is returned. */
  lapNow: boolean;
}

export class AutoLap {
  private readonly config: AutoLapConfig;
  /** Distance of the last lap (0 at the start) and the distance at which the next distance lap fires. */
  private originM = 0;
  private nextAtM: number;
  private start: { lat: number; lon: number } | null = null;
  private armed = false;

  constructor(config: AutoLapConfig) {
    this.config = config;
    this.nextAtM = config.mode === 'distance' && config.everyM > 0 ? config.everyM : Number.POSITIVE_INFINITY;
  }

  /** True when a lap should be triggered now. */
  update(input: AutoLapInput): boolean {
    if (input.lapNow) {
      this.notifyLap(input.distanceM);
      return false;
    }
    if (this.config.mode === 'distance') return this.updateDistance(input.distanceM);
    if (this.config.mode === 'start') return this.updateStart(input.lat, input.lon);
    return false;
  }

  /** A lap really happened at `distanceM` (automatic or manual): distance laps count from here. */
  notifyLap(distanceM: number): void {
    if (this.config.mode !== 'distance' || !(this.config.everyM > 0)) return;
    this.originM = distanceM;
    this.nextAtM = distanceM + this.config.everyM;
  }

  private updateDistance(distanceM: number): boolean {
    if (this.config.mode !== 'distance' || !(this.config.everyM > 0)) return false;
    // The distance went back (a restored ride that restarted its count): count from here.
    if (distanceM < this.originM) {
      this.notifyLap(distanceM);
      return false;
    }
    if (distanceM < this.nextAtM) return false;
    const every = this.config.everyM;
    this.nextAtM = this.originM + every * (Math.floor((distanceM - this.originM) / every) + 1);
    return true;
  }

  private updateStart(lat: number | null, lon: number | null): boolean {
    if (lat === null || lon === null) return false;
    if (this.start === null) {
      this.start = { lat, lon };
      return false;
    }
    const away = haversineM(this.start.lat, this.start.lon, lat, lon);
    if (!this.armed) {
      if (away >= START_ARM_M) this.armed = true;
      return false;
    }
    if (away > START_RETURN_M) return false;
    this.armed = false;
    return true;
  }
}

/**
 * Auto-pause: decides when the recorder should pause because the bike stopped and resume because it moves again.
 *
 * Pure: the instant comes in as an argument. Pause fires when the speed stayed under `stopBelowMps` for `stopAfterMs`; resume when it
 * stayed over `resumeAboveMps` for `resumeAfterMs`. The gap between the two speeds is a hysteresis band: while running a reading
 * in it counts as moving (no pause), while paused it counts as still stopped (no resume), so a rider rolling at 1.2 m/s does not flap.
 *
 * A reading of null is no information (GPS dropout between two fixes), not a stop. Once the last real reading is older than
 * `STALE_AFTER_MS` the bike is taken as stopped: a rider in a tunnel is not riding at the last speed forever.
 *
 * Only a pause this engine caused is resumed by it. A pause the rider made by hand stays until they resume. The engine learns who
 * paused from `notePaused`, and from `update`: a `recording: false` it never asked for is treated as manual. The engine keeps
 * "paused by auto" until it sees `recording` go from false to true, so a caller that applies the pause or the resume a call late
 * is fine.
 */
export interface AutoPauseConfig {
  /** Speed under which the bike counts as stopped, m/s (the ride analysis' `STOP_SPEED_MS`). */
  stopBelowMps: number;
  stopAfterMs: number;
  /** Speed over which the bike counts as moving again, m/s. */
  resumeAboveMps: number;
  resumeAfterMs: number;
}

export const DEFAULT_AUTO_PAUSE: AutoPauseConfig = {
  stopBelowMps: 1.0,
  stopAfterMs: 3000,
  resumeAboveMps: 1.5,
  resumeAfterMs: 1000,
};

/** Without a real speed reading for this long the bike is taken as stopped. */
const STALE_AFTER_MS = 5000;

export type AutoPauseAction = 'pause' | 'resume';

export class AutoPause {
  private readonly cfg: AutoPauseConfig;
  private lastReadingMs: number | null = null;
  private belowSinceMs: number | null = null;
  private aboveSinceMs: number | null = null;
  private pausedBy: 'auto' | 'manual' | null = null;
  private wasRecording: boolean | null = null;

  constructor(cfg: Partial<AutoPauseConfig> = {}) {
    this.cfg = { ...DEFAULT_AUTO_PAUSE, ...cfg };
  }

  /**
   * One speed reading. `recording` is whether the recorder is running now (false while paused). Returns the action the caller should
   * take on the recorder, or null.
   */
  update(speedMps: number | null, nowMs: number, recording: boolean): AutoPauseAction | null {
    const wasRecording = this.wasRecording;
    this.wasRecording = recording;
    // Running again after a pause (resumed by the rider or by us): whoever paused last is history.
    if (recording && wasRecording === false) this.pausedBy = null;

    if (speedMps !== null) this.lastReadingMs = nowMs;
    let speed = speedMps;
    if (speed === null) {
      // No reading yet: nothing to call stopped. A silence over the limit: stopped.
      if (this.lastReadingMs === null || nowMs - this.lastReadingMs <= STALE_AFTER_MS) return null;
      speed = 0;
    }

    if (recording) {
      this.aboveSinceMs = null;
      if (speed >= this.cfg.stopBelowMps) {
        this.belowSinceMs = null;
        return null;
      }
      this.belowSinceMs ??= nowMs;
      if (nowMs - this.belowSinceMs < this.cfg.stopAfterMs) return null;
      // The caller may not have paused yet on the next call; the timer restarts, so a failed pause is retried after another interval.
      this.belowSinceMs = null;
      this.pausedBy = 'auto';
      return 'pause';
    }

    // Paused. A pause nobody told us about is the rider's.
    this.belowSinceMs = null;
    if (this.pausedBy === null) this.pausedBy = 'manual';
    if (this.pausedBy !== 'auto') return null;
    if (speed <= this.cfg.resumeAboveMps) {
      this.aboveSinceMs = null;
      return null;
    }
    this.aboveSinceMs ??= nowMs;
    if (nowMs - this.aboveSinceMs < this.cfg.resumeAfterMs) return null;
    this.aboveSinceMs = null;
    return 'resume';
  }

  /** The recorder was paused by `by`. Call it for a manual pause (so it is never auto-resumed) and, if you like, for the auto one. */
  notePaused(by: 'auto' | 'manual'): void {
    this.pausedBy = by;
    this.belowSinceMs = null;
    this.aboveSinceMs = null;
  }

  /** Forget the pause, the timers and the last reading (a new ride). */
  reset(): void {
    this.pausedBy = null;
    this.belowSinceMs = null;
    this.aboveSinceMs = null;
    this.lastReadingMs = null;
    this.wasRecording = null;
  }
}

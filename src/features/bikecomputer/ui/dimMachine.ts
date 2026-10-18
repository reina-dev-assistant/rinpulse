/**
 * When the ride screen dims. A pure state machine: the caller passes the instant of every event (no clock in here) and asks how long
 * until the next dim to schedule one timer. The brightness itself is `brightness.ts`.
 */

export interface DimConfig {
  enabled: boolean;
  afterSec: number;
}

export interface DimState {
  dimmed: boolean;
  /** Epoch ms of the last touch, alert or start. */
  lastActiveMs: number;
}

export type DimEvent = { type: 'tick' | 'touch' | 'alert'; nowMs: number };

export function initDim(nowMs: number): DimState {
  return { dimmed: false, lastActiveMs: nowMs };
}

/**
 * Touch and alert wake the screen and restart the idle clock; a tick dims it once `afterSec` have passed without either. A disabled
 * machine never dims and wakes at once, so turning the setting off while dimmed restores the screen.
 */
export function stepDim(state: DimState, event: DimEvent, config: DimConfig): DimState {
  if (!config.enabled) return state.dimmed || event.type !== 'tick' ? { dimmed: false, lastActiveMs: event.nowMs } : state;
  if (event.type !== 'tick') return { dimmed: false, lastActiveMs: event.nowMs };
  if (!state.dimmed && event.nowMs - state.lastActiveMs >= config.afterSec * 1000) return { ...state, dimmed: true };
  return state;
}

/** Milliseconds from `nowMs` until the screen dims, null when it is dimmed already or dimming is off. Never negative. */
export function msUntilDim(state: DimState, config: DimConfig, nowMs: number): number | null {
  if (!config.enabled || state.dimmed) return null;
  return Math.max(0, state.lastActiveMs + config.afterSec * 1000 - nowMs);
}

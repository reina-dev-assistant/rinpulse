/**
 * What every data source (room, demo, direct Bluetooth) hands to the game. One shape, so the ride
 * session never knows where a number came from. A missing field means "no data", never zero.
 */
export type LiveSample = {
  /** Heart rate, bpm. */
  hr?: number;
  /** Crank cadence, rpm. 0 is a real reading (the rider stopped pedalling). */
  cad?: number;
  /** Measured power, watts. Only present with a real power meter; the game never fabricates it here. */
  pwr?: number;
  /** Date.now() when the game received it. */
  at: number;
};

export type SourceKind = "room" | "demo" | "ble";

/** Connection state of a source as the pair screen shows it. */
export type SourceState =
  | "idle"
  | "connecting"
  /** Transport up but the sensor side (phone, strap) is not sending yet. */
  | "waiting"
  | "live"
  | "lost"
  | "error";

export interface DataSource {
  readonly kind: SourceKind;
  state: SourceState;
  /** Human-readable detail for [state] (device names, error text); not translated. */
  detail?: string;
  start(): Promise<void>;
  stop(): void;
  /** Called for every sample; returns the unsubscribe function. */
  onSample(fn: (sample: LiveSample) => void): () => void;
  /** Called whenever [state] or [detail] changes; returns the unsubscribe function. */
  onState(fn: () => void): () => void;
}

/** A sample older than this is treated as "no data" by the ride session. */
export const STALE_MS = 3000;

/** Relay limits (docs/ride.md). The protocol's own sizes (2 KB frames, 6 digit codes, 10 minute codes, 3 hour idle) live in `src/features/ride/protocol.ts`. */

/** Web sockets one room accepts: the player and a few spectators. */
export const MAX_WEB_SOCKETS = 8;

/**
 * A socket's token bucket: `perSec` frames a second on average, `burst` at once. The phone sends about 4 samples a second; the game's
 * state frames are 1 a second.
 */
export const FRAME_RATE = {
  phone: { perSec: 12, burst: 30 },
  web: { perSec: 6, burst: 20 },
} as const;

/** A frame that is malformed, not allowed for the role or over the rate counts as a strike; the socket is closed (1008) at this many. */
export const STRIKES_BEFORE_CLOSE = 10;
/** Strikes are forgiven after this long without a new one. */
export const STRIKE_FORGIVE_MS = 10_000;

/** The room's last-activity time is written to storage at most this often (a write per sample would be 4 a second). */
export const ACTIVITY_PERSIST_MS = 5 * 60 * 1000;

/** Fixed-window limits of the REST routes: `max` calls per `windowMs`. */
export const LIMIT_CREATE_PER_IP = { max: 10, windowMs: 10 * 60 * 1000 } as const;
export const LIMIT_JOIN_PER_USER = { max: 10, windowMs: 5 * 60 * 1000 } as const;
export const LIMIT_JOIN_PER_IP = { max: 30, windowMs: 5 * 60 * 1000 } as const;
export const LIMIT_WS_PER_IP = { max: 120, windowMs: 10 * 60 * 1000 } as const;
export const LIMIT_RESULT_PER_IP = { max: 20, windowMs: 10 * 60 * 1000 } as const;
/** While a ride runs, the relay's sample count is written at most this often, so an evicted room keeps most of its evidence. */
export const EVIDENCE_PERSIST_MS = 30_000;

/** A fresh code that is already taken is drawn again this many times before the create call gives up with 503. */
export const CODE_DRAWS = 8;

/** Close codes (4000-4999 are the application's). */
export const CLOSE_REPLACED = 4001;
export const CLOSE_EXPIRED = 4002;
export const CLOSE_POLICY = 1008;

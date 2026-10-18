/** Why joining or staying in a ride room failed; the screen words each kind (`ride:error.<kind>`). */
export type RideErrorKind =
  | 'notSignedIn'
  | 'notConfigured'
  | 'notFound'
  | 'taken'
  | 'rateLimited'
  | 'network'
  | 'busy'
  | 'prepare'
  | 'replaced'
  | 'expired'
  | 'policy'
  | 'lost';

export interface RideError {
  kind: RideErrorKind;
  /** A detail for the log or a line under the message (English, not for translation), when there is one. */
  detail?: string;
}

/** What `RideDeps.join` rejects with. */
export class RideJoinError extends Error {
  constructor(
    readonly kind: RideErrorKind,
    detail?: string,
  ) {
    super(detail ?? kind);
  }
}

/** The error kind of an HTTP status from `POST /ride/rooms/join`. */
export function joinErrorKind(status: number): RideErrorKind {
  if (status === 401) return 'notSignedIn';
  if (status === 400 || status === 404) return 'notFound';
  if (status === 409) return 'taken';
  if (status === 429) return 'rateLimited';
  return 'network';
}

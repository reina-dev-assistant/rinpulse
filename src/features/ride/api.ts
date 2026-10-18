import { CloudHttpError, CloudNotConfiguredError, NotSignedInError, cloudRequest } from '@/cloud/api';
import { CLOUD_URL } from '@/cloud/config';

import { RideJoinError, joinErrorKind } from './errors';
import { wsPath, type JoinRoomResponse } from './protocol';

/**
 * Joins the ride room whose code the game shows. Needs the JoyoRogo session like every cloud call (the relay checks it, so only the
 * rider's own phone can be the phone of a room); free for every account, no Pro needed. Rejects with `RideJoinError`.
 */
export async function joinRoom(code: string): Promise<JoinRoomResponse> {
  try {
    // One try: a wrong code or a busy relay is for the person to see now, not to retry in the background.
    return await cloudRequest<JoinRoomResponse>('POST', '/ride/rooms/join', { code }, { retry: false });
  } catch (error) {
    if (error instanceof NotSignedInError) throw new RideJoinError('notSignedIn');
    if (error instanceof CloudNotConfiguredError) throw new RideJoinError('notConfigured');
    if (error instanceof CloudHttpError) throw new RideJoinError(joinErrorKind(error.status), error.code ?? undefined);
    throw new RideJoinError('network', error instanceof Error ? error.message : String(error));
  }
}

/** `wss://<relay>/ride/rooms/<roomId>/ws?role=phone&token=...` */
export function rideSocketUrl(roomId: string, token: string): string {
  return `${CLOUD_URL.replace(/^http/, 'ws')}${wsPath(roomId, 'phone', token)}`;
}

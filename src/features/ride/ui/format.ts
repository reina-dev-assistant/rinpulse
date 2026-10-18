import type { RidePhase, RideSnapshot } from '../session';

/** The digits of what was typed or pasted (a pasted link keeps its code), at most six. */
export function cleanCode(input: string): string {
  const fromLink = /[?&]code=(\d{6})(?!\d)/.exec(input);
  return (fromLink?.[1] ?? input.replace(/\D/g, '')).slice(0, 6);
}

export const isCompleteCode = (code: string): boolean => code.length === 6;

/** Key under `ride:status.` for the connection line. */
export function connectionKey(phase: RidePhase): 'connected' | 'connecting' | 'reconnecting' | 'lost' | 'ended' {
  switch (phase) {
    case 'connected':
      return 'connected';
    case 'reconnecting':
      return 'reconnecting';
    case 'lost':
      return 'lost';
    case 'ended':
      return 'ended';
    default:
      return 'connecting';
  }
}

/** True while the person is in a room (the room screen, not the join form). */
export const inRoom = (phase: RidePhase): boolean => phase !== 'idle' && phase !== 'ended';

/** Heart rate and cadence the phone reads right now: the parts of the sensor line, in that order. Empty when there is no data. */
export function sensorParts(snapshot: Pick<RideSnapshot, 'hr' | 'cad'>): { hr: number | null; cad: number | null } {
  return { hr: snapshot.hr === null ? null : Math.round(snapshot.hr), cad: snapshot.cad === null ? null : Math.round(snapshot.cad) };
}

/** Virtual figures of the game's state frame, rounded for the screen. Null before the game has sent one. */
export function gameFigures(game: RideSnapshot['game']): { speedKmh: number; distanceM: number; gradePct: number; gear: number; gearCount: number; powerW: number; route: string } | null {
  if (!game) return null;
  return { speedKmh: game.vKmh, distanceM: game.distM, gradePct: game.grade, gear: game.gear + 1, gearCount: game.gearCount, powerW: game.pwrEst, route: game.route };
}

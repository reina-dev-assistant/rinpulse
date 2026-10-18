/**
 * Battery saver of a ride: proposed at 20 % (the rider decides, and "later" is final for that ride), switched on at 10 % whatever the
 * rider said earlier, because a ride that dies at 5 % loses the recording's GPS with it. Pure.
 */

export const SAVER_PROPOSE_PCT = 20;
export const SAVER_FORCE_PCT = 10;

export interface SaverState {
  /** The saver is on: the map page is hidden, the screen dims sooner and deeper, sounds are off. */
  active: boolean;
  /** What the screen asks: nothing, a question (20 %), or a notice that it was switched on (10 %). */
  prompt: 'none' | 'propose' | 'forced';
  /** The rider answered the question with "later"; it is not asked again this ride. */
  declined: boolean;
}

export const SAVER_IDLE: SaverState = { active: false, prompt: 'none', declined: false };

/** The state after a battery reading. Charging never starts the saver; an active saver stays on until the ride ends. */
export function saverStep(state: SaverState, batteryPct: number | null, charging: boolean): SaverState {
  if (batteryPct === null || charging) return state;
  if (batteryPct <= SAVER_FORCE_PCT && !state.active) {
    return { active: true, prompt: 'forced', declined: state.declined };
  }
  if (batteryPct <= SAVER_PROPOSE_PCT && !state.active && !state.declined && state.prompt === 'none') {
    return { ...state, prompt: 'propose' };
  }
  return state;
}

export function saverAccept(state: SaverState): SaverState {
  return { ...state, active: true, prompt: 'none' };
}

/** "Nanti saja" at the question, or closing the notice. */
export function saverDismiss(state: SaverState): SaverState {
  return { ...state, prompt: 'none', declined: state.prompt === 'propose' ? true : state.declined };
}

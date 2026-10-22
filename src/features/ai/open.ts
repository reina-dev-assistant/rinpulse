import type { ByokAccess } from './access';
import type { AiSettings } from './settings';

/** What a "Tanya Joyo AI" shortcut hands to the chat: a workout (`ref` = `w:<start>`) or a night (`ref` = the local date the night ended on). */
export interface ChatSeed {
  seed: 'workout' | 'sleep';
  ref: string;
  /** A short human label for the first question (the workout and its date, or the night's date). */
  label: string;
}

/** Navigation options for every way into Joyo AI: `withAnchor` puts the history of chats under the chat when its stack is created by this call. */
export const OPEN_JOYO_AI = { withAnchor: true } as const;

export type JoyoAiDestination =
  | { pathname: '/joyo/chat'; params?: Record<string, string> }
  | { pathname: '/settings/ai-setup' }
  | { pathname: '/settings/ai' };

/** The pieces of state a shortcut needs; `access` is null while the age is still being read. */
export interface OpenState {
  settings: Pick<AiSettings, 'engine' | 'provider'>;
  access: ByokAccess | null;
  /** `useCoachAccess()`: only `pro` can use the hosted engine. */
  coachAccess: 'checking' | 'signedOut' | 'free' | 'pro';
}

/**
 * Where a shortcut leads. The chat when there is an engine to answer (the own key is ready and chosen, or the hosted engine and a Pro
 * account); the setup screen when nothing is set up; the Joyo AI settings when an own key is ready but the hosted engine is the one
 * chosen and the account is not Pro, so the person can switch engine instead of meeting a paywall. While the state is still being read
 * the chat opens, and it shows its own checking state.
 */
export function joyoAiDestination(state: OpenState, seed?: ChatSeed): JoyoAiDestination {
  const { settings, access, coachAccess } = state;
  const ownReady = access?.ok === true;
  const hostedReady = coachAccess === 'pro';
  const chat: JoyoAiDestination = { pathname: '/joyo/chat', ...(seed ? { params: { seed: seed.seed, ref: seed.ref, label: seed.label } } : {}) };
  if (access === null || coachAccess === 'checking') return chat;
  if (settings.engine === 'byok') return ownReady ? chat : hostedReady ? chat : { pathname: '/settings/ai-setup' };
  if (hostedReady) return chat;
  return ownReady ? { pathname: '/settings/ai' } : { pathname: '/settings/ai-setup' };
}

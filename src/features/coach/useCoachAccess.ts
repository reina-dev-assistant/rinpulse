import Storage from 'expo-sqlite/kv-store';

import { useCloud } from '@/state/CloudProvider';

/**
 * Who may use Coach: JoyoRogo Pro accounts. `checking` while the session or the account's Pro state is still being read;
 * the last known answer is kept on the phone so a Pro user who is offline is not locked out.
 *
 * This answers the *account* question only, and it is also what the Joyo AI hub reads to know whether the hosted
 * engine is available — so local-only mode must not make it say `pro` here, or the AI screen would claim a
 * JoyoRogo subscription that does not exist. Coach itself is unlocked separately, in its own screens
 * (`ui/CoachGate.tsx`, `ui/CoachTodayCard.tsx`): its plan, suggestions, progress and rule-based feedback are all
 * computed on this phone, so with no account there is nothing to unlock.
 */
export type CoachAccess = 'checking' | 'signedOut' | 'free' | 'pro';

const KEY = 'joyofit.coach.pro';

/**
 * What Coach draws, from the account's access and the local-only flag. Pure so it can be tested: getting this
 * wrong either locks a person out of a phone-local feature or claims a subscription they do not have.
 *
 * - `show`: the plan, the suggestions and the progress.
 * - `checking`: still reading the account, draw a skeleton.
 * - `signIn`: a signed-out account is asked to sign in.
 * - `upgrade`: a free account sees the Pro upsell.
 */
export type CoachVisibility = 'show' | 'checking' | 'signIn' | 'upgrade';

export function coachVisibility(access: CoachAccess, localOnly: boolean): CoachVisibility {
  // No account exists to check, and Coach runs on this phone: nothing is being unlocked behind a paywall.
  if (localOnly) return 'show';
  if (access === 'checking') return 'checking';
  if (access === 'signedOut') return 'signIn';
  if (access === 'free') return 'upgrade';
  return 'show';
}

export function useCoachAccess(): CoachAccess {
  const cloud = useCloud();
  if (cloud.sessionPending) return 'checking';
  if (!cloud.signedIn) return 'signedOut';
  if (cloud.cloudWorkouts !== null) {
    const unlocked = cloud.cloudWorkouts.unlocked;
    const known = Storage.getItemSync(KEY) === '1';
    if (unlocked !== known) Storage.setItemSync(KEY, unlocked ? '1' : '0');
    return unlocked ? 'pro' : 'free';
  }
  if (cloud.locked) return 'free';
  return Storage.getItemSync(KEY) === '1' ? 'pro' : 'checking';
}

import Storage from 'expo-sqlite/kv-store';

import { localCoachEnabled } from '@/features/coach/localSettings';
import { useCloud } from '@/state/CloudProvider';

/**
 * Who may use Coach: JoyoRogo Pro accounts, or anyone at all when the account-free mode is on.
 *
 * `checking` while the session or the account's Pro state is still being read; the last known answer is kept
 * on the phone so a Pro user who is offline is not locked out. With `localCoachEnabled` the plan, suggestion
 * and library need no account, so the read is skipped entirely and 'local' is returned.
 */
export type CoachAccess = 'checking' | 'signedOut' | 'free' | 'pro' | 'local';

const KEY = 'joyofit.coach.pro';

export function useCoachAccess(): CoachAccess {
  const cloud = useCloud();
  // The account is not consulted at all in this mode: nothing about the plan depends on the server.
  if (localCoachEnabled()) return 'local';
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

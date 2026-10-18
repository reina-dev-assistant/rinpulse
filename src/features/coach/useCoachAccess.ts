import Storage from 'expo-sqlite/kv-store';

import { useCloud } from '@/state/CloudProvider';

/**
 * Who may use Coach: JoyoRogo Pro accounts. `checking` while the session or the account's Pro state is still being read;
 * the last known answer is kept on the phone so a Pro user who is offline is not locked out.
 */
export type CoachAccess = 'checking' | 'signedOut' | 'free' | 'pro';

const KEY = 'joyofit.coach.pro';

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

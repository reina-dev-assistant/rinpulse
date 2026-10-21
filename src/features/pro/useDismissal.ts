import Storage from 'expo-sqlite/kv-store';
import { useCallback, useState } from 'react';

import { dismissalExpired, type ProMoment } from '@/features/pro/offer';

const key = (moment: ProMoment) => `joyofit.pro.dismissed.${moment}`;

function isHidden(moment: ProMoment): boolean {
  const raw = Storage.getItemSync(key(moment));
  return !dismissalExpired(raw === null ? null : Number(raw), Date.now());
}

/** "Nanti" on an inline card: hidden on this phone for `DISMISS_MS`, then it shows again. Read once when the card mounts. */
export function useDismissal(moment: ProMoment): { hidden: boolean; dismiss: () => void } {
  const [hidden, setHidden] = useState(() => isHidden(moment));
  const dismiss = useCallback(() => {
    Storage.setItemSync(key(moment), String(Date.now()));
    setHidden(true);
  }, [moment]);
  return { hidden, dismiss };
}

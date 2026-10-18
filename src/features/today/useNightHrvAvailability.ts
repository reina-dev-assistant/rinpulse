import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { countNightHrvSince, listSleepSince } from '@/db/queries';
import { rememberedWatch } from '@/features/device/rememberedWatch';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import {
  countNightsSince,
  nightHrvAvailability,
  type NightHrvAvailability,
  type NightHrvInput,
} from '@/features/today/nightHrv';
import { HISTORY_DAYS } from '@/features/today/useTodayData';
import { useLocale } from '@/i18n';
import { HuaweiWear } from '@/wear';

/** A night that ends just after the calibration started before it. */
const NIGHT_LOOKBACK_SEC = 12 * 3600;

/**
 * Whether night HRV is arriving, null until the first read. Re-read when stored data changes (`dataVersion`, after a
 * sync) and whenever the screen gains focus or the app returns to the foreground, which is when the stress switch or
 * the watch's supported commands may have changed.
 */
export function useNightHrvAvailability(dataVersion: number): NightHrvAvailability | null {
  const db = useSQLiteContext();
  // The inputs, not the result: the result holds translated text, so it is derived on render and follows a language switch.
  const [input, setInput] = useState<NightHrvInput | null>(null);
  const locale = useLocale();
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const request = ++latest.current;
    const status = HuaweiWear.getStressStatus();
    const nowSec = Math.floor(Date.now() / 1000);
    const windowStart = nowSec - (HISTORY_DAYS + 1) * 86400;
    const setupStart = status.lastCalibratedAt ?? windowStart;
    Promise.all([
      countNightHrvSince(db, windowStart),
      countNightHrvSince(db, setupStart),
      listSleepSince(db, setupStart - NIGHT_LOOKBACK_SEC),
      rememberedWatch(db),
    ]).then(
      ([inWindow, sinceSetup, sleep, hasWatch]) => {
        if (request !== latest.current) return;
        setInput({
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
          knownSupported: status.knownSupported,
          enabled: status.enabled,
          calibratedAt: status.lastCalibratedAt,
          nightsSinceSetup: countNightsSince(sleep, [], status.lastCalibratedAt ?? windowStart),
          nightRowsSinceSetup: sinceSetup,
          anyNightRowInHistory: inWindow > 0,
          noWatch: !hasWatch,
        });
      },
      // Without the counts the old text is shown, which is what happened before this hook existed.
      () => {
        if (request === latest.current) setInput(null);
      },
    );
  }, [db]);

  useNativeRefresh(refresh);
  useEffect(() => {
    refresh();
  }, [refresh, dataVersion]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (input ? nightHrvAvailability(input) : null), [input, locale]);
}

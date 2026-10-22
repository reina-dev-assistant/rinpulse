import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, PermissionsAndroid, Platform } from 'react-native';

import { Notice } from '@/components/States';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { useWatch } from '@/state/WatchProvider';

const FINE = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;

/**
 * Android, a watch is paired, precise location is not allowed: the phone cannot lend the watch its GPS position, which is what shortens the first fix
 * of an outdoor run (the watch has no satellite data from JoyoFit, see docs/agps.md). The one-time explanation on first launch is easy to dismiss, so
 * this stays on the Watch tab until the permission is given. Asks once; after "don't ask again" it opens the app's settings instead.
 */
export function GpsAssistNotice() {
  const { t } = useTranslation('watch');
  const linked = useWatch().device !== null;
  const [granted, setGranted] = useState<boolean | null>(null);
  const [blocked, setBlocked] = useState(false);

  const check = useCallback(() => {
    if (Platform.OS !== 'android') return;
    void PermissionsAndroid.check(FINE).then(setGranted);
  }, []);
  useNativeRefresh(check);

  if (Platform.OS !== 'android' || !linked || granted !== false) return null;

  const allow = async () => {
    if (blocked) {
      void Linking.openSettings();
      return;
    }
    const result = await PermissionsAndroid.request(FINE);
    setGranted(result === PermissionsAndroid.RESULTS.GRANTED);
    setBlocked(result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
  };

  return (
    <Notice icon="locate" action={{ label: blocked ? t('gpsAssist.openSettings') : t('gpsAssist.allow'), onPress: () => void allow() }}>
      {t('gpsAssist.body')}
    </Notice>
  );
}

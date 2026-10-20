import { router } from 'expo-router';
import { useCallback, useState } from 'react';

import { CollapsibleNotice } from '@/components/CollapsibleNotice';
import { noStagesHint } from '@/features/sleep/noStagesHint';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { useTranslation } from '@/i18n';
import { HuaweiWear } from '@/wear';

/**
 * Shown where a night has no stages, collapsed to one row until opened: says so and, when the TruSleep switch could change it, points to it in
 * Settings. Reads the switch and what the connected watch supports; both refresh when the screen regains focus.
 */
export function NoStagesNotice() {
  const { t } = useTranslation('health');
  const [sensors, setSensors] = useState(() => HuaweiWear.getHealthSensors());
  useNativeRefresh(useCallback(() => setSensors(HuaweiWear.getHealthSensors()), []));

  const hint = noStagesHint(sensors);
  return (
    <CollapsibleNotice
      id="sleep.noStages"
      title={t('noStages.title')}
      action={hint.openSettings ? { label: t('noStages.openSetting'), onPress: () => router.push('/settings/sync') } : undefined}>
      {hint.text}
    </CollapsibleNotice>
  );
}

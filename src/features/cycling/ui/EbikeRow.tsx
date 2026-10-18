import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SwitchRow } from '@/components/SwitchRow';

import { isEbike, setEbike } from '../settings';

/** Marks a ride as an e-bike ride (kept on this device, used for the Strava activity type). */
export function EbikeRow({ workoutStart }: { workoutStart: number }) {
  const { t } = useTranslation('cycling');
  const [on, setOn] = useState(() => isEbike(workoutStart));
  return (
    <SwitchRow
      icon="flash-outline"
      label={t('ebike.label')}
      hint={t('ebike.hint')}
      value={on}
      onValueChange={(value) => {
        setEbike(workoutStart, value);
        setOn(value);
      }}
    />
  );
}

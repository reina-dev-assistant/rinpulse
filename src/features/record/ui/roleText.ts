import { useTranslation } from 'react-i18next';

import type { SensorKind } from '@/features/sensors/gatt';
import { kindChannels } from '@/features/sensors/store';

/** "Heart rate, cadence": the roles a sensor plays, in the language of the app. */
export function useRoleText(): (kinds: readonly SensorKind[]) => string {
  const { t } = useTranslation('workouts');
  return (kinds) => kindChannels(kinds).map((channel) => t(`record.sensor.role.${channel}`)).join(', ');
}

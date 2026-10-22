import { t } from '@/i18n';

import { ZONE_NAME_KEYS, type HrZoneMethod } from './zones';

/** The name of heart-rate zone `zone` (1-based) in Huawei Health's words for `method`; empty for a zone the method does not have. */
export function hrZoneName(method: HrZoneMethod, zone: number): string {
  const key = ZONE_NAME_KEYS[method][zone - 1];
  return key ? t(`settings:hrZones.zones.names.${key}`) : '';
}

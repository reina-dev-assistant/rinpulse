import { useTranslation } from 'react-i18next';

import { fmtInt } from '@/i18n';
import { useColors } from '@/theme';

import type { GpsChipKind } from './format';
import type { PillSegment } from './StatusPill';

interface GpsFix {
  accuracyM: number | null;
}

/** The GPS segment of the status pill: the signal in a few characters, the full sentence for screen readers. */
export function useGpsSegment(kind: GpsChipKind, fix: GpsFix | null): PillSegment {
  const { t } = useTranslation('workouts');
  const colors = useColors();
  const meters = fix?.accuracyM == null ? null : fmtInt(fix.accuracyM);
  const ready = kind === 'ready';

  const label = {
    off: t('record.setup.chip.gpsOff'),
    permission: t('record.setup.chip.gpsPermission'),
    searching: t('record.setup.chip.gpsSearching'),
    weak: t('record.setup.chip.gpsWeak'),
    fair: meters === null ? t('record.gps.readyNoAccuracy') : t('record.setup.chip.gpsMeters', { meters }),
    ready: meters === null ? t('record.gps.readyNoAccuracy') : t('record.setup.chip.gpsMeters', { meters }),
  }[kind];
  const a11yLabel = {
    off: t('record.setup.noGpsNote'),
    permission: t('record.permission.location.title'),
    searching: t('record.gps.searching'),
    weak: t('record.gps.weak', { meters }),
    fair: t('record.gps.fair', { meters }),
    ready: meters === null ? t('record.gps.readyNoAccuracy') : t('record.gps.ready', { meters }),
  }[kind];

  return {
    key: 'gps',
    label,
    a11yLabel,
    lead: { kind: 'dot', color: ready ? colors.link : kind === 'off' ? colors.mutedForeground : colors.warning, on: ready, pulse: ready },
    quiet: kind === 'off',
    live: true,
  };
}

/** The sensors segment: how many paired sensors connect when the recording starts; a button to the sensors page when `onPress` is given. */
export function useSensorsSegment(count: number, onPress?: () => void): PillSegment {
  const { t } = useTranslation('workouts');
  return {
    key: 'sensors',
    label: count > 0 ? t('record.setup.chip.sensors', { count }) : t('record.setup.sensors'),
    a11yLabel: count > 0 ? t('record.setup.chip.sensorsA11y', { count }) : t('record.setup.chip.sensorsNoneA11y'),
    lead: { kind: 'icon', icon: 'bluetooth' },
    quiet: count === 0,
    onPress,
  };
}

/** The phone step counter segment: a solid dot while it is allowed, hollow while it is not; a button that opens its explanation. */
export function useStepsSegment(allowed: boolean, onPress: () => void): PillSegment {
  const { t } = useTranslation('workouts');
  const colors = useColors();
  return {
    key: 'steps',
    label: t('record.setup.chip.steps'),
    a11yLabel: allowed ? t('record.setup.chip.stepsOnA11y') : t('record.setup.chip.stepsOffA11y'),
    lead: { kind: 'dot', color: allowed ? colors.link : colors.warning, on: allowed },
    quiet: !allowed,
    onPress,
  };
}

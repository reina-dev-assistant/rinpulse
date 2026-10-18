import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { fmtDecimal } from '@/i18n';
import { useRecorder } from '@/state/RecorderProvider';

import { estimateBattery, saverProfile, type BatteryProfile } from '../ride/batteryEstimate';
import { loadBatteryHistory } from '../ride/batteryStore';
import { useBikeRide } from '../useBikeRide';
import { useBikeLayout, useBikeSettings } from '../ui/useBikeSettings';
import { useChosenRoute } from './useChosenRoute';

/** What a rider is assumed to average when a route sets the planned duration, m/s (22 km/h). Only used for the battery warning. */
export const PLANNED_SPEED_MPS = 22 / 3.6;

/** The Ready screen's block for a bike-mode ride: the chosen route and how long the battery lasts for this setup. */
export function BikeReadyPanel() {
  const { t } = useTranslation('bikecomp');
  const { snapshot } = useRecorder();
  const settings = useBikeSettings();
  const layout = useBikeLayout();
  const { batteryPct } = useBikeRide();
  const { card } = useChosenRoute();
  const history = useMemo(() => loadBatteryHistory(), []);

  const profile: BatteryProfile = {
    screen: settings.dim ? 'dim' : 'bright',
    map: layout.pages.some((p) => p.kind === 'map'),
    sensors: snapshot.sensorIds.length,
    liveShare: settings.liveShare,
    gps: true,
  };
  const plannedSec = card ? card.route.distanceM / PLANNED_SPEED_MPS : null;
  const estimate = batteryPct === null ? null : estimateBattery({ batteryPct, charging: false, profile, plannedSec, history });
  const saver = batteryPct === null ? null : estimateBattery({ batteryPct, charging: false, profile: saverProfile(profile), plannedSec, history });

  return (
    <Section title={t('ready.battery.title')} icon="battery-half" tint="workouts">
      <AppText variant="bodyStrong">
        {estimate ? t('ready.battery.estimate', { hours: fmtDecimal(estimate.hoursLeft, 1), pct: fmtDecimal(estimate.pctPerHour, 1) }) : t('ready.battery.unknown')}
      </AppText>
      {estimate && plannedSec !== null && estimate.warn !== 'none' ? (
        <Notice tone={estimate.warn === 'short' ? 'danger' : 'info'} icon="battery-dead">
          {t(estimate.warn === 'short' ? 'ready.battery.short' : 'ready.battery.tight', {
            need: fmtDecimal(plannedSec / 3600, 1),
            have: fmtDecimal(estimate.hoursLeft, 1),
          })}
        </Notice>
      ) : null}
      {estimate && saver && estimate.warn !== 'none' && saver.hoursLeft > estimate.hoursLeft ? (
        <AppText variant="caption" muted>
          {t('ready.battery.saverHint')}
        </AppText>
      ) : null}
    </Section>
  );
}

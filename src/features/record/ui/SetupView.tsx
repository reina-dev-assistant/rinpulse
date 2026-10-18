import { useRouter } from 'expo-router';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ChipRow } from '@/components/ChipRow';
import { Divider, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SensorLinkRow } from '@/features/sensors/ui/SensorLinkRow';
import { sportLabel } from '@/features/workouts/sportLabel';
import { MANUAL_SPORTS, SPORT_ROWS, type ManualSport } from '@/features/workouts/manual';
import { BikeSetupPanel } from '@/features/bikecomputer/record/BikeSetupPanel';
import { errorMessage } from '@/format';
import { useRecorder } from '@/state/RecorderProvider';
import { useSensors } from '@/state/SensorsProvider';
import { spacing } from '@/theme';

import { canPrepare, permissionPlan } from './format';
import { GpsLine } from './GpsLine';
import { PermissionCards, useRecordPermissions } from './PermissionGate';
import { useGpsWarmUp } from './useGpsWarmUp';

const LOCATION_DENIED = 'ERR_LOCATION_PERMISSION';

interface SetupViewProps {
  sport: ManualSport;
  onSport: (sport: ManualSport) => void;
  /** Something the last recording left to say (nothing was recorded). */
  notice: string | null;
}

/** Phase `idle`: pick the sport, see which sensors will connect, allow what the sport needs, then "Mulai" gets the recording ready. */
export function SetupView({ sport, onSport, notice }: SetupViewProps) {
  const { t } = useTranslation('workouts');
  const { t: tRide } = useTranslation('ride');
  const router = useRouter();
  const { prepare, snapshot } = useRecorder();
  const { saved, hub } = useSensors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const autoSensors = saved.filter((s) => s.autoConnect);
  const plan = permissionPlan(sport, autoSensors.length);
  const permissions = useRecordPermissions(plan, hub.bluetooth);
  const allowed = canPrepare(plan, permissions.location, permissions.bluetooth);
  // The GPS starts looking while the sport and the sensors are still being picked, not after "Mulai".
  const warming = plan.location && permissions.location === 'granted';
  useGpsWarmUp(sport, warming);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await prepare(sport, sportLabel(SPORT_ROWS[sport].name));
    } catch (e) {
      // The permission was taken back since the screen read it: its notice and question come back.
      if ((e as { code?: unknown } | null)?.code === LOCATION_DENIED) permissions.locationRefused();
      else setError(t('record.setup.prepareError', { error: errorMessage(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ChipRow
        items={MANUAL_SPORTS.map((s) => ({
          key: s,
          label: sportLabel(SPORT_ROWS[s].name),
          selected: sport === s,
          role: 'radio' as const,
          onPress: () => onSport(s),
        }))}
      />
      <AppText variant="caption" muted>
        {plan.location ? t('record.setup.gpsNote') : t('record.setup.noGpsNote')}
      </AppText>
      {warming ? <GpsLine fix={snapshot.fix} /> : null}
      {notice ? <Notice icon="information-circle">{notice}</Notice> : null}

      {sport === 'ride' ? <BikeSetupPanel /> : null}

      <Section title={t('record.setup.sensors')} icon="bluetooth" tint="link">
        {autoSensors.length > 0 ? (
          autoSensors.map((sensor, index) => (
            <Fragment key={sensor.id}>
              {index > 0 ? <Divider /> : null}
              <SensorLinkRow sensor={sensor} willConnect />
            </Fragment>
          ))
        ) : (
          <AppText variant="caption" muted>
            {t('record.setup.noSensors')}
          </AppText>
        )}
        {autoSensors.length > 0 && hub.bluetooth === 'off' ? <Notice icon="bluetooth">{t('record.setup.bluetoothOff')}</Notice> : null}
        <Button label={t('record.setup.manageSensors')} icon="settings-outline" onPress={() => router.push('/watch/sensors')} />
      </Section>

      {sport === 'indoorRide' ? (
        <Section title={tRide('entry.title')} icon="laptop-outline" tint="link">
          <AppText variant="caption" muted>
            {tRide('entry.hint')}
          </AppText>
          <Button label={tRide('entry.action')} icon="laptop-outline" onPress={() => router.push('/ride')} />
        </Section>
      ) : null}

      <PermissionCards permissions={permissions} plan={plan} />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={t('record.setup.start')} variant="primary" icon="play" disabled={!allowed} loading={busy} style={styles.start} onPress={() => void start()} />
    </>
  );
}

const styles = StyleSheet.create({
  start: { minHeight: 56, marginTop: spacing.xs },
});

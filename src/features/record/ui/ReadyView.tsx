import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Divider, Section } from '@/components/Screen';
import { SportIcon } from '@/components/SportIcon';
import { Notice } from '@/components/States';
import { BikeReadyPanel } from '@/features/bikecomputer/record/BikeReadyPanel';
import { useBikeSettings } from '@/features/bikecomputer/ui/useBikeSettings';
import { SensorLinkRow } from '@/features/sensors/ui/SensorLinkRow';
import { sportIcon } from '@/features/workouts/sportIcon';
import { SPORT_ROWS } from '@/features/workouts/manual';
import { sportLabel } from '@/features/workouts/sportLabel';
import { useRecorder } from '@/state/RecorderProvider';
import { useSensors } from '@/state/SensorsProvider';
import { spacing, useColors } from '@/theme';

import { FOOT_SPORTS } from '../recorder';
import { gpsStatus, sensorErrorKind } from './format';
import { GpsLine } from './GpsLine';
import { IndoorBackdrop, MapBackdrop } from './RecordBackdrop';
import { RecordStage } from './RecordStage';
import { StartButton } from './StartButton';
import { StatPreview } from './StatPreview';
import { useGpsSegment, useSensorsSegment } from './statusSegments';

/** The share of the screen height the sensors and notices may take before they scroll; the start button never leaves the screen. */
const EXTRAS_MAX_SHARE = 0.34;

/**
 * Phase `ready`: the native session runs, GPS and sensors are connecting. The same stage as the picker, now with the chosen sport:
 * "Mulai" starts the clock, "Batal" leaves without a recording.
 */
export function ReadyView({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('workouts');
  const colors = useColors();
  const { height } = useWindowDimensions();
  const { snapshot, start, cancel } = useRecorder();
  const { saved } = useSensors();
  const bike = useBikeSettings();
  const { sport } = snapshot;
  const sensors = snapshot.sensorIds.flatMap((id) => saved.find((s) => s.id === id) ?? []);
  const sensorError = snapshot.sensorError === null ? null : sensorErrorKind(snapshot.sensorError);

  const status = snapshot.gps ? gpsStatus(snapshot.fix) : 'off';
  const gps = useGpsSegment(status, snapshot.fix);
  const sensorsSegment = useSensorsSegment(snapshot.sensorIds.length);

  if (!sport) return null;

  return (
    <RecordStage
      onBack={onBack}
      segments={[gps, sensorsSegment]}
      backdrop={snapshot.gps ? <MapBackdrop position={snapshot.position} location="granted" /> : <IndoorBackdrop sport={sport} />}>
      <View style={styles.head}>
        <SportIcon name={sportIcon(SPORT_ROWS[sport].name)} size={24} color={colors.foreground} />
        <AppText variant="heading" accessibilityRole="header" style={styles.title}>
          {sportLabel(SPORT_ROWS[sport].name)}
        </AppText>
      </View>

      <ScrollView
        style={[styles.extras, { maxHeight: height * EXTRAS_MAX_SHARE }]}
        contentContainerStyle={styles.extrasContent}
        showsVerticalScrollIndicator={false}>
        <AppText variant="caption" muted>
          {snapshot.gps ? t('record.ready.hint') : t('record.ready.hintNoGps')}
        </AppText>
        {status === 'weak' || status === 'fair' ? <GpsLine fix={snapshot.fix} /> : null}

        {sport === 'ride' && bike.enabled ? <BikeReadyPanel /> : null}

        {sensors.length > 0 ? (
          <Section title={t('record.setup.sensors')} icon="bluetooth" tint="link">
            {sensors.map((sensor, index) => (
              <Fragment key={sensor.id}>
                {index > 0 ? <Divider /> : null}
                <SensorLinkRow sensor={sensor} managed />
              </Fragment>
            ))}
          </Section>
        ) : null}

        {sensorError !== null ? (
          <Notice
            tone={sensorError === 'other' ? 'info' : 'danger'}
            icon="bluetooth"
            action={sensorError === 'permission' ? { label: t('record.permission.openSettings'), onPress: () => void Linking.openSettings() } : undefined}>
            {t(`record.sensorError.${sensorError}`)}
          </Notice>
        ) : null}
        {snapshot.noService ? (
          <Notice icon="battery-half" action={{ label: t('record.permission.openSettings'), onPress: () => void Linking.openSettings() }}>
            {t('record.ready.noService')}
          </Notice>
        ) : null}

        {FOOT_SPORTS.includes(sport) && !snapshot.phoneSteps ? <Notice icon="footsteps-outline">{t('record.ready.noPhoneSteps')}</Notice> : null}
      </ScrollView>

      {snapshot.gps ? <StatPreview sport={sport} layout="row" /> : null}
      <StartButton label={t('record.ready.start')} onPress={start} />
      <Button label={t('record.ready.cancel')} onPress={() => void cancel()} />
    </RecordStage>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1 },
  extras: { flexGrow: 0 },
  extrasContent: { gap: spacing.md },
});

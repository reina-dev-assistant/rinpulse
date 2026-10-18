import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { Notice } from '@/components/States';
import { useNow } from '@/hooks/useNow';
import { useSensors } from '@/state/SensorsProvider';
import { spacing } from '@/theme';

import type { Granted } from '../permissions';
import { sensorStatus } from '../linkStatus';
import { sensorLabel, type SavedSensor } from '../store';
import { batteryLabel, errorCode, kindsLabel, linkHint, modeLabel, radioProblem, readingLine, sensorIcon, type RadioFailure } from './format';
import { SensorStatusLine } from './SensorStatusLine';

interface SensorLinkRowProps {
  sensor: SavedSensor;
  /**
   * A recording runs this sensor: its link is kept up for the whole session, so there is no "Putuskan", only "Sambungkan" for the
   * moment it is down.
   */
  managed?: boolean;
  /** Before "Mulai": a sensor that is not connected yet says it connects by itself when the workout starts. */
  willConnect?: boolean;
}

/**
 * One paired sensor in a list, without opening the manager: what it is, its battery and mode, whether it is connected and receiving
 * (with the age of its last value), why not when it is not (a sensor that sleeps until the pedals turn is "not found"), and one button:
 * "Sambungkan" when it is down, "Batal" while it connects, "Putuskan" when it is up. The link keeps itself up afterwards and reconnects
 * in the background with a growing pause.
 */
export function SensorLinkRow({ sensor, managed = false, willConnect = false }: SensorLinkRowProps) {
  const { t } = useTranslation(['watch', 'workouts']);
  const { hub, connect, disconnect } = useSensors();
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<{ permission: Granted | null; failure: RadioFailure | null } | null>(null);

  const link = hub.links[sensor.id];
  const status = sensorStatus(link, now);
  const { phase } = status;
  const raw = link?.state ?? 'disconnected';
  const up = phase === 'waiting' || phase === 'receiving' || phase === 'quiet';
  const reading = up && link ? readingLine(link.preview) : null;
  const hint = link ? linkHint(link, sensor.kinds, now) : null;
  const battery = batteryLabel(link?.battery ?? sensor.battery);
  const mode = sensor.kinds.includes('csc') && status.mode ? modeLabel(status.mode) : null;
  const details = [kindsLabel(sensor.kinds), mode, battery].filter((part): part is string => !!part).join(' · ');
  const problem = asked ? radioProblem(hub, asked.permission, asked.failure) : null;

  const onConnect = async () => {
    setBusy(true);
    setAsked(null);
    try {
      setAsked({ permission: await connect(sensor.id), failure: null });
    } catch (e) {
      setAsked({ permission: null, failure: { code: errorCode(e), during: 'connect' } });
    } finally {
      setBusy(false);
    }
  };

  const name = sensorLabel(sensor);
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <IconChip icon={sensorIcon(sensor.kinds)} tint={up ? 'link' : 'neutral'} />
        <View style={styles.text}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {name}
          </AppText>
          {details ? (
            <AppText variant="caption" muted numberOfLines={1}>
              {details}
            </AppText>
          ) : null}
          <SensorStatusLine status={status} reading={reading} />
        </View>
        {raw === 'connecting' ? (
          managed ? null : (
            <Button label={t('watch:sensors.paired.cancel')} icon="close" onPress={() => void disconnect(sensor.id)} style={styles.button} />
          )
        ) : up ? (
          managed ? null : (
            <Button
              label={t('watch:sensors.paired.disconnect')}
              icon="close-circle-outline"
              onPress={() => void disconnect(sensor.id)}
              style={styles.button}
            />
          )
        ) : (
          <Button
            label={t('watch:sensors.paired.connect')}
            variant="primary"
            icon="bluetooth"
            loading={busy}
            onPress={() => void onConnect()}
            style={styles.button}
          />
        )}
      </View>
      {hint ? (
        <AppText variant="caption" muted>
          {t(`watch:sensors.hint.${hint}`)}
        </AppText>
      ) : willConnect && phase === 'idle' ? (
        <AppText variant="caption" muted>
          {t('workouts:record.sensor.willConnect')}
        </AppText>
      ) : null}
      {problem ? (
        <Notice
          tone="danger"
          action={problem === 'permission' ? { label: t('watch:sensors.problem.openSettings'), onPress: () => void Linking.openSettings() } : undefined}>
          {t(`watch:sensors.problem.${problem}`)}
        </Notice>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, gap: 1 },
  button: { paddingHorizontal: spacing.md },
});

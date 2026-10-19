import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { KeyValue } from '@/components/KeyValue';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useNow } from '@/hooks/useNow';
import { fmtPercent } from '@/i18n';
import { useSensors } from '@/state/SensorsProvider';
import { spacing } from '@/theme';

import { sensorStatus } from '../linkStatus';
import { sensorLabel, type SavedSensor } from '../store';
import { linkHint, modeLabel, readingLine, sensorGlyph } from './format';
import { SensorStatusLine } from './SensorStatusLine';
import { KindTags } from './parts';

interface SensorCardProps {
  sensor: SavedSensor;
  /** A connect is being asked for (the permission prompt or the radio): the button spins. */
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onRename: () => void;
  onRemove: () => void;
}

/**
 * One paired sensor: its link and live reading (the "Connect" button is the test), what to do when it stays quiet, the battery and
 * what the sensor says it is, the auto-connect switch, rename and remove.
 */
export function SensorCard({ sensor, busy, onConnect, onDisconnect, onRename, onRemove }: SensorCardProps) {
  const { t } = useTranslation('watch');
  const { hub, setAutoConnect, rename } = useSensors();
  const link = hub.links[sensor.id];
  const now = useNow(1000);
  const status = sensorStatus(link, now);
  const state = link?.state ?? 'disconnected';
  const connected = state === 'connected';
  const reading = connected && link ? readingLine(link.preview) : null;
  const hint = link ? linkHint(link, sensor.kinds, now) : null;
  const battery = link?.battery ?? sensor.battery;
  const manufacturer = link?.manufacturer ?? sensor.manufacturer;
  const model = link?.model ?? sensor.model;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <IconChip {...sensorGlyph(sensor.kinds)} tint={connected ? 'link' : 'neutral'} />
        <View style={styles.text}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {sensorLabel(sensor)}
          </AppText>
          {sensor.alias ? (
            <AppText variant="caption" muted numberOfLines={1}>
              {sensor.name}
            </AppText>
          ) : null}
          <SensorStatusLine status={status} reading={null} />
        </View>
      </View>
      <KindTags kinds={sensor.kinds} />
      {status.mode && sensor.kinds.includes('csc') ? (
        <AppText variant="caption" muted>
          {modeLabel(status.mode)}
        </AppText>
      ) : null}
      {reading ? (
        <AppText variant="figure" numberOfLines={1} adjustsFontSizeToFit accessibilityLiveRegion="polite">
          {reading}
        </AppText>
      ) : null}
      {hint ? (
        <Notice tone={hint === 'failed' ? 'danger' : 'info'}>{t(`sensors.hint.${hint}`)}</Notice>
      ) : null}
      {state === 'disconnected' ? (
        <Button label={t('sensors.paired.connect')} variant="primary" icon="bluetooth" loading={busy} onPress={onConnect} />
      ) : (
        <Button
          label={connected ? t('sensors.paired.disconnect') : t('sensors.paired.cancel')}
          icon={connected ? 'close-circle-outline' : 'close'}
          onPress={onDisconnect}
        />
      )}
      {battery !== null || manufacturer || model ? (
        <View>
          {battery !== null ? <KeyValue icon="battery-half" label={t('sensors.paired.batteryLabel')} value={fmtPercent(battery)} /> : null}
          {manufacturer ? <KeyValue icon="business-outline" label={t('sensors.paired.maker')} value={manufacturer} /> : null}
          {model ? <KeyValue icon="hardware-chip-outline" label={t('sensors.paired.model')} value={model} /> : null}
        </View>
      ) : null}
      <SwitchRow
        label={t('sensors.paired.autoConnect.label')}
        hint={t('sensors.paired.autoConnect.hint')}
        value={sensor.autoConnect}
        onValueChange={(on) => void setAutoConnect(sensor.id, on)}
      />
      <View style={styles.actions}>
        <Button label={t('sensors.paired.rename.action')} icon="create-outline" onPress={onRename} />
        {sensor.alias ? <Button label={t('sensors.paired.rename.reset')} onPress={() => void rename(sensor.id, '')} /> : null}
        <Button label={t('sensors.paired.remove.action')} variant="destructive" icon="trash-outline" onPress={onRemove} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

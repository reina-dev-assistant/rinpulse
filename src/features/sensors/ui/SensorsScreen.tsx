import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Divider, Screen, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { sensorHub } from '@/features/sensors/instance';
import type { Granted } from '@/features/sensors/permissions';
import { RoutineNameDialog } from '@/features/strength/ui/RoutineNameDialog';
import { useSensors } from '@/state/SensorsProvider';
import { spacing } from '@/theme';

import { sensorLabel, type SavedSensor } from '../store';
import { errorCode, needsWheelSize, radioProblem, type RadioFailure } from './format';
import { sensorIntroSeen } from './intro';
import { ScanSection } from './ScanSection';
import { SensorCard } from './SensorCard';
import { WheelSection } from './WheelSection';

/**
 * The sensor manager: the paired sensors (rename, remove, auto-connect, a live test), the search for new ones, the wheel size and
 * what is not supported. It does not depend on a watch. Permission and radio trouble from any of its buttons show as one notice on top.
 */
export function SensorsScreen() {
  const { t } = useTranslation('watch');
  const { t: tRide } = useTranslation('ride');
  const router = useRouter();
  const { saved, hub, connect, disconnect, remove, rename } = useSensors();
  const [permission, setPermission] = useState<Granted | null>(null);
  const [failure, setFailure] = useState<RadioFailure | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<SavedSensor | null>(null);
  const [removing, setRemoving] = useState<SavedSensor | null>(null);

  // Bluetooth's state is only asked for once the person got past the explanation (on iOS that is what raises the system prompt).
  // The scan this screen started must not outlive it; the links of connected sensors do, a recording may be using them.
  useEffect(() => {
    if (sensorIntroSeen()) void sensorHub.refreshBluetooth().catch(() => {});
    return () => {
      void sensorHub.stopScan().catch(() => {});
    };
  }, []);

  const connectSensor = async (id: string) => {
    setConnectingId(id);
    setFailure(null);
    try {
      setPermission(await connect(id));
    } catch (e) {
      setFailure({ code: errorCode(e), during: 'connect' });
    } finally {
      setConnectingId(null);
    }
  };

  const problem = radioProblem(hub, permission, failure);

  return (
    <Screen>
      {problem ? (
        <Notice
          tone="danger"
          action={problem === 'permission' ? { label: t('sensors.problem.openSettings'), onPress: () => void Linking.openSettings() } : undefined}>
          {t(`sensors.problem.${problem}`)}
        </Notice>
      ) : null}

      <Section title={t('sensors.paired.title')} icon="pulse" trailing={saved.length > 0 ? <AppText variant="caption" muted>{saved.length}</AppText> : null}>
        {saved.length === 0 ? (
          <AppText variant="caption" muted>
            {t('sensors.paired.empty')}
          </AppText>
        ) : (
          <>
            {saved.map((sensor, index) => (
              <View key={sensor.id} style={styles.item}>
                {index > 0 ? <Divider /> : null}
                <SensorCard
                  sensor={sensor}
                  busy={connectingId === sensor.id}
                  onConnect={() => void connectSensor(sensor.id)}
                  onDisconnect={() => void disconnect(sensor.id)}
                  onRename={() => setRenaming(sensor)}
                  onRemove={() => setRemoving(sensor)}
                />
              </View>
            ))}
            <AppText variant="caption" muted>
              {t('sensors.paired.connectHint')}
            </AppText>
          </>
        )}
      </Section>

      <ScanSection onPermission={setPermission} onFailure={setFailure} />

      {saved.some((sensor) => needsWheelSize(sensor.kinds)) ? <WheelSection /> : null}

      <Section title={tRide('entry.title')} icon="laptop-outline" tint="link">
        <AppText variant="caption" muted>
          {tRide('entry.hint')}
        </AppText>
        <Button label={tRide('entry.action')} icon="laptop-outline" onPress={() => router.push('/ride')} />
      </Section>

      <Section title={t('sensors.notes.title')} icon="information-circle">
        <AppText variant="caption" muted>
          {t('sensors.notes.ant')}
        </AppText>
        <AppText variant="caption" muted>
          {t('sensors.notes.huawei')}
        </AppText>
      </Section>

      <RoutineNameDialog
        visible={renaming !== null}
        title={t('sensors.paired.rename.title')}
        placeholder={t('sensors.paired.rename.placeholder')}
        confirmLabel={t('sensors.paired.rename.save')}
        initial={renaming ? sensorLabel(renaming) : ''}
        onConfirm={(name) => {
          const target = renaming;
          setRenaming(null);
          if (target) void rename(target.id, name);
        }}
        onCancel={() => setRenaming(null)}
      />
      <ConfirmDialog
        visible={removing !== null}
        title={t('sensors.paired.remove.title')}
        message={t('sensors.paired.remove.message', { name: removing ? sensorLabel(removing) : '' })}
        confirmLabel={t('sensors.paired.remove.confirm')}
        destructive
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (target) void remove(target.id);
        }}
        onCancel={() => setRemoving(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { gap: spacing.md },
});

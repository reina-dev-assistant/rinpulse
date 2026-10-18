import { useRouter } from 'expo-router';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { NavRow } from '@/components/NavRow';
import { Divider, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { useSensors } from '@/state/SensorsProvider';

import { radioProblem } from './format';
import { SensorLinkRow } from './SensorLinkRow';

/**
 * The Watch tab's "Sensor" card: every paired sensor as a row with its link, battery and last value and the one button to connect or
 * disconnect it, so a sensor can be woken and checked without opening the manager, and the way into the manager (scan, pair, rename,
 * remove). With none paired it explains what sensors are for and offers to add one. Independent of any watch.
 */
export function SensorsSection() {
  const { t } = useTranslation('watch');
  const router = useRouter();
  const { saved, loaded, hub } = useSensors();
  if (!loaded) return null;
  const open = () => router.push('/watch/sensors');
  // Bluetooth off or not allowed concerns every row alike, so it is said once above them.
  const problem = saved.length > 0 ? radioProblem(hub, null, null) : null;

  return (
    <Section
      title={t('sensors.title')}
      icon="pulse"
      trailing={
        saved.length > 0 ? (
          <AppText variant="caption" muted>
            {saved.length}
          </AppText>
        ) : null
      }>
      {saved.length === 0 ? (
        <>
          <AppText variant="caption" muted>
            {t('sensors.hub.empty')}
          </AppText>
          <Button label={t('sensors.hub.add')} variant="primary" icon="add" onPress={open} />
        </>
      ) : (
        <>
          {problem ? (
            <Notice
              tone="danger"
              action={problem === 'permission' ? { label: t('sensors.problem.openSettings'), onPress: () => void Linking.openSettings() } : undefined}>
              {t(`sensors.problem.${problem}`)}
            </Notice>
          ) : null}
          {saved.map((sensor, index) => (
            <Fragment key={sensor.id}>
              {index > 0 ? <Divider /> : null}
              <SensorLinkRow sensor={sensor} />
            </Fragment>
          ))}
          <Divider />
          <NavRow icon="bluetooth" title={t('sensors.hub.manage')} subtitle={t('sensors.hub.manageSub')} style={styles.navRow} onPress={open} />
        </>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  navRow: { paddingHorizontal: 0 },
});

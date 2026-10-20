import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Screen, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { fmtAgo, fmtDecimal, fmtInt } from '@/i18n/format';
import type { Granted } from '@/features/sensors/permissions';
import { sensorLabel } from '@/features/sensors/store';
import { batteryLabel } from '@/features/sensors/ui/format';
import { spacing } from '@/theme';

import { NightSection } from './NightSection';
import { ThermometerPicker } from './ThermometerPicker';
import { useThermometer } from '../useThermometer';
import { useThermometerDiscovery } from './useThermometerDiscovery';

type Problem = 'permission' | 'off' | 'unavailable' | 'notAllowed';

/**
 * Pengaturan > Termometer kamar: the thermometer in use with its last reading and battery, the search and pairing, the overnight scan, what
 * the sensor needs (community firmware) and what leaves the phone (only the nightly averages, and only with Wawasan tidur on).
 */
export function ThermometerScreen() {
  const { t } = useTranslation('thermometer');
  const thermometer = useThermometer();
  const discovery = useThermometerDiscovery();
  const [permission, setPermission] = useState<Granted | null>(null);
  const [nightProblem, setNightProblem] = useState<Problem | null>(null);
  const [forgetting, setForgetting] = useState(false);

  const code = discovery.error;
  const searchProblem: Problem | null =
    permission === 'denied' || permission === 'blocked' || code === 'ERR_BLUETOOTH_PERMISSION'
      ? 'permission'
      : code === 'ERR_BLUETOOTH_OFF'
        ? 'off'
        : code
          ? 'unavailable'
          : null;
  const problem = nightProblem ?? searchProblem;

  const { sensor, last } = thermometer;
  const battery = sensor ? batteryLabel(sensor.battery) : null;

  return (
    <Screen>
      {problem ? (
        <Notice
          tone="danger"
          action={problem === 'permission' ? { label: t('problem.openSettings'), onPress: () => void Linking.openSettings() } : undefined}>
          {t(`problem.${problem}`)}
        </Notice>
      ) : null}

      {sensor ? (
        <Section title={sensorLabel(sensor)} icon="thermometer-outline">
          <View style={styles.reading} accessibilityLiveRegion="polite">
            {last ? (
              <>
                <AppText variant="display">{t('card.reading', { temp: fmtDecimal(last.tempC, 1), rh: fmtInt(last.rhPct) })}</AppText>
                <AppText variant="caption" muted>
                  {t('card.lastAt', { ago: fmtAgo(Math.floor(last.ts / 1000), Math.floor(Date.now() / 1000)) })}
                </AppText>
              </>
            ) : (
              <AppText variant="caption" muted>
                {t('card.noReading')}
              </AppText>
            )}
            {battery ? (
              <AppText variant="caption" muted>
                {battery}
              </AppText>
            ) : null}
          </View>
          <Button label={t('card.forget')} icon="trash-outline" variant="ghost" onPress={() => setForgetting(true)} />
        </Section>
      ) : (
        <Section title={t('title')} icon="thermometer-outline">
          <AppText variant="caption" muted>
            {t('card.empty')}
          </AppText>
        </Section>
      )}

      <ThermometerPicker
        discovery={discovery}
        currentId={sensor?.id ?? null}
        onPermission={setPermission}
        onPick={(device) => void thermometer.pair(device)}
      />

      {sensor ? <NightSection ids={[sensor.id]} onProblem={setNightProblem} /> : null}

      <Section title={t('firmware.title')} icon="information-circle">
        <AppText variant="caption" muted>
          {t('firmware.body')}
        </AppText>
      </Section>

      <Section title={t('privacy.title')} icon="lock-closed">
        <AppText variant="caption" muted>
          {t('privacy.body')}
        </AppText>
      </Section>

      <ConfirmDialog
        visible={forgetting}
        title={t('card.forgetTitle')}
        message={t('card.forgetMessage')}
        confirmLabel={t('card.forget')}
        destructive
        onConfirm={() => {
          setForgetting(false);
          void thermometer.forget();
        }}
        onCancel={() => setForgetting(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  reading: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md },
});

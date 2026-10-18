import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { StatusDot } from '@/components/StatusDot';
import { fmtInt } from '@/i18n';
import { spacing, useTheme } from '@/theme';

import type { RideSnapshot } from '../session';
import { connectionKey, sensorParts } from './format';

/** The room at a glance: relay connection, game screens, the sensors the phone reads, latency. */
export function StatusCard({ snapshot }: { snapshot: RideSnapshot }) {
  const { t } = useTranslation('ride');
  const { colors } = useTheme();
  const key = connectionKey(snapshot.phase);
  const tone = key === 'connected' ? colors.link : key === 'lost' || key === 'ended' ? colors.destructive : colors.warning;
  const { hr, cad } = sensorParts(snapshot);
  const sensors = [hr === null ? null : t('status.hr', { value: fmtInt(hr) }), cad === null ? null : t('status.cad', { value: fmtInt(cad) })].filter((s): s is string => s !== null);

  return (
    <Section title={snapshot.code ? t('status.room', { code: snapshot.code }) : t('status.title')} icon="pulse" tint="link">
      <View style={styles.connection}>
        <StatusDot color={tone} live={key === 'connected'} />
        <AppText variant="bodyStrong" style={styles.connectionText}>
          {t(`status.${key}`, { count: snapshot.attempt })}
        </AppText>
      </View>
      <KeyValue icon="laptop-outline" label={t('status.game')} value={snapshot.webs > 0 ? t('status.gameOn', { count: snapshot.webs }) : t('status.gameWaiting')} />
      <KeyValue icon="bluetooth" label={t('status.sensors')} value={sensors.length > 0 ? sensors.join(' · ') : t('status.sensorsNone')} />
      <KeyValue icon="speedometer-outline" label={t('status.latency')} value={snapshot.latencyMs === null ? null : t('status.latencyValue', { ms: fmtInt(snapshot.latencyMs) })} />
    </Section>
  );
}

const styles = StyleSheet.create({
  connection: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  connectionText: { flex: 1 },
});

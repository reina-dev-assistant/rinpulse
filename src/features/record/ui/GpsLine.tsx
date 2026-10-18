import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { StatusDot } from '@/components/StatusDot';
import { fmtInt } from '@/i18n';
import { spacing, useColors } from '@/theme';

import { gpsStatus, type FixInfo } from './format';

interface GpsLineProps {
  fix: FixInfo | null;
  /** Colours for text on a dark panel. */
  color?: string;
}

/** "Mencari sinyal GPS" / "GPS siap, akurasi 6 m": a dot (hollow while it is not ready) and the words. */
export function GpsLine({ fix, color }: GpsLineProps) {
  const { t } = useTranslation('workouts');
  const colors = useColors();
  const status = gpsStatus(fix);
  const accuracy = fix?.accuracyM ?? null;
  const meters = accuracy === null ? null : fmtInt(accuracy);
  const text =
    status === 'searching'
      ? t('record.gps.searching')
      : status === 'weak'
        ? t('record.gps.weak', { meters })
        : status === 'fair'
          ? t('record.gps.fair', { meters })
          : meters !== null
            ? t('record.gps.ready', { meters })
            : t('record.gps.readyNoAccuracy');
  return (
    <View accessible accessibilityLiveRegion="polite" accessibilityLabel={text} style={styles.row}>
      <StatusDot color={status === 'ready' ? colors.link : colors.warning} live={status === 'ready'} />
      <AppText variant="caption" muted={color === undefined} color={color} style={styles.text}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  text: { flex: 1 },
});

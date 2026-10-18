import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme';

import type { RidePalette } from './ridePalette';

export type GpsState = 'searching' | 'ready' | 'fair' | 'weak';

/** Below this the battery is drawn in the warning colour. */
export const LOW_BATTERY_PCT = 20;

interface StatusStripProps {
  palette: RidePalette;
  gps: GpsState | null;
  accuracyM: number | null;
  sensorsLost: number;
  batteryPct: number | null;
  /** The recorder is running (not paused): shows the recording dot, a real state. */
  recording: boolean;
  paused: boolean;
  autoPaused: boolean;
  /** The battery saver is on: its short sentence, null otherwise. */
  saver?: string | null;
}

/** GPS state, lost sensors, phone battery and whether it is recording, in one thin line at the top. */
export function StatusStrip({ palette, gps, accuracyM, sensorsLost, batteryPct, recording, paused, autoPaused, saver = null }: StatusStripProps) {
  const { t } = useTranslation('bikecomp');
  const { fonts } = useTheme();
  const text = { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 };
  const gpsLabel = gps === null ? null : t(`status.gps.${gps}`);
  const gpsOk = gps === 'ready';
  const batteryLow = batteryPct !== null && batteryPct <= LOW_BATTERY_PCT;

  return (
    <View style={styles.row}>
      <View style={styles.group}>
        {gpsLabel !== null ? (
          <View accessible accessibilityLabel={t('a11y.status.gps', { state: gpsLabel })} style={styles.item}>
            <Ionicons name="navigate" size={16} color={gpsOk ? palette.foreground : palette.warn} />
            <Text allowFontScaling={false} style={[text, { color: gpsOk ? palette.foreground : palette.warn }]}>
              {gpsLabel}
              {accuracyM !== null && gps !== 'searching' ? ` ${t('status.gps.accuracy', { meters: Math.round(accuracyM) })}` : ''}
            </Text>
          </View>
        ) : null}
        {sensorsLost > 0 ? (
          <View style={styles.item}>
            <Ionicons name="bluetooth" size={16} color={palette.warn} />
            <Text allowFontScaling={false} style={[text, { color: palette.warn }]}>
              {t('status.sensorsLost', { count: sensorsLost })}
            </Text>
          </View>
        ) : null}
        {batteryPct !== null ? (
          <View accessible accessibilityLabel={t('a11y.status.battery', { pct: Math.round(batteryPct) })} style={styles.item}>
            <Ionicons name={batteryLow ? 'battery-dead' : 'battery-half'} size={16} color={batteryLow ? palette.warn : palette.muted} />
            <Text allowFontScaling={false} style={[text, { color: batteryLow ? palette.warn : palette.muted }]}>
              {t('status.battery', { pct: Math.round(batteryPct) })}
            </Text>
          </View>
        ) : null}
        {saver ? (
          <View style={styles.item}>
            <Ionicons name="battery-charging" size={16} color={palette.foreground} />
            <Text allowFontScaling={false} style={[text, { color: palette.foreground }]} numberOfLines={1}>
              {saver}
            </Text>
          </View>
        ) : null}
      </View>
      {autoPaused || paused ? (
        <Text allowFontScaling={false} style={[text, { color: palette.warn }]}>
          {autoPaused ? t('status.autoPaused') : t('status.paused')}
        </Text>
      ) : recording ? (
        <View accessible accessibilityLabel={t('a11y.status.recording')} style={styles.item}>
          <View style={[styles.dot, { backgroundColor: palette.offCourse }]} />
          <Text allowFontScaling={false} style={[text, { color: palette.foreground }]}>
            {t('status.recording')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 12, paddingVertical: 4 },
  group: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 2, flexShrink: 1 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});

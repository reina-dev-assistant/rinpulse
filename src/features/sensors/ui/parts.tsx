import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { spacing, useColors, useTheme } from '@/theme';

import type { SensorKind } from '../gatt';
import { kindIcon, kindLabel, signalBars, signalLevel, sortKinds } from './format';

/** Non-interactive labels of what a sensor measures: a glyph and a word each, so no kind is told by colour alone. */
export function KindTags({ kinds }: { kinds: readonly SensorKind[] }) {
  const { colors, radius } = useTheme();
  return (
    <View style={styles.tags}>
      {sortKinds(kinds).map((kind) => (
        <View key={kind} style={[styles.tag, { backgroundColor: colors.muted, borderRadius: radius.control }]}>
          <Ionicons name={kindIcon(kind)} size={14} color={colors.foreground} />
          <AppText variant="label">{kindLabel(kind)}</AppText>
        </View>
      ))}
    </View>
  );
}

const BAR_HEIGHTS = [6, 10, 14, 18] as const;

/** Four bars that fill from the left, with the level in words next to them. */
export function Signal({ rssi }: { rssi: number }) {
  const { t } = useTranslation('watch');
  const colors = useColors();
  const bars = signalBars(rssi);
  const label = t(`sensors.signal.${signalLevel(rssi)}`);
  return (
    <View style={styles.signal} accessible accessibilityLabel={label}>
      <View style={styles.bars} importantForAccessibility="no-hide-descendants">
        {BAR_HEIGHTS.map((height, index) => (
          <View
            key={height}
            style={{ width: 4, height, borderRadius: 2, backgroundColor: index < bars ? colors.foreground : colors.switchOff }}
          />
        ))}
      </View>
      <AppText variant="caption" muted>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tag: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  signal: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
});

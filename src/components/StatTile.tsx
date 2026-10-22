import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip, type IconName } from '@/components/IconChip';
import { Metric } from '@/components/Metric';
import { spacing, tintColors, useTheme, type Tint } from '@/theme';

interface StatTileProps {
  icon: IconName;
  tint: Tint;
  label: string;
  value: string;
  unit?: string;
  sub?: string;
}

/** Soft-tinted tile for one number: chip, label, big value with a small unit. */
export function StatTile({ icon, tint, label, value, unit, sub }: StatTileProps) {
  const { theme, colors, radius } = useTheme();
  const scheme = tintColors(colors, tint);
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}`}
      style={[
        styles.tile,
        { backgroundColor: scheme.soft, borderRadius: radius.tile },
        theme.outlined ? { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline } : null,
      ]}>
      <View style={styles.head}>
        <IconChip icon={icon} tint={tint} size="sm" background={colors.card} />
        <AppText variant="label" color={scheme.text} numberOfLines={1} style={styles.label}>
          {label}
        </AppText>
      </View>
      <View style={styles.body}>
        <Metric value={value} unit={unit} size="md" color={scheme.text} unitColor={scheme.text} />
        {sub ? (
          <AppText variant="caption" color={scheme.text}>
            {sub}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, padding: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { flex: 1 },
  body: { gap: 0 },
});

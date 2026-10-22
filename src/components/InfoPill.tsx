import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { spacing, tintColors, useTheme, type Tint } from '@/theme';

/** A small read-only pill for the one secondary figure of a card ("108 min to go", "weekly total"). Soft tint when it states a good result. */
export function InfoPill({ label, tint }: { label: string; tint?: Tint }) {
  const { colors, radius } = useTheme();
  const scheme = tint ? { bg: tintColors(colors, tint).soft, fg: tintColors(colors, tint).text } : { bg: colors.muted, fg: colors.foreground };
  return (
    <View style={[styles.pill, { backgroundColor: scheme.bg, borderRadius: Math.min(radius.control, 16) }]}>
      <AppText variant="label" color={scheme.fg} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: spacing.md, paddingVertical: 6, flexShrink: 1 },
});

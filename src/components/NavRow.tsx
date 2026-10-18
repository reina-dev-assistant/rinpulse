import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip, type IconName } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { spacing, useColors, type Colors, type Theme, type Tint } from '@/theme';

interface NavRowProps {
  /** Glyph of the round chip; leave out when `leading` is given. */
  icon?: IconName;
  tint?: Tint | 'neutral';
  /** Replaces the chip, e.g. a `BrandMark` or an avatar. */
  leading?: ReactNode;
  /** Sign out or delete: red chip and title, no chevron. The action confirms in its own dialog. */
  destructive?: boolean;
  title: string;
  subtitle?: string;
  /** Short value shown before the chevron, e.g. a count. */
  value?: string;
  onPress: () => void;
  disabled?: boolean;
  /** Frame inside a grouped list (see `groupedRowStyle`). */
  style?: ViewStyle;
}

/** Tappable row: leading chip or mark, title with an optional line under it, chevron. At least 56 dp so it is easy to hit. */
export function NavRow({ icon, tint, leading, destructive, title, subtitle, value, onPress, disabled, style }: NavRowProps) {
  const colors = useColors();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      scaleTo={0.985}
      style={[styles.row, style]}>
      {leading ? (
        <View style={styles.leading}>{leading}</View>
      ) : icon ? (
        <IconChip icon={icon} tint={destructive ? 'destructive' : tint} size="md" />
      ) : null}
      <View style={styles.text}>
        <AppText variant="bodyStrong" numberOfLines={1} danger={destructive}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" muted numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {value ? (
        <AppText variant="caption" muted>
          {value}
        </AppText>
      ) : null}
      {destructive ? null : <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />}
    </PressableScale>
  );
}

/**
 * Frame for one row of a grouped list: white card, hairline between rows, the first and last rows
 * carry the card's rounded corners. Lets virtualized lists (rows are separate items) read as one card.
 * Takes what `useTheme()` returns.
 */
export function groupedRowStyle(
  { colors, radius }: { colors: Colors; radius: Theme['radius'] },
  index: number,
  count: number,
): ViewStyle {
  return {
    backgroundColor: colors.card,
    borderTopLeftRadius: index === 0 ? radius.card : 0,
    borderTopRightRadius: index === 0 ? radius.card : 0,
    borderBottomLeftRadius: index === count - 1 ? radius.card : 0,
    borderBottomRightRadius: index === count - 1 ? radius.card : 0,
    borderBottomWidth: index < count - 1 ? StyleSheet.hairlineWidth : 0,
    borderBottomColor: colors.hairline,
  };
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  /** The width of the round chip, so titles line up whether a row has a chip or a mark (36) in front. */
  leading: { minWidth: 40, alignItems: 'center' },
  text: { flex: 1, gap: 1 },
});

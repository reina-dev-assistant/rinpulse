import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip, type ChipGlyph } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { spacing, useColors, type Colors, type Theme, type Tint } from '@/theme';

/** The round chip shows `icon`, or `sport` for a workout type; leave both out when `leading` is given. */
type NavRowProps = Partial<ChipGlyph> & {
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
};

/** Tappable row: leading chip or mark, title with an optional line under it, chevron. At least 56 dp so it is easy to hit. */
export function NavRow({ icon, sport, tint, leading, destructive, title, subtitle, value, onPress, disabled, style }: NavRowProps) {
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
      ) : sport ? (
        <IconChip sport={sport} tint={destructive ? 'destructive' : tint} size="md" />
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
  { theme, colors, radius }: { theme: Theme; colors: Colors; radius: Theme['radius'] },
  index: number,
  count: number,
): ViewStyle {
  // An outlined theme draws the group as one thin-bordered card: side borders on every row, the top on the first, the bottom on all.
  const outline: ViewStyle = theme.outlined
    ? {
        borderLeftWidth: StyleSheet.hairlineWidth,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderTopWidth: index === 0 ? StyleSheet.hairlineWidth : 0,
        borderLeftColor: colors.hairline,
        borderRightColor: colors.hairline,
        borderTopColor: colors.hairline,
      }
    : {};
  return {
    ...outline,
    backgroundColor: colors.card,
    borderTopLeftRadius: index === 0 ? radius.card : 0,
    borderTopRightRadius: index === 0 ? radius.card : 0,
    borderBottomLeftRadius: index === count - 1 ? radius.card : 0,
    borderBottomRightRadius: index === count - 1 ? radius.card : 0,
    borderBottomWidth: index < count - 1 || theme.outlined ? StyleSheet.hairlineWidth : 0,
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

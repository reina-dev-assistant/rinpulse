import type { ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PopIn } from '@/components/motion';
import { PressableScale } from '@/components/PressableScale';
import { fontSize, HIT, spacing, useTheme } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface ButtonProps {
  label: string;
  onPress: () => void;
  /** `inverse` is the light button for the dark watch panel. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'inverse';
  disabled?: boolean;
  loading?: boolean;
  /** A check in place of the icon or spinner: the action just succeeded. The caller clears it after a moment. */
  done?: boolean;
  icon?: IconName;
  /** Lines the label may take before it is cut off; 1 by default. */
  lines?: number;
  /** Only the icon shows, in a square target; the label stays as the accessibility label. Needs an `icon`. */
  iconOnly?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled,
  loading,
  done,
  icon,
  lines = 1,
  iconOnly,
  style,
}: ButtonProps) {
  const { colors, fonts, radius } = useTheme();
  const inactive = disabled || loading;
  const scheme = {
    primary: { bg: colors.primary, fg: colors.primaryForeground },
    secondary: { bg: colors.muted, fg: colors.foreground },
    ghost: { bg: 'transparent', fg: colors.primary },
    destructive: { bg: colors.destructiveSoft, fg: colors.destructive },
    inverse: { bg: colors.heroForeground, fg: colors.hero },
  }[variant];
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={[styles.base, iconOnly && styles.iconOnly, { backgroundColor: scheme.bg, borderRadius: radius.control }, style]}>
      {loading ? <ActivityIndicator size="small" color={scheme.fg} /> : null}
      {!loading && done ? (
        <PopIn>
          <Ionicons name="checkmark" size={18} color={scheme.fg} />
        </PopIn>
      ) : null}
      {!loading && !done && icon ? <Ionicons name={icon} size={18} color={scheme.fg} /> : null}
      {iconOnly ? null : (
        <Text style={[styles.label, { color: scheme.fg, fontFamily: fonts.medium }, lines > 1 && styles.wrapped]} numberOfLines={lines}>
          {label}
        </Text>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: HIT,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  iconOnly: { width: HIT, paddingHorizontal: 0 },
  label: { fontSize: fontSize.base },
  wrapped: { flexShrink: 1, textAlign: 'center', paddingVertical: spacing.xs },
});

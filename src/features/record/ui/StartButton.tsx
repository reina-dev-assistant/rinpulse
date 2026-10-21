import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { spacing, useTheme } from '@/theme';

interface StartButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

/**
 * The one big action of the recording screens: full width, 64 dp tall, in the theme's primary colour and control radius. Disabled it
 * rests at 45 % like every control; the reason sits above it in the sheet.
 */
export function StartButton({ label, onPress, disabled, loading }: StartButtonProps) {
  const { colors, radius, fonts } = useTheme();
  const inactive = disabled || loading;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={[styles.base, { backgroundColor: colors.primary, borderRadius: radius.control }]}>
      {loading ? (
        <ActivityIndicator size="small" color={colors.primaryForeground} />
      ) : (
        // The triangle's weight sits left of its box; two dp to the right centres it optically beside the label.
        <Ionicons name="play" size={22} color={colors.primaryForeground} style={styles.glyph} />
      )}
      <AppText variant="heading" color={colors.primaryForeground} style={{ fontFamily: fonts.heavy, fontSize: 18 }}>
        {label}
      </AppText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  glyph: { marginLeft: 2 },
});

import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme';

import type { RidePalette } from './ridePalette';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface RideButtonProps {
  label: string;
  icon?: IconName;
  /** `filled` is the main action (foreground fill), `soft` a second surface, `outline` a quiet one. */
  variant?: 'filled' | 'soft' | 'outline';
  palette: RidePalette;
  disabled?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

/** A ride control: at least 64 dp tall, square corners, palette colours, press scale 0.96 (`PressableScale`). */
export function RideButton({ label, icon, variant = 'soft', palette, disabled, onPress, style }: RideButtonProps) {
  const { fonts } = useTheme();
  const filled = variant === 'filled';
  const background = filled ? palette.foreground : variant === 'soft' ? palette.surface : palette.background;
  const color = filled ? palette.background : palette.foreground;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      scaleTo={0.96}
      onPress={onPress}
      style={[styles.base, { backgroundColor: background, borderColor: palette.foreground, borderWidth: variant === 'outline' ? 2 : 0 }, style]}>
      {icon ? <Ionicons name={icon} size={24} color={color} /> : null}
      <Text numberOfLines={1} allowFontScaling={false} style={[styles.label, { color, fontFamily: fonts.bold }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 64, minWidth: 64, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  label: { fontSize: 18, lineHeight: 24 },
});

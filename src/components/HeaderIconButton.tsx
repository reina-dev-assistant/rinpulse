import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet } from 'react-native';

import type { IconName } from '@/components/IconChip';
import { PopIn } from '@/components/motion';
import { PressableScale } from '@/components/PressableScale';
import { HIT, useColors } from '@/theme';

interface HeaderIconButtonProps {
  icon: IconName;
  /** What the button does, read out by screen readers; there is no visible text. */
  label: string;
  /** Why the button is off, or what it will do, read after the label. */
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  /** A spinner in place of the icon: the action is running. The button stops answering. */
  loading?: boolean;
  /** A check in place of the icon: the action just succeeded. The caller clears it after a moment. */
  done?: boolean;
}

/** Round icon-only button for a page header, 48 dp wide and tall so it is easy to hit. */
export function HeaderIconButton({ icon, label, hint, onPress, disabled, loading, done }: HeaderIconButtonProps) {
  const colors = useColors();
  const inactive = disabled || loading;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={[styles.base, { backgroundColor: colors.muted }]}>
      {loading ? <ActivityIndicator size="small" color={colors.foreground} /> : null}
      {!loading && done ? (
        <PopIn>
          <Ionicons name="checkmark" size={22} color={colors.foreground} />
        </PopIn>
      ) : null}
      {!loading && !done ? <Ionicons name={icon} size={22} color={colors.foreground} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { width: HIT, height: HIT, borderRadius: HIT / 2, alignItems: 'center', justifyContent: 'center' },
});

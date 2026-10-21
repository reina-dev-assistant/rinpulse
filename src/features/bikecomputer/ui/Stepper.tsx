import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { spacing, useTheme } from '@/theme';

import { canStep, stepValue, type StepRange } from './stepMath';

interface StepperProps extends StepRange {
  label: string;
  hint?: string;
  value: number;
  /** The value as text, e.g. `20 menit`. */
  format: (value: number) => string;
  onChange: (value: number) => void;
  disabled?: boolean;
}

/** A number with big minus and plus buttons (56 dp) instead of a text field; the numbers it offers are all valid. */
export function Stepper({ label, hint, value, min, max, step, format, onChange, disabled }: StepperProps) {
  const { t } = useTranslation('bikecomp');
  const { colors, fonts, radius } = useTheme();
  const range = { min, max, step };
  const text = format(value);

  const button = (direction: -1 | 1) => {
    const can = !disabled && canStep(value, direction, range);
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t(direction < 0 ? 'stepper.decrease' : 'stepper.increase', { label })}
        accessibilityState={{ disabled: !can }}
        disabled={!can}
        onPress={() => onChange(stepValue(value, direction, range))}
        scaleTo={0.96}
        style={[styles.button, { backgroundColor: colors.muted, borderRadius: radius.control }]}>
        <Ionicons name={direction < 0 ? 'remove' : 'add'} size={26} color={colors.foreground} />
      </PressableScale>
    );
  };

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (disabled) return;
        if (event.nativeEvent.actionName === 'increment') onChange(stepValue(value, 1, range));
        else if (event.nativeEvent.actionName === 'decrement') onChange(stepValue(value, -1, range));
      }}
      style={[styles.row, disabled && styles.disabled]}>
      <View style={styles.text}>
        <AppText variant="bodyStrong">{label}</AppText>
        {hint ? (
          <AppText variant="caption" muted>
            {hint}
          </AppText>
        ) : null}
      </View>
      {button(-1)}
      <AppText style={[styles.value, { fontFamily: fonts.numeral }]} numberOfLines={1}>
        {text}
      </AppText>
      {button(1)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 64 },
  disabled: { opacity: 0.5 },
  text: { flex: 1, gap: 1 },
  button: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  value: { minWidth: 76, textAlign: 'center', fontSize: 18, fontVariant: ['tabular-nums'] },
});

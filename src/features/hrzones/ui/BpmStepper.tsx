import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { PressableScale } from '@/components/PressableScale';
import { fontSize, HIT, useTheme } from '@/theme';

interface BpmStepperProps {
  /** Accessibility label of the field, e.g. "Heart rate where zone 2 starts". */
  label: string;
  /** Spoken names of the two buttons. */
  lessLabel: string;
  moreLabel: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

/**
 * A whole-number control for a heart rate: minus and plus buttons (48 dp targets) around a field the person can type into. A typed value is
 * applied, brought into `min`..`max`, when the field loses focus or "done" is pressed; while typing, the field keeps what was typed so a
 * half-entered number is never rewritten.
 */
export function BpmStepper({ label, lessLabel, moreLabel, value, min, max, onChange }: BpmStepperProps) {
  const { colors, fonts, radius } = useTheme();
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  const commit = () => {
    setFocused(false);
    const typed = Number(text);
    if (text.trim() === '' || !Number.isFinite(typed)) return;
    onChange(Math.min(max, Math.max(min, Math.round(typed))));
  };

  const step = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)));

  return (
    <View style={styles.row}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={lessLabel}
        disabled={value <= min}
        onPress={() => step(-1)}
        style={[styles.button, { backgroundColor: colors.muted, borderRadius: radius.control }]}>
        <Ionicons name="remove" size={20} color={colors.foreground} />
      </PressableScale>
      <TextInput
        accessibilityLabel={label}
        value={focused ? text : String(value)}
        onChangeText={(next) => setText(next.replace(/\D/g, '').slice(0, 3))}
        onFocus={() => {
          setText(String(value));
          setFocused(true);
        }}
        onBlur={commit}
        onSubmitEditing={commit}
        keyboardType="number-pad"
        returnKeyType="done"
        maxLength={3}
        selectTextOnFocus
        selectionColor={colors.primary}
        style={[styles.input, { color: colors.foreground, fontFamily: fonts.medium, borderColor: focused ? colors.primary : 'transparent', borderRadius: radius.input }]}
      />
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={moreLabel}
        disabled={value >= max}
        onPress={() => step(1)}
        style={[styles.button, { backgroundColor: colors.muted, borderRadius: radius.control }]}>
        <Ionicons name="add" size={20} color={colors.foreground} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  button: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  input: {
    width: 56,
    height: HIT,
    textAlign: 'center',
    fontSize: fontSize.lg,
    fontVariant: ['tabular-nums'],
    borderWidth: 1.5,
    padding: 0,
  },
});

import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, TextInput, type StyleProp, type ViewStyle } from 'react-native';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { fontSize, useTheme } from '@/theme';

import { clampReps, clampSeconds, clampWeight, inputText, parseNumber, parseSeconds, timerText } from '../logFormat';

export type FieldKind = 'weight' | 'reps' | 'seconds';

interface NumberFieldProps {
  kind: FieldKind;
  value: number | null;
  /** Shown in grey while the field is empty: what ticking the row would copy. */
  hint?: string;
  label: string;
  done: boolean;
  /** Bumps to make the field shake and turn red (a refused tick). */
  flash: number;
  onChange: (value: number | null) => void;
  style?: StyleProp<ViewStyle>;
}

const parse = (kind: FieldKind, text: string): number | null => {
  if (kind === 'seconds') return clampSeconds(parseSeconds(text));
  const n = parseNumber(text);
  return kind === 'weight' ? clampWeight(n) : clampReps(n);
};

/**
 * A number box of the set table: comma or dot decimals, everything selected on focus, a timed set shows `m:ss` when not being edited. The text is
 * the field's own while typing ("7," stays "7,"); the value goes up on every keystroke.
 */
export function NumberField({ kind, value, hint, label, done, flash, onChange, style }: NumberFieldProps) {
  const { colors, fonts, radius } = useTheme();
  const reduced = useReducedMotion();
  const [text, setText] = useState(() => inputText(value));
  const [focused, setFocused] = useState(false);
  const [shake] = useState(() => new Animated.Value(0));
  const [warn, setWarn] = useState(false);
  const lastFlash = useRef(flash);

  // The value changed from outside (a tap on "previous", a tick that filled the row): show it.
  useEffect(() => {
    if (parse(kind, text) !== value) setText(inputText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only an outside change of `value` matters
  }, [value, kind]);

  useEffect(() => {
    if (flash === lastFlash.current) return;
    lastFlash.current = flash;
    setWarn(true);
    const timeout = setTimeout(() => setWarn(false), 900);
    if (!reduced) {
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 90, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 1, duration: 90, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
      ]).start();
    }
    return () => clearTimeout(timeout);
  }, [flash, reduced, shake]);

  const shown = kind === 'seconds' && !focused && value !== null ? timerText(value) : text;
  return (
    <Animated.View
      style={[
        styles.box,
        {
          backgroundColor: warn ? colors.destructiveSoft : done ? colors.workoutsSoft : colors.muted,
          borderRadius: radius.input,
          borderColor: warn ? colors.destructive : 'transparent',
          transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-6, 6] }) }],
        },
        style,
      ]}>
      <TextInput
        accessibilityLabel={label}
        value={shown}
        placeholder={hint}
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        keyboardType={kind === 'weight' ? 'decimal-pad' : 'number-pad'}
        selectTextOnFocus
        maxLength={8}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChangeText={(next) => {
          const clean = kind === 'seconds' ? next.replace(/[^0-9:]/g, '') : kind === 'weight' ? next.replace(/[^0-9.,]/g, '') : next.replace(/[^0-9]/g, '');
          setText(clean);
          onChange(parse(kind, clean));
        }}
        style={[styles.input, { color: colors.foreground, fontFamily: fonts.bold }]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: { height: 40, justifyContent: 'center', borderWidth: 1.5, minWidth: 0 },
  input: { fontSize: fontSize.base, padding: 0, textAlign: 'center', height: 40 },
});

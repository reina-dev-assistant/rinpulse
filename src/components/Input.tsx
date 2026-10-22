import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode, type Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from '@/components/AppText';
import type { IconName } from '@/components/IconChip';
import { useRevealFocusedInput } from '@/components/keyboardReveal';
import { fontSize, HIT, spacing, useTheme } from '@/theme';

interface InputProps extends TextInputProps {
  /** Leading glyph, e.g. a magnifier for search boxes. */
  icon?: IconName;
  /** The text input itself, for `focus()`. */
  inputRef?: Ref<TextInput>;
}

/** 48 dp borderless input on the muted fill; a primary ring marks focus. */
export function Input({ icon, inputRef, style, onFocus, onBlur, ...rest }: InputProps) {
  const { colors, fonts, radius } = useTheme();
  const [focused, setFocused] = useState(false);
  const reveal = useRevealFocusedInput();
  return (
    <View
      style={[
        styles.box,
        { backgroundColor: colors.muted, borderColor: focused ? colors.primary : 'transparent', borderRadius: radius.input },
      ]}>
      {icon ? <Ionicons name={icon} size={18} color={colors.mutedForeground} /> : null}
      <TextInput
        ref={inputRef}
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          reveal();
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.input, { color: colors.foreground, fontFamily: fonts.regular }, style]}
      />
    </View>
  );
}

interface FieldProps extends InputProps {
  label: string;
  hint?: string;
  children?: ReactNode;
}

/** Label above an Input. The label doubles as the accessibility label. */
export function Field({ label, hint, accessibilityLabel, ...input }: FieldProps) {
  return (
    <View style={styles.field}>
      <AppText variant="label" muted>
        {label}
      </AppText>
      <Input accessibilityLabel={accessibilityLabel ?? label} {...input} />
      {hint ? (
        <AppText variant="caption" muted>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  box: {
    minHeight: HIT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 2,
  },
  input: { flex: 1, minHeight: HIT, fontSize: fontSize.base, padding: 0 },
});

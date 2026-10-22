import { useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';

import { useRevealFocusedInput } from '@/components/keyboardReveal';
import { useTheme } from '@/theme';

interface BoundaryBoxProps {
  /** Accessibility label, e.g. "Zone 4 starts at (bpm)". */
  label: string;
  value: number;
  width: number;
  height: number;
  /** A typed whole number, not yet brought into range: the caller moves the limit, which keeps it between its neighbours. Omit for a fixed figure. */
  onCommit?: (value: number) => void;
  /** Drawn before the figure of a fixed box, e.g. the "≥" of the maximum. */
  prefix?: string;
}

/**
 * One boundary figure of the zone table: a tappable box that takes a typed number (a number pad, applied when the field loses focus or
 * "done" is pressed; while typing it keeps what was typed so a half-entered number is never rewritten), or, without `onCommit`, a plain figure.
 */
export function BoundaryBox({ label, value, width, height, onCommit, prefix }: BoundaryBoxProps) {
  const { colors, fonts, numeral, radius } = useTheme();
  const reveal = useRevealFocusedInput();
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const figure = { fontFamily: fonts.numeral, fontSize: numeral.sm.size, letterSpacing: numeral.sm.tracking, fontVariant: ['tabular-nums' as const] };

  if (!onCommit) {
    return (
      <Text
        accessibilityLabel={label}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        style={[styles.box, figure, { width, height, color: colors.mutedForeground }]}>
        {prefix ? `${prefix} ` : ''}
        {value}
      </Text>
    );
  }

  const commit = () => {
    setFocused(false);
    const typed = Number(text);
    if (text.trim() === '' || !Number.isFinite(typed)) return;
    onCommit(Math.round(typed));
  };

  return (
    <TextInput
      accessibilityLabel={label}
      value={focused ? text : String(value)}
      onChangeText={(next) => setText(next.replace(/\D/g, '').slice(0, 3))}
      onFocus={() => {
        setText(String(value));
        setFocused(true);
        reveal();
      }}
      onBlur={commit}
      onSubmitEditing={commit}
      keyboardType="number-pad"
      returnKeyType="done"
      maxLength={3}
      selectTextOnFocus
      selectionColor={colors.primary}
      style={[
        styles.box,
        figure,
        { width, height, color: colors.foreground, backgroundColor: colors.muted, borderColor: focused ? colors.primary : 'transparent', borderRadius: radius.input },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  box: { textAlign: 'center', textAlignVertical: 'center', borderWidth: 1.5, borderColor: 'transparent', padding: 0 },
});

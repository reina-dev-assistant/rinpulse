import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { EASE_OUT } from '@/components/motion';
import { PressableScale } from '@/components/PressableScale';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { fontSize, useTheme } from '@/theme';

const PAD = 3;
const GAP = 2;
const SLIDE_MS = 220;

interface SegmentedProps<T extends string | number> {
  options: readonly { value: T; label: string }[];
  /** Highlighted option; null/unmatched highlights nothing. */
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** Single-choice pill control; a pill in the primary color slides to the selected option and its label changes color with it. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: SegmentedProps<T>) {
  const { colors, fonts, radius } = useTheme();
  const reduced = useReducedMotion();
  // The track hugs its options by the 3 dp padding, so it is that much rounder; pills stay pills.
  const trackRadius = radius.control >= 999 ? radius.control : radius.control + 3;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [trackWidth, setTrackWidth] = useState(0);
  // The same position twice: the pill moves on the native thread, the label colors need the JS driver.
  const [slide] = useState(() => new Animated.Value(Math.max(0, selectedIndex)));
  const [tint] = useState(() => new Animated.Value(Math.max(0, selectedIndex)));
  const placed = useRef(false);

  useEffect(() => {
    if (selectedIndex < 0 || trackWidth === 0) return;
    if (!placed.current || reduced) {
      placed.current = true;
      slide.setValue(selectedIndex);
      tint.setValue(selectedIndex);
      return;
    }
    const run = Animated.parallel([
      Animated.timing(slide, { toValue: selectedIndex, duration: SLIDE_MS, easing: EASE_OUT, useNativeDriver: true }),
      Animated.timing(tint, { toValue: selectedIndex, duration: SLIDE_MS, easing: EASE_OUT, useNativeDriver: false }),
    ]);
    run.start();
    return () => run.stop();
  }, [selectedIndex, trackWidth, reduced, slide, tint]);

  const optionWidth = trackWidth > 0 ? (trackWidth - PAD * 2 - GAP * (options.length - 1)) / options.length : 0;

  return (
    <View
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      style={[styles.row, { backgroundColor: colors.muted, borderRadius: trackRadius }, disabled && styles.disabled]}
      accessibilityRole="radiogroup">
      {selectedIndex >= 0 && optionWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pill,
            {
              width: optionWidth,
              backgroundColor: colors.primary,
              borderRadius: radius.control,
              transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, optionWidth + GAP] }) }],
            },
          ]}
        />
      ) : null}
      {options.map((option, index) => {
        const selected = index === selectedIndex;
        const labelColor = tint.interpolate({
          inputRange: [index - 1, index, index + 1],
          outputRange: [colors.foreground, colors.primaryForeground, colors.foreground],
          extrapolate: 'clamp',
        });
        return (
          <PressableScale
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, disabled: !!disabled }}
            disabled={disabled}
            scaleTo={0.96}
            onPress={() => onChange(option.value)}
            style={[styles.option, { borderRadius: radius.control }]}>
            <Animated.Text
              style={[styles.label, { color: selectedIndex < 0 ? colors.foreground : labelColor, fontFamily: fonts.medium }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}>
              {option.label}
            </Animated.Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', padding: PAD, gap: GAP },
  disabled: { opacity: 0.55 },
  pill: { position: 'absolute', top: PAD, bottom: PAD, left: PAD },
  option: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  label: { fontSize: fontSize.sm },
});

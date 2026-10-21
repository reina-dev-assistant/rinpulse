import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useFloatingTabBarFootprint } from '@/components/useFloatingTabBarFootprint';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { spacing, useTheme } from '@/theme';

const VISIBLE_MS = 2200;

/**
 * A short confirmation that fades in over the content and out again on its own. `show` replaces a toast that is still
 * up; render `toast` last in the screen (inside the modal that owns it) so it sits on top.
 */
export function useToast(): { toast: ReactNode; show: (text: string) => void } {
  const { colors, radius } = useTheme();
  const footprint = useFloatingTabBarFootprint();
  const reduced = useReducedMotion();
  const [text, setText] = useState<string | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));
  const running = useRef<Animated.CompositeAnimation | null>(null);

  const show = useCallback(
    (next: string) => {
      running.current?.stop();
      setText(next);
      AccessibilityInfo.announceForAccessibility(next);
      const fade = (toValue: number, duration: number, easing: (t: number) => number) =>
        Animated.timing(opacity, { toValue, duration: reduced ? 0 : duration, easing, useNativeDriver: true });
      running.current = Animated.sequence([
        fade(1, 160, Easing.out(Easing.cubic)),
        Animated.delay(VISIBLE_MS),
        fade(0, 220, Easing.in(Easing.cubic)),
      ]);
      running.current.start(({ finished }) => {
        if (finished) setText(null);
      });
    },
    [opacity, reduced],
  );

  useEffect(() => () => running.current?.stop(), []);

  const toast =
    text === null ? null : (
      <View pointerEvents="none" style={[styles.anchor, { paddingBottom: footprint + spacing.lg }]}>
        <Animated.View
          accessibilityLiveRegion="polite"
          style={[
            styles.pill,
            { opacity, backgroundColor: colors.hero, borderRadius: radius.control, transform: [{ translateY: opacity.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] },
          ]}>
          <Ionicons name="checkmark-circle" size={18} color={colors.heroAccent} />
          <AppText variant="label" color={colors.heroForeground}>
            {text}
          </AppText>
        </Animated.View>
      </View>
    );

  return { toast, show };
}

const styles = StyleSheet.create({
  anchor: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end', alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.lg },
});

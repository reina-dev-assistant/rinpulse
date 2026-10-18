import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/theme';

import type { AlertKind } from '../types';
import type { RidePalette } from './ridePalette';

/** The alerts that must be seen at a glance get the high-contrast fill; the rest sit on the quiet surface. */
const URGENT: Record<AlertKind, boolean> = {
  hrHigh: true,
  hrLow: false,
  powerHigh: false,
  powerLow: false,
  cadenceLow: false,
  cadenceHigh: false,
  eat: false,
  drink: false,
  offCourse: true,
  backOnCourse: false,
  lowBattery: true,
  sensorLost: true,
  gpsLost: true,
  gpsBack: false,
  autoLap: false,
  turn: false,
};

export const isUrgentAlert = (kind: AlertKind): boolean => URGENT[kind];

/** Fade in, ease-out, 150 ms; no movement. */
const FADE_MS = 150;

interface AlertBannerProps {
  text: string;
  /** `urgent`: highest contrast fill. `danger`: the off-course red, persistent and not dismissable. `quiet`: surface. */
  tone: 'urgent' | 'danger' | 'quiet';
  palette: RidePalette;
  /** Leave out for a banner that stays (off course). */
  onDismiss?: () => void;
}

/** A banner over the top of the page area. One tap dismisses an alert; the off-course banner stays until the rider is back. */
export function AlertBanner({ text, tone, palette, onDismiss }: AlertBannerProps) {
  const { t } = useTranslation('bikecomp');
  const { fonts } = useTheme();
  const [opacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const run = Animated.timing(opacity, { toValue: 1, duration: FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [opacity]);

  const fill = tone === 'urgent' ? palette.urgent : tone === 'danger' ? palette.offCourse : palette.surface;
  const ink = tone === 'urgent' ? palette.onUrgent : tone === 'danger' ? palette.onOffCourse : palette.foreground;

  return (
    <Animated.View style={{ opacity }}>
      <Pressable
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        accessibilityLabel={text}
        accessibilityHint={onDismiss ? t('alert.dismiss') : undefined}
        disabled={!onDismiss}
        onPress={onDismiss}
        style={[styles.banner, { backgroundColor: fill, borderColor: palette.foreground, borderBottomWidth: tone === 'quiet' ? StyleSheet.hairlineWidth : 0 }]}>
        <Text allowFontScaling={false} style={[styles.text, { color: ink, fontFamily: fonts.heavy }]}>
          {text}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: { minHeight: 64, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center' },
  text: { fontSize: 22, lineHeight: 28 },
});

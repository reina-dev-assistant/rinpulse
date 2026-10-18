import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { radius as fixedRadius, spacing, useTheme } from '@/theme';

import { restLeftSec } from '../draft';
import { timerText } from '../logFormat';
import type { StrengthDraft } from '../types';
import { useTicker } from './useStrengthDraft';

interface RestBarProps {
  rest: NonNullable<StrengthDraft['rest']>;
  /** `draft.pausedAt`: the countdown stands still while the workout is paused. */
  pausedAt: number | null;
  onAdjust: (deltaSec: number) => void;
  onSkip: () => void;
  /** The timer ran out while the bar was showing. */
  onEnded: () => void;
}

export const REST_STEP_SEC = 15;

/** The sticky rest timer: time left, a progress track, -15 s, +15 s and skip. */
export function RestBar({ rest, pausedAt, onAdjust, onSkip, onEnded }: RestBarProps) {
  const { t } = useTranslation('strength');
  const { colors, radius } = useTheme();
  const now = useTicker(pausedAt === null, 250);
  const secondsLeft = restLeftSec({ rest, pausedAt }, now);
  const ended = useRef(false);

  useEffect(() => {
    ended.current = false;
  }, [rest.endsAt]);
  useEffect(() => {
    if (secondsLeft === null && !ended.current) {
      ended.current = true;
      onEnded();
    }
  }, [secondsLeft, onEnded]);

  const shown = secondsLeft ?? 0;
  const progress = rest.totalSec > 0 ? Math.min(1, Math.max(0, shown / rest.totalSec)) : 0;
  return (
    <View style={[styles.bar, { backgroundColor: colors.hero, borderRadius: radius.card }]}>
      <View
        accessible
        accessibilityRole="timer"
        accessibilityLabel={t('rest.left', { value: timerText(shown) })}
        style={styles.timeBox}>
        <Ionicons name="timer-outline" size={20} color={colors.heroAccent} />
        <AppText variant="heading" color={colors.heroForeground}>
          {timerText(shown)}
        </AppText>
      </View>
      <View style={[styles.track, { backgroundColor: colors.heroTrack }]}>
        <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: colors.heroAccent }]} />
      </View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('rest.minus', { value: REST_STEP_SEC })}
        onPress={() => onAdjust(-REST_STEP_SEC)}
        style={[styles.button, { backgroundColor: colors.heroTrack }]}>
        <AppText variant="label" color={colors.heroForeground}>
          {t('rest.minusShort', { value: REST_STEP_SEC })}
        </AppText>
      </PressableScale>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('rest.plus', { value: REST_STEP_SEC })}
        onPress={() => onAdjust(REST_STEP_SEC)}
        style={[styles.button, { backgroundColor: colors.heroTrack }]}>
        <AppText variant="label" color={colors.heroForeground}>
          {t('rest.plusShort', { value: REST_STEP_SEC })}
        </AppText>
      </PressableScale>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('rest.skip')}
        onPress={onSkip}
        style={[styles.button, { backgroundColor: colors.heroForeground }]}>
        <AppText variant="label" color={colors.hero}>
          {t('rest.skip')}
        </AppText>
      </PressableScale>
    </View>
  );
}

/** Shown for a moment when the rest is over. */
export function RestOverBanner() {
  const { t } = useTranslation('strength');
  const { colors, radius } = useTheme();
  return (
    <View accessibilityLiveRegion="assertive" style={[styles.bar, styles.over, { backgroundColor: colors.primary, borderRadius: radius.card }]}>
      <Ionicons name="notifications" size={20} color={colors.primaryForeground} />
      <AppText variant="bodyStrong" color={colors.primaryForeground}>
        {t('rest.over')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 60 },
  over: { justifyContent: 'center' },
  timeBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minWidth: 84 },
  track: { flex: 1, height: 6, borderRadius: fixedRadius.pill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: fixedRadius.pill },
  button: { minHeight: 36, minWidth: 44, paddingHorizontal: spacing.sm, borderRadius: fixedRadius.pill, alignItems: 'center', justifyContent: 'center' },
});

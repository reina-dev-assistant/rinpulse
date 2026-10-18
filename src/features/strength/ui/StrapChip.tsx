import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { fmtInt } from '@/i18n';
import { heartZone } from '@/features/live/liveWorkout';
import { defaultPalette } from '@/features/workouts/analysis/ui';
import { userMaxHr } from '@/features/workouts/useWorkoutStrain';
import { radius, spacing, useTheme } from '@/theme';

import { useStrapChip } from '../useStrengthHr';

/**
 * The heart rate strap in the session header: heart, bpm and the zone (number and colour). Dimmed with "looking for the strap" while it
 * connects and with "waiting" while it is connected but has no reading. Nothing without a running strap. Its own component: it redraws
 * every second with the heart rate, the workout does not.
 */
export function StrapChip({ workoutId }: { workoutId: string | null }) {
  const { t } = useTranslation('strength');
  const { colors, scheme } = useTheme();
  const chip = useStrapChip(workoutId);
  const maxHr = useMemo(() => userMaxHr(), []);
  if (!chip) return null;

  const bpm = chip.state === 'live' ? chip.bpm : null;
  const zone = bpm !== null ? heartZone(bpm, maxHr) : null;
  const iconColor = zone ? defaultPalette(scheme === 'dark').zones[zone.zone - 1] : bpm !== null ? colors.heart : colors.mutedForeground;
  const live = bpm !== null;
  const text = bpm !== null ? fmtInt(bpm) : t(chip.state === 'waiting' ? 'hr.waiting' : 'hr.searching');
  const label =
    bpm === null
      ? t(chip.state === 'waiting' ? 'hr.waitingA11y' : 'hr.searchingA11y')
      : zone
        ? t('hr.chipA11yZone', { bpm, zone: zone.zone, label: zone.label })
        : t('hr.chipA11y', { bpm });

  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[styles.chip, { backgroundColor: live ? colors.heartSoft : colors.muted, borderRadius: radius.pill }, !live && styles.dim]}>
      <Ionicons name={live ? 'heart' : 'heart-outline'} size={14} color={iconColor} />
      <AppText variant="label" color={live ? colors.heartText : colors.mutedForeground} style={styles.tabular} numberOfLines={1}>
        {text}
      </AppText>
      {zone ? (
        <AppText variant="label" color={colors.heartText} style={styles.tabular}>
          {t('hr.zoneShort', { zone: zone.zone })}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  dim: { opacity: 0.7 },
  tabular: { fontVariant: ['tabular-nums'] },
});

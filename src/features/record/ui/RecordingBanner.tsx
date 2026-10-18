import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { SPORT_ROWS } from '@/features/workouts/manual';
import { sportLabel } from '@/features/workouts/sportLabel';
import { formatElapsed } from '@/features/workouts/summary';
import { fmtDistance } from '@/i18n';
import { useRecorder } from '@/state/RecorderProvider';
import { spacing, useTheme } from '@/theme';

import { isLive, liveState, LIVE_ROUTE, OPEN_LIVE } from '../liveRoute';

/** "Sedang merekam, Lari 23:14 2,4 km": a card that opens the recording. Renders nothing while no recording is prepared or running. Pinned above the Workouts list. */
export function RecordingBanner(): ReactElement | null {
  const { t } = useTranslation('workouts');
  const router = useRouter();
  const { colors, radius } = useTheme();
  const { snapshot } = useRecorder();
  if (!isLive(snapshot.phase) || snapshot.sport === null) return null;

  const { live, status } = snapshot;
  const state = liveState(snapshot.phase, status);
  const sport = sportLabel(SPORT_ROWS[snapshot.sport].name);
  const title = t(`record.banner.${state}`);
  const icon = state === 'ready' ? 'locate' : state === 'paused' ? 'pause-circle' : 'radio-button-on';
  const detail = live
    ? t('record.banner.progress', { sport, time: formatElapsed(live.movingSec), distance: fmtDistance(live.distanceM) })
    : sport;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t('record.banner.a11y', { title, detail })}
      onPress={() => router.navigate(LIVE_ROUTE, OPEN_LIVE)}
      scaleTo={0.985}
      style={[styles.card, { backgroundColor: colors.hero, borderRadius: radius.card }]}>
      <Ionicons name={icon} size={24} color={colors.heroAccent} />
      <View style={styles.text}>
        <AppText variant="bodyStrong" color={colors.heroForeground}>
          {title}
        </AppText>
        <AppText variant="caption" color={colors.heroMuted}>
          {detail}
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.heroMuted} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, minHeight: 64 },
  text: { flex: 1, gap: 1 },
});

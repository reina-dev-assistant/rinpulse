import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { SPORT_ROWS } from '@/features/workouts/manual';
import { sportLabel } from '@/features/workouts/sportLabel';
import { formatElapsed } from '@/features/workouts/summary';
import { useRecorder } from '@/state/RecorderProvider';
import { radius, spacing, useTheme } from '@/theme';

import { liveState, LIVE_ROUTE, OPEN_LIVE, showLivePill } from '../liveRoute';

/**
 * The way back into a recording from any tab: "Merekam, Lari 23:14", drawn directly above the tab bar (the root `tabBar`), so it never
 * covers content. Hidden on the live screen itself, where the tab bar is hidden (`tabBarHidden`) and while nothing is recorded.
 */
export function LivePill({ tabBarHidden }: { tabBarHidden: boolean }): ReactElement | null {
  const { t } = useTranslation('workouts');
  const router = useRouter();
  const pathname = usePathname();
  const { colors } = useTheme();
  const { snapshot } = useRecorder();
  if (!showLivePill({ phase: snapshot.phase, sport: snapshot.sport, pathname, tabBarHidden }) || snapshot.sport === null) return null;

  const { live, status } = snapshot;
  const state = liveState(snapshot.phase, status);
  const sport = sportLabel(SPORT_ROWS[snapshot.sport].name);
  const statusText = t(`liveEntry.${state}`);
  const detail = live ? t('liveEntry.detail', { sport, time: formatElapsed(live.movingSec) }) : sport;
  const icon = state === 'ready' ? 'locate' : state === 'paused' ? 'pause-circle' : 'radio-button-on';

  return (
    <View pointerEvents="box-none" style={styles.bar}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('liveEntry.a11y', { status: statusText, detail })}
        onPress={() => router.navigate(LIVE_ROUTE, OPEN_LIVE)}
        scaleTo={0.98}
        style={[styles.pill, { backgroundColor: colors.hero }]}>
        <Ionicons name={icon} size={20} color={colors.heroAccent} />
        <View style={styles.text}>
          <AppText variant="bodyStrong" color={colors.heroForeground} numberOfLines={1}>
            {statusText}
          </AppText>
          <AppText variant="caption" color={colors.heroMuted} numberOfLines={1}>
            {detail}
          </AppText>
        </View>
        <Ionicons name="chevron-up" size={18} color={colors.heroMuted} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 48, borderRadius: radius.pill },
  text: { flex: 1 },
});

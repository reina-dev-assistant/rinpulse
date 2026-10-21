import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Notice } from '@/components/States';
import { radius, spacing, useTheme } from '@/theme';

import { useStrengthWatchStart, useWatchChip } from '../useStrengthWatch';
import { refusedNoticeKey } from '../watchWorkout';

/**
 * The watch in the session header: a small "Jam" chip while Strength training runs on the watch (dimmed while paused or when the watch never
 * confirmed the start; its accessibility label says which). Nothing without a watch workout. Its own component: it follows the watch,
 * the workout does not redraw for it.
 */
export function WatchChip({ workoutId }: { workoutId: string | null }) {
  const { t } = useTranslation('strength');
  const { colors } = useTheme();
  const phase = useWatchChip(workoutId);
  if (phase === null) return null;

  const label = phase === 'paused' ? t('watch.paused') : phase === 'unconfirmed' ? t('watch.unconfirmed') : t('watch.running');
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[styles.chip, { backgroundColor: colors.muted, borderRadius: radius.pill }, phase !== 'running' && styles.dim]}>
      <Ionicons name={phase === 'running' ? 'watch' : 'watch-outline'} size={14} color={colors.mutedForeground} />
      <AppText variant="label" color={colors.mutedForeground} numberOfLines={1}>
        {t('watch.chip')}
      </AppText>
    </View>
  );
}

/**
 * Starts the watch with the logger (once per workout, `useStrengthWatchStart`) and says what did not work: the watch is not connected
 * (it starts by itself once it is), it refused, or the workout was started before the app restarted. Nothing when it works, when the
 * setting is off and for watches that cannot be started from the phone. `wanted`: the logger is ready, shows a workout in progress and the
 * setting is on; `startedAt`: when the workout began (an old one does not start the watch).
 */
export function WatchNotice({ workoutId, wanted, startedAt }: { workoutId: string | null; wanted: boolean; startedAt: number | null }) {
  const { t } = useTranslation('strength');
  const { watch, retry } = useStrengthWatchStart(workoutId, wanted, startedAt);

  if (watch.view === 'offline') return <Notice icon="watch-outline">{t('watch.notConnected')}</Notice>;
  if (watch.view === 'lost') return <Notice icon="watch-outline">{t('watch.lost')}</Notice>;
  if (watch.view === 'failed') {
    const text = watch.outcome === 'refused' ? t(refusedNoticeKey(watch.code, watch.worn), { code: watch.code }) : t('watch.notConnected');
    return (
      <Notice icon="watch-outline" action={{ label: t('watch.retry'), onPress: retry }}>
        {text}
      </Notice>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  dim: { opacity: 0.7 },
});

import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { spacing, useTheme } from '@/theme';

import { draftProgress, elapsedMs } from '../draft';
import { timerText } from '../logFormat';
import { resumeStrengthWorkout } from '../start';
import { loadDraft } from '../store';
import type { StrengthDraft } from '../types';
import { useTicker } from './useStrengthDraft';

/** "Workout in progress, 23:14, 5 of 12 sets": a card that opens the logger. Renders nothing when no workout is in progress. */
export function ActiveWorkoutBanner(): ReactElement | null {
  const db = useSQLiteContext();
  const [draft, setDraft] = useState<StrengthDraft | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadDraft(db).then(
        (found) => {
          if (!cancelled) setDraft(found);
        },
        () => undefined,
      );
      return () => {
        cancelled = true;
      };
    }, [db]),
  );

  if (!draft) return null;
  return <Card draft={draft} />;
}

function Card({ draft }: { draft: StrengthDraft }) {
  const { t } = useTranslation('strength');
  const { colors, radius } = useTheme();
  const now = useTicker(draft.pausedAt === null);
  const { doneSets, totalSets } = draftProgress(draft);
  const clock = timerText(elapsedMs(draft, now) / 1000);
  const summary = t('banner.progress', { done: doneSets, total: totalSets });
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t('banner.label', { time: clock, progress: summary })}
      onPress={resumeStrengthWorkout}
      scaleTo={0.985}
      style={[styles.card, { backgroundColor: colors.hero, borderRadius: radius.card }]}>
      <Ionicons name={draft.pausedAt === null ? 'barbell' : 'pause-circle'} size={24} color={colors.heroAccent} />
      <View style={styles.text}>
        <AppText variant="bodyStrong" color={colors.heroForeground}>
          {draft.pausedAt === null ? t('banner.title') : t('banner.titlePaused')}
        </AppText>
        <AppText variant="caption" color={colors.heroMuted}>
          {`${clock} - ${summary}`}
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

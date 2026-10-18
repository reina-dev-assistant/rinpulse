import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { IconAction } from '@/features/courses/IconAction';
import { useLocale } from '@/i18n';
import { spacing } from '@/theme';

import type { Catalog } from '../catalog';
import { routineSetCount } from '../routineEdit';
import type { Routine } from '../types';

/** Exercises named in the summary line; the rest is "+N". */
const SUMMARY_NAMES = 3;

interface RoutineRowProps {
  routine: Routine;
  catalog: Catalog;
  /** Opens the preview sheet. */
  onOpen: (routine: Routine) => void;
  /** Starts the workout straight away. */
  onStart: (routine: Routine) => void;
}

/** A routine in a list: name, the first exercises, the number of sets; a tap opens the preview, the play button starts it. */
export const RoutineRow = memo(function RoutineRow({ routine, catalog, onOpen, onStart }: RoutineRowProps) {
  const { t } = useTranslation('routines');
  const locale = useLocale();
  const names = routine.exercises.slice(0, SUMMARY_NAMES).map((e) => catalog.name(e.exerciseId, locale) ?? t('row.removedExercise'));
  const more = routine.exercises.length - names.length;
  const summary = more > 0 ? t('row.summaryMore', { names: names.join(', '), count: more }) : names.join(', ');
  const sets = t('row.sets', { count: routineSetCount(routine) });
  return (
    <View style={styles.row}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('row.open', { name: routine.name })}
        onPress={() => onOpen(routine)}
        scaleTo={0.985}
        style={styles.main}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {routine.name}
        </AppText>
        {summary.length > 0 ? (
          <AppText variant="caption" muted numberOfLines={1}>
            {summary}
          </AppText>
        ) : null}
        <AppText variant="caption" muted numberOfLines={1}>
          {sets}
        </AppText>
      </PressableScale>
      <IconAction icon="play" label={t('row.start', { name: routine.name })} onPress={() => onStart(routine)} />
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg, paddingRight: spacing.sm },
  main: { flex: 1, minHeight: 72, justifyContent: 'center', paddingVertical: spacing.sm, gap: 1 },
});

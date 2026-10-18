import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { NavRow } from '@/components/NavRow';
import { Section } from '@/components/Screen';
import { startStrengthWorkout } from '@/features/strength/start';
import { fmtInt, getLocale, useLocale } from '@/i18n';
import { spacing } from '@/theme';
import { exerciseById, exerciseName } from '../exercises';
import { exerciseLine, sessionTitle } from '../format';
import type { PlannedSession } from '../plans/types';

/**
 * The exercises of a strength session with sets, reps (or seconds) and rest, each opening its page in the library, and the button
 * that starts the logger for this plan session. `todayScalePct` is today's suggestion scaling (under 100 cuts the sets). The watch
 * does not report repetitions, so they are logged in the logger.
 */
export function StrengthSessionSection({ session, todayScalePct, canStart }: { session: PlannedSession; todayScalePct: number; canStart: boolean }) {
  const { t } = useTranslation('coach');
  useLocale();
  const router = useRouter();
  const exercises = session.strength?.exercises ?? [];
  const scale = todayScalePct > 0 && todayScalePct < 100 ? todayScalePct / 100 : 1;
  const planned = exercises.map((e) => ({ ...e, sets: Math.max(1, Math.round(e.sets * scale)) }));

  return (
    <Section title={t('session.strength.title')} icon="barbell" tint="workouts">
      <AppText variant="caption" muted>
        {t('session.strength.warmup')}
      </AppText>
      <View style={styles.list}>
        {planned.map((e) => {
          const def = exerciseById(e.exerciseId);
          return (
            <NavRow
              key={e.exerciseId}
              icon="barbell-outline"
              tint="workouts"
              title={def ? exerciseName(def, getLocale()) : e.exerciseId}
              subtitle={exerciseLine(e)}
              onPress={() => router.push({ pathname: '/coach/library/[id]', params: { id: e.exerciseId } })}
            />
          );
        })}
      </View>
      {scale < 1 ? (
        <AppText variant="caption" muted>
          {t('session.strength.scaled', { pct: fmtInt(todayScalePct) })}
        </AppText>
      ) : null}
      <AppText variant="caption" muted>
        {t('session.strength.reps')}
      </AppText>
      {canStart ? (
        <Button
          label={t('session.strength.start')}
          variant="primary"
          icon="play"
          onPress={() => startStrengthWorkout({ planKey: session.key, exercises: planned, name: sessionTitle(session) })}
        />
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
});

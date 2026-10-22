import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Metric } from '@/components/Metric';
import { Section } from '@/components/Screen';
import type { WorkoutRow } from '@/db/queries';
import { formatPace } from '@/features/workouts/analysis/types';
import type { WorkoutSummary } from '@/features/workouts/summary';
import { fmtDate, fmtInt, useTranslation } from '@/i18n';
import { spacing, useColors } from '@/theme';

import { useLactateTest } from '../lactate';
import { currentLactate, watchLactate, type LactateValue } from '../values';

/** Kebugaran: the lactate threshold (LTHR and pace), from the JoyoFit time trial or the watch, whichever is newer, and the way to the test. */
export function LactateCard({ workouts }: { workouts: readonly { workout: WorkoutRow; summary: WorkoutSummary }[] }) {
  const { t } = useTranslation('health');
  const router = useRouter();
  const colors = useColors();
  const test = useLactateTest();
  const found = useMemo(() => currentLactate(test, watchLactate(workouts)), [test, workouts]);

  const sourceText = (v: LactateValue) => t(v.source === 'test' ? 'lactate.card.fromTest' : 'lactate.card.fromWatch', { date: fmtDate(v.at, 'medium') });
  const paceText = (p: number) => `${formatPace(p)} ${t('lactate.unit.pace')}`;

  return (
    <Section title={t('lactate.card.title')} icon="speedometer" tint="heart">
      {found ? (
        <>
          <View style={styles.row}>
            <View style={styles.figure}>
              <AppText variant="caption" muted>
                {t('lactate.card.lthr')}
              </AppText>
              <Metric value={fmtInt(found.current.lthr)} unit={t('lactate.unit.bpm')} size="lg" color={colors.heartText} />
            </View>
            {found.current.paceSecKm !== null ? (
              <View style={styles.figure}>
                <AppText variant="caption" muted>
                  {t('lactate.card.pace')}
                </AppText>
                <Metric value={formatPace(found.current.paceSecKm)} unit={t('lactate.unit.pace')} size="lg" />
              </View>
            ) : null}
          </View>
          <AppText variant="caption" muted>
            {sourceText(found.current)}
          </AppText>
          {found.other ? (
            <KeyValue
              label={t(found.other.source === 'test' ? 'lactate.card.sourceTest' : 'lactate.card.sourceWatch')}
              value={found.other.paceSecKm !== null ? `${fmtInt(found.other.lthr)} ${t('lactate.unit.bpm')}, ${paceText(found.other.paceSecKm)}` : `${fmtInt(found.other.lthr)} ${t('lactate.unit.bpm')}`}
            />
          ) : null}
        </>
      ) : (
        <AppText variant="caption" muted>
          {t('lactate.card.empty')}
        </AppText>
      )}
      <Button label={t('lactate.card.open')} variant={found ? 'secondary' : 'primary'} icon="speedometer" onPress={() => router.push('/lactate-test')} />
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.lg },
  figure: { gap: 2 },
});

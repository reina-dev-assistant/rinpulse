import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { Section } from '@/components/Screen';
import { Sparkline } from '@/features/fitness/Sparkline';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { fmtDecimal, fmtInt, type TFunction } from '@/i18n';
import { spacing, useColors } from '@/theme';

import { DYNAMICS_METRICS, runningDynamics, type DynamicsMetric, type DynamicsSeries } from '../dynamics';
import type { WorkoutSummary } from '../summary';

function formatValue(t: TFunction<'workouts'>, metric: DynamicsMetric, value: number): string {
  switch (metric) {
    case 'gct':
      return t('detail.dynamics.gctValue', { value: fmtInt(value) });
    case 'vo':
      return t('detail.dynamics.voValue', { value: fmtDecimal(value, 1) });
    case 'vr':
      return t('detail.dynamics.vrValue', { value: fmtDecimal(value, 1) });
    case 'gtb':
      return t('detail.dynamics.gtbValue', { left: fmtDecimal(value, 1), right: fmtDecimal(100 - value, 1) });
  }
}

/**
 * Running form of a watch run: the means as a grid, and a per-minute line for each metric that has enough readings. Drawn only when the
 * watch sent at least one of them, so a workout without them shows nothing (no empty card).
 */
export function RunningDynamicsSection({ summary }: { summary: WorkoutSummary }) {
  const { t } = useTranslation('workouts');
  const colors = useColors();
  const dynamics = useMemo(() => runningDynamics(summary), [summary]);
  if (!dynamics) return null;

  const seriesOf = (metric: DynamicsMetric): DynamicsSeries | undefined => dynamics.series.find((s) => s.metric === metric);

  return (
    <Section title={t('detail.dynamics.title')} icon="speedometer" tint="workouts">
      <PairGrid>
        {DYNAMICS_METRICS.map((metric) => {
          const value = dynamics.averages[metric];
          return value === null ? null : <Pair key={metric} label={t(`detail.dynamics.${metric}`)} value={formatValue(t, metric, value)} />;
        })}
      </PairGrid>
      {DYNAMICS_METRICS.map((metric) => {
        const series = seriesOf(metric);
        if (!series) return null;
        const points = series.values.flatMap((v, i) => (v === null ? [] : [{ v, i }]));
        const label = t('detail.dynamics.chartLabel', { metric: t(`detail.dynamics.${metric}`) });
        return (
          <View key={metric} style={styles.chart}>
            <AppText variant="caption" muted>
              {t(`detail.dynamics.${metric}`)}
            </AppText>
            <Sparkline
              values={points.map((p) => p.v)}
              color={colors.workoutsText}
              label={label}
              readout={points.map((p) => ({
                title: t('detail.dynamics.minute', { n: p.i + 1 }),
                text: formatValue(t, metric, p.v),
              }))}
            />
          </View>
        );
      })}
      <Details title={t('detail.dynamics.how')}>{t('detail.dynamics.explain')}</Details>
    </Section>
  );
}

const styles = StyleSheet.create({
  chart: { gap: spacing.xs },
});

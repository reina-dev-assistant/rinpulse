import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { FamilyDay, FamilyScopes } from '@/cloud/family';
import { AppText } from '@/components/AppText';
import { Chip } from '@/components/Chip';
import { dateToLocalMidnightSec, daySeries } from '@/features/family/format';
import { TrendChart } from '@/features/trends/TrendChart';
import { fmtDecimal, fmtInt } from '@/i18n';
import { spacing, tintColors, useColors, type Tint } from '@/theme';

type Metric = 'steps' | 'restingHr' | 'sleep';

const METRICS: readonly {
  key: Metric;
  scope: keyof FamilyScopes;
  tint: Tint;
  kind: 'bar' | 'line';
  pick: (day: FamilyDay) => number | null;
}[] = [
  { key: 'steps', scope: 'steps', tint: 'steps', kind: 'bar', pick: (day) => day.steps },
  { key: 'restingHr', scope: 'restingHr', tint: 'heart', kind: 'line', pick: (day) => day.restingHr },
  { key: 'sleep', scope: 'sleep', tint: 'sleep', kind: 'bar', pick: (day) => (day.sleepMin === null ? null : day.sleepMin / 60) },
];

interface FamilyTrendProps {
  days: readonly FamilyDay[];
  /** How many calendar days the chart spans. */
  range: number;
  /** Only the categories the person shares get a chart. */
  scopes: FamilyScopes;
  /** The usual resting heart rate, drawn as a dashed line on its chart; null until the server has one. */
  baseline: number | null;
}

/** Steps, resting heart rate or sleep over the last 7, 30 or 90 days, as far as the person shares them. */
export function FamilyTrend({ days, range, scopes, baseline }: FamilyTrendProps) {
  const { t } = useTranslation('family');
  const colors = useColors();
  const available = METRICS.filter((metric) => scopes[metric.scope]);
  const [chosen, setChosen] = useState<Metric>('steps');
  const metric = available.find((m) => m.key === chosen) ?? available[0];

  if (!metric) {
    return (
      <AppText variant="caption" muted>
        {t('trendChart.noScope')}
      </AppText>
    );
  }

  const metricLabel = t(`trendChart.${metric.key}`);
  const series = daySeries(days, range, metric.pick);
  const empty = series.firstDate === null || series.values.every((v) => v === null);

  return (
    <View style={styles.wrap}>
      <View style={styles.chips}>
        {available.map((m) => (
          <Chip key={m.key} label={t(`trendChart.${m.key}`)} selected={m.key === metric.key} onPress={() => setChosen(m.key)} role="radio" />
        ))}
      </View>
      {series.firstDate === null || empty ? (
        <AppText variant="caption" muted>
          {t('trendChart.noData', { metric: metricLabel.toLowerCase() })}
        </AppText>
      ) : (
        <TrendChart
          values={series.values}
          kind={metric.kind}
          format={(v) =>
            metric.key === 'steps'
              ? t('trendChart.valueSteps', { value: fmtInt(v) })
              : metric.key === 'sleep'
                ? t('trendChart.valueSleep', { value: fmtDecimal(v, 1) })
                : t('trendChart.valueRestingHr', { value: fmtInt(v) })
          }
          color={tintColors(colors, metric.tint).base}
          firstDay={dateToLocalMidnightSec(series.firstDate)}
          average={metric.key === 'restingHr' ? baseline : null}
          endLabel={t('trendChart.latest')}
          label={t('trendChart.a11y', { metric: metricLabel.toLowerCase(), count: range })}
        />
      )}
      {metric.key === 'restingHr' && baseline !== null && !empty ? (
        <AppText variant="caption" muted>
          {t('trendChart.baseline', { bpm: Math.round(baseline) })}
        </AppText>
      ) : null}
      {metric.key === 'sleep' && !empty ? (
        <AppText variant="caption" muted>
          {t('trendChart.sleepBars')}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

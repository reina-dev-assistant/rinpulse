import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BarChart, type BarDatum } from '@/components/BarChart';
import { Metric } from '@/components/Metric';
import { Segmented } from '@/components/Segmented';
import { fmtDate, fmtDecimal, fmtDistance, fmtDuration, fmtInt, useLocale } from '@/i18n';
import { spacing, useTheme } from '@/theme';
import {
  aggregateProgress,
  progressIsEmpty,
  PROGRESS_BUCKETS,
  type ProgressKind,
  type ProgressPeriod,
  type ProgressRow,
} from '../progress';
import { workoutDistanceParts } from '../summary';

const BAR_AREA_HEIGHT = 96;
const LABEL_EVERY = 4;
/** A difference under 10 m reads as "the same". */
const SAME_UNDER_M = 10;

interface ProgressCardProps {
  kind: ProgressKind;
  rows: readonly ProgressRow[];
  /** Unix seconds the rows were read at; decides which week or month is the current one. */
  nowSec: number;
  period: ProgressPeriod;
  onPeriodChange: (period: ProgressPeriod) => void;
}

/** Strava-style summary of one sport: this week's or month's totals against the last one, and distance per period for 12 periods. */
export function ProgressCard({ kind, rows, nowSec, period, onPeriodChange }: ProgressCardProps) {
  const { colors, radius } = useTheme();
  const { t } = useTranslation('workouts');
  const locale = useLocale();
  const progress = useMemo(() => aggregateProgress(rows, kind, period, nowSec), [rows, kind, period, nowSec]);
  const { current, previous, buckets } = progress;
  const distance = workoutDistanceParts(current.distance);
  const diff = current.distance - previous.distance;
  const trend = previous.count === 0 ? 'none' : Math.abs(diff) < SAME_UNDER_M ? 'same' : diff > 0 ? 'up' : 'down';
  const compare = t(`progress.compare.${trend}.${period}`, { value: fmtDistance(Math.abs(diff)) });
  const trendIcon = trend === 'up' ? 'arrow-up' : trend === 'down' ? 'arrow-down' : 'remove';
  const chartData: BarDatum[] = buckets.map((bucket, i) => ({
    key: bucket.start,
    value: bucket.distance,
    title: period === 'week' ? t('progress.weekOf', { date: fmtDate(bucket.start, 'medium', locale) }) : fmtDate(bucket.start, 'month', locale),
    text: fmtDistance(bucket.distance),
    short: fmtDecimal(bucket.distance / 1000, 1, locale),
    dim: i !== PROGRESS_BUCKETS - 1,
  }));
  const dateStyle = period === 'week' ? 'short' : 'monthShort';

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderRadius: radius.card }]}>
      <View style={styles.head}>
        <AppText variant="label" muted accessibilityRole="header" style={styles.title}>
          {t(`progress.current.${period}`)}
        </AppText>
        <View style={styles.toggle} accessibilityLabel={t('progress.periodA11y')}>
          <Segmented
            options={[
              { value: 'week', label: t('progress.period.week') },
              { value: 'month', label: t('progress.period.month') },
            ]}
            value={period}
            onChange={onPeriodChange}
          />
        </View>
      </View>

      <Metric value={distance.value} unit={distance.unit} size="lg" />
      <View style={styles.compare}>
        <Ionicons name={trendIcon} size={14} color={colors.mutedForeground} />
        <AppText variant="caption" muted style={styles.compareText}>
          {compare}
        </AppText>
      </View>

      <View style={styles.stats}>
        <Stat label={t('progress.stat.time')} value={fmtDuration(current.movingSec)} />
        {kind !== 'swim' ? <Stat label={t('progress.stat.elevation')} value={`${fmtInt(current.gain)} ${t('analysis.unit.m')}`} /> : null}
        <Stat label={t('progress.stat.count')} value={fmtInt(current.count)} />
      </View>

      <View style={styles.chart}>
        <AppText variant="caption" muted>
          {t(`progress.chart.${period}`)}
        </AppText>
        {progressIsEmpty(progress) ? (
          <AppText variant="caption" muted>
            {t(`progress.empty.${period}`, { sport: t(`progress.kind.${kind}`) })}
          </AppText>
        ) : (
          <BarChart
            data={chartData}
            color={colors.workouts}
            height={BAR_AREA_HEIGHT}
            gap={4}
            tick={(i) => (i % LABEL_EVERY === 0 ? fmtDate(buckets[i]!.start, dateStyle, locale) : null)}
            tickWidth={44}
          />
        )}
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="caption" muted numberOfLines={1}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md + 4, gap: spacing.sm, marginBottom: spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  title: { flexShrink: 1 },
  toggle: { width: 170 },
  compare: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  compareText: { flex: 1 },
  stats: { flexDirection: 'row', gap: spacing.md },
  stat: { flex: 1, gap: 2 },
  chart: { gap: spacing.sm, marginTop: spacing.xs },
});

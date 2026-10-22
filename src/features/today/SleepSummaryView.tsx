import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { KeyValue } from '@/components/KeyValue';
import { Metric } from '@/components/Metric';
import { EmptyState } from '@/components/States';
import { formatClock, formatDuration } from '@/format';
import { fmtPercent } from '@/i18n';
import type { SleepScoreRow } from '@/db/queries';
import { NoStagesNotice } from '@/features/sleep/NoStagesNotice';
import { SleepScoreRing } from '@/features/sleep/SleepScoreRing';
import { STAGE_LABELS, stageColor } from '@/features/sleep/stageStyle';
import type { SleepSummary } from '@/features/today/stats';
import { radius, spacing, useColors } from '@/theme';

export function SleepSummaryView({ summary, score }: { summary: SleepSummary | null; score: SleepScoreRow | null }) {
  const colors = useColors();
  const { t } = useTranslation('today');
  if (!summary) {
    return (
      <EmptyState
        icon="moon"
        title={t('sleep.emptyTitle')}
        description={t('sleep.emptyDescription')}
      />
    );
  }

  const hasStages = summary.byStage.length > 0;
  const headlineSeconds = summary.dayAsleepSeconds;
  const napSeconds = summary.naps.reduce((sum, nap) => sum + nap.seconds, 0);
  const minutes = Math.round(headlineSeconds / 60);

  return (
    <View style={styles.wrap}>
      <View style={styles.headlineRow}>
        <View style={styles.headlineText}>
          <View accessible accessibilityLabel={t('sleep.sleptA11y', { duration: formatDuration(headlineSeconds) })} style={styles.headline}>
            {minutes >= 60 ? <Metric value={String(Math.floor(minutes / 60))} unit={t('units.h')} size="lg" color={colors.sleepText} unitColor={colors.mutedForeground} /> : null}
            <Metric value={String(minutes % 60).padStart(minutes >= 60 ? 2 : 1, '0')} unit={t('units.min')} size="lg" color={colors.sleepText} unitColor={colors.mutedForeground} />
          </View>
          <AppText variant="caption" muted>
            {t(hasStages ? 'sleep.rangeStages' : 'sleep.rangeNoStages', { start: formatClock(summary.start), end: formatClock(summary.end) })}
          </AppText>
          {summary.naps.length > 0 ? (
            <AppText variant="caption" muted>
              {t('sleep.napsIncluded', { duration: formatDuration(napSeconds) })}
            </AppText>
          ) : null}
        </View>
        {score ? <SleepScoreRing score={score} /> : null}
      </View>
      {summary.naps.map((nap) => (
        <KeyValue
          key={nap.start}
          label={t('sleep.nap', { start: formatClock(nap.start), end: formatClock(nap.end) })}
          value={formatDuration(nap.seconds)}
        />
      ))}
      {hasStages ? (
        <>
          <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.stageBar}>
            {summary.byStage.map((entry) => (
              <View key={entry.stage} style={{ flex: entry.seconds, backgroundColor: stageColor(entry.stage, colors) }} />
            ))}
          </View>
          <View style={styles.legend}>
            {summary.byStage.map((entry) => (
              <View key={entry.stage} style={styles.legendRow}>
                <View style={[styles.swatch, { backgroundColor: stageColor(entry.stage, colors) }]} />
                <AppText variant="caption" numberOfLines={1} style={styles.legendLabel}>
                  {STAGE_LABELS[entry.stage]}
                </AppText>
                <AppText variant="label" style={styles.tabular}>
                  {formatDuration(entry.seconds)} <AppText variant="caption" muted>{fmtPercent((entry.seconds / summary.totalSeconds) * 100)}</AppText>
                </AppText>
              </View>
            ))}
          </View>
          <Details>{t('sleep.stagesNote')}</Details>
        </>
      ) : (
        <>
          <NoStagesNotice />
          {summary.byType.map((entry) => (
            <KeyValue
              key={entry.type}
              label={t('sleep.type', { type: entry.type })}
              value={t('sleep.typeValue', { count: entry.count, duration: formatDuration(entry.seconds) })}
            />
          ))}
          <Details>{t('sleep.typesNote')}</Details>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  headlineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headlineText: { flex: 1, gap: 2 },
  headline: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  stageBar: { flexDirection: 'row', height: 14, gap: 2, borderRadius: radius.pill, overflow: 'hidden', marginVertical: spacing.xs },
  legend: { gap: spacing.xs },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 24 },
  swatch: { width: 12, height: 12, borderRadius: 6 },
  legendLabel: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
});

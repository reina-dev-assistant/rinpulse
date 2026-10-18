import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Details } from '@/components/Details';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';
import { loadBarFractions, loadVerdict, type LoadVerdict } from '@/features/workouts/analysis/ui/chartMath';
import { useAnalysisContext } from '@/features/workouts/analysis/ui/context';
import { Bar, Card, Chip, Txt } from '@/features/workouts/analysis/ui/primitives';
import type { AnalysisPalette } from '@/features/workouts/analysis/ui/theme';
import { fmtInt } from '@/i18n';

import type { RideLoad } from '../types';

const VERDICT_ICON: Record<LoadVerdict, keyof typeof Ionicons.glyphMap> = {
  under: 'trending-down',
  steady: 'remove',
  high: 'trending-up',
  spike: 'warning',
};

function verdictColor(palette: AnalysisPalette, verdict: LoadVerdict): string {
  return { under: palette.zones[0], steady: palette.positive, high: palette.zones[3], spike: palette.negative }[verdict];
}

function LoadBar({ label, value, fraction, color }: { label: string; value: string; fraction: number; color: string }) {
  return (
    <View style={styles.loadBar} accessible accessibilityLabel={`${label} ${value}`}>
      <View style={styles.loadHead}>
        <Txt size={13}>{label}</Txt>
        <Txt size={13} bold>
          {value}
        </Txt>
      </View>
      <Bar fraction={fraction} color={color} height={10} />
    </View>
  );
}

/**
 * The ride's training load: the figure the app uses (TSS-based with power and an FTP, else heart rate TRIMP), where it comes from,
 * and the 7 and 28 day load around it from the generic analysis.
 */
function RideLoadCardImpl({ analysis, load }: { analysis: WorkoutAnalysis; load: RideLoad }) {
  const { palette } = useAnalysisContext();
  const { t } = useTranslation('cycling');
  const week = analysis.load;
  if (load.trimpUsed === null || load.basis === null) return null;

  const ratio = week?.ratio ?? null;
  const verdict = ratio !== null ? loadVerdict(ratio) : null;
  const color = verdict ? verdictColor(palette, verdict) : palette.accent;
  const onColor = palette.isDark ? '#14100A' : '#FFFFFF';
  const bars = week && week.chronicWeekly > 0 ? loadBarFractions(week.acute, week.chronicWeekly) : null;
  const detail =
    load.basis === 'tss' && load.tssTrimp !== null
      ? t('load.tssTrimp', { value: fmtInt(load.tssTrimp) })
      : load.trimp !== null
        ? t('load.hrTrimp', { value: fmtInt(load.trimp) })
        : null;

  return (
    <Card title={t('section.load')}>
      <View style={styles.top}>
        <View accessible accessibilityLabel={`${t('load.thisRide')} ${t('load.trimp')} ${fmtInt(load.trimpUsed)}`}>
          <Txt size={11} muted>
            {t('load.thisRide')}
          </Txt>
          <View style={styles.valueRow}>
            <Txt size={26} bold>
              {fmtInt(load.trimpUsed)}
            </Txt>
            <Txt size={12} muted>
              {t('load.trimp')}
            </Txt>
          </View>
        </View>
        {verdict ? (
          <View style={[styles.verdict, { backgroundColor: color }]} accessible accessibilityLabel={t('load.a11y', { verdict: t(`load.verdict.${verdict}`) })}>
            <Ionicons name={VERDICT_ICON[verdict]} size={16} color={onColor} />
            <Txt size={13} bold color={onColor}>
              {t(`load.verdict.${verdict}`)}
            </Txt>
          </View>
        ) : null}
      </View>
      <View style={styles.basis}>
        <Chip label={t(`load.basis.${load.basis}`)} color={palette.power} />
        {detail ? (
          <Txt size={12} muted>
            {detail}
          </Txt>
        ) : null}
      </View>
      {week && bars ? (
        <View style={styles.bars}>
          <LoadBar label={t('load.last7')} value={fmtInt(week.acute)} fraction={bars.acute} color={color} />
          <LoadBar label={t('load.weeklyAverage')} value={fmtInt(week.chronicWeekly)} fraction={bars.chronic} color={palette.textMuted} />
        </View>
      ) : null}
      {verdict && ratio !== null ? (
        <Txt size={12} muted style={styles.verdictText}>
          {t('load.verdictLine', { verdict: t(`load.verdictText.${verdict}`), ratio: t('load.ratio', { percent: fmtInt(ratio * 100) }) })}
        </Txt>
      ) : null}
      <View style={styles.verdictText}>
        <Details title={t('load.how')}>{t(load.basis === 'tss' ? 'load.explainTss' : 'load.explainHr')}</Details>
      </View>
    </Card>
  );
}

export const RideLoadCard = memo(RideLoadCardImpl);

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  basis: { marginTop: 10, gap: 6, alignItems: 'flex-start' },
  bars: { gap: 12, marginTop: 14 },
  loadBar: { gap: 6 },
  loadHead: { flexDirection: 'row', justifyContent: 'space-between' },
  verdictText: { marginTop: 10 },
});

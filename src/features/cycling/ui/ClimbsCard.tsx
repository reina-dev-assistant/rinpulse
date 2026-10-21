import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Details } from '@/components/Details';
import { formatDuration, type WorkoutAnalysis } from '@/features/workouts/analysis/types';
import { useAnalysisContext } from '@/features/workouts/analysis/ui/context';
import { Card, Chip, MIN_HIT, Txt } from '@/features/workouts/analysis/ui/primitives';
import { useScrubSelector } from '@/features/workouts/analysis/ui/scrub';
import { fmtDecimal, fmtInt } from '@/i18n';

import type { RideClimb } from '../types';
import { climbCategoryKey, climbCategoryTone, scrubIndexAt } from './format';

interface Stat {
  key: string;
  label: string;
  value: string;
}

interface RowProps {
  climb: RideClimb;
  index: number;
  active: boolean;
  onSelect: (index: number) => void;
}

const ClimbRow = memo(function ClimbRow({ climb, index, active, onSelect }: RowProps) {
  const { palette } = useAnalysisContext();
  const { t } = useTranslation('cycling');
  const tone = palette.zones[climbCategoryTone(climb.category)]!;
  const gain = t('climbs.gain', { value: fmtInt(climb.gainM) });
  const line = t('climbs.line', {
    length: fmtDecimal(climb.lengthM / 1000, 2),
    avg: fmtDecimal(climb.avgGradePct, 1),
    max: fmtDecimal(climb.maxGradePct, 1),
  });

  const stats: Stat[] = [{ key: 'time', label: t('climbs.time'), value: formatDuration(climb.sec) }];
  if (climb.vam !== null) stats.push({ key: 'vam', label: t('climbs.vam'), value: `${fmtInt(climb.vam)} ${t('unit.vam')}` });
  if (climb.avgSpeedKmh !== null) stats.push({ key: 'speed', label: t('climbs.speed'), value: `${fmtDecimal(climb.avgSpeedKmh, 1)} ${t('unit.kmh')}` });
  if (climb.avgPower !== null) stats.push({ key: 'power', label: t('climbs.power'), value: `${fmtInt(climb.avgPower)} ${t('unit.w')}` });
  if (climb.avgHr !== null) stats.push({ key: 'hr', label: t('climbs.hr'), value: `${fmtInt(climb.avgHr)} ${t('unit.bpm')}` });

  return (
    <Pressable
      onPress={() => onSelect(index)}
      accessibilityRole="button"
      accessibilityLabel={t('climbs.a11yRow', {
        n: climb.n,
        length: fmtDecimal(climb.lengthM / 1000, 2),
        gain: fmtInt(climb.gainM),
        grade: fmtDecimal(climb.avgGradePct, 1),
      })}
      accessibilityHint={t('climbs.a11yHint')}
      accessibilityState={{ selected: active }}
      style={[styles.row, active ? { backgroundColor: palette.surfaceAlt } : null]}>
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <Chip label={t(climbCategoryKey(climb.category))} color={tone} filled labelColor={palette.isDark ? '#14100A' : '#FFFFFF'} />
          <Txt size={14} bold numberOfLines={1}>
            {t('climbs.title', { n: climb.n })}
          </Txt>
        </View>
        <Txt size={14} bold>
          {gain}
        </Txt>
      </View>
      <Txt size={12} muted style={styles.line}>
        {line}
      </Txt>
      <View style={styles.stats}>
        {stats.map((s) => (
          <View key={s.key} style={styles.stat}>
            <Txt size={10} muted numberOfLines={1}>
              {s.label}
            </Txt>
            <Txt size={13} bold numberOfLines={1}>
              {s.value}
            </Txt>
          </View>
        ))}
      </View>
    </Pressable>
  );
});

function ClimbsCardImpl({ analysis, climbs }: { analysis: WorkoutAnalysis; climbs: readonly RideClimb[] }) {
  const { store, palette } = useAnalysisContext();
  const { t } = useTranslation('cycling');
  const series = analysis.series;
  const n = series?.n ?? 0;
  const stepSec = series?.stepSec ?? 1;

  const ranges = useMemo(
    () => climbs.map((c) => ({ from: scrubIndexAt(c.startSec, stepSec, n), to: scrubIndexAt(c.endSec, stepSec, n) })),
    [climbs, stepSec, n],
  );
  const select = useCallback(
    (i: number) => {
      const r = ranges[i];
      if (r) store.set(r.from);
    },
    [ranges, store],
  );
  const active = useScrubSelector(
    store,
    useCallback((index: number | null) => (index === null ? -1 : ranges.findIndex((r) => index >= r.from && index <= r.to)), [ranges]),
  );

  if (climbs.length === 0) return null;
  return (
    <Card title={t('section.climbs')} aside={fmtInt(climbs.length)}>
      {climbs.map((climb, i) => (
        <View key={climb.n}>
          {i > 0 ? <View style={[styles.rule, { backgroundColor: palette.border }]} /> : null}
          <ClimbRow climb={climb} index={i} active={i === active} onSelect={select} />
        </View>
      ))}
      <View style={styles.note}>
        <Details>{t('climbs.note')}</Details>
      </View>
    </Card>
  );
}

export const ClimbsCard = memo(ClimbsCardImpl);

const styles = StyleSheet.create({
  row: { minHeight: MIN_HIT, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 8, gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  line: { marginTop: 2 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6, marginTop: 6 },
  stat: { minWidth: 56 },
  rule: { height: StyleSheet.hairlineWidth },
  note: { marginTop: 10 },
});

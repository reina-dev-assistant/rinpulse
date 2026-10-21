import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Metric } from '@/components/Metric';
import type { ManualSport } from '@/features/workouts/manual';
import { formatElapsed, workoutDistanceParts } from '@/features/workouts/summary';
import { spacing, useColors } from '@/theme';

import { speedKind } from './format';

const DASH = '--';

interface StatPreviewProps {
  sport: ManualSport;
  /**
   * `row` is three small figures side by side, the hint of a recording above a map. `stacked` is the screen itself where there is no map
   * (an indoor sport): the time large on its own line, distance and pace or speed under it, on the dark hero panel.
   */
  layout: 'row' | 'stacked';
}

interface Cell {
  key: string;
  label: string;
  value: string;
  unit?: string;
}

/**
 * The three figures the recording will show, at rest before it starts: time, distance and the pace (on foot) or speed (on wheels) of the
 * sport. They carry the live screen's own labels and units, so what is read here is where it will be there. Nothing is measured yet, so
 * they read zero and a dash.
 */
export function StatPreview({ sport, layout }: StatPreviewProps) {
  const { t } = useTranslation('workouts');
  const colors = useColors();
  const pace = speedKind(sport) === 'pace';
  const distance = workoutDistanceParts(0);
  const stacked = layout === 'stacked';
  const ink = stacked ? colors.heroForeground : colors.foreground;
  const quiet = stacked ? colors.heroMuted : colors.mutedForeground;
  const divider = stacked ? colors.heroDivider : colors.hairline;

  const time: Cell = { key: 'time', label: t('record.live.time'), value: formatElapsed(0) };
  const others: Cell[] = [
    { key: 'distance', label: t('record.live.distance'), value: distance.value, unit: distance.unit },
    {
      key: 'speed',
      label: pace ? t('record.live.pace') : t('record.live.speed'),
      value: DASH,
      unit: pace ? t('analysis.unit.perKm') : t('analysis.unit.kmh'),
    },
  ];
  const cells = stacked ? others : [time, ...others];

  const figure = (cell: Cell, size: 'hero' | 'lg' | 'md') => (
    <View key={cell.key} accessible accessibilityLabel={`${cell.label}: ${cell.value}${cell.unit ? ` ${cell.unit}` : ''}`} style={styles.cell}>
      <AppText variant="label" color={quiet}>
        {cell.label}
      </AppText>
      <Metric value={cell.value} unit={cell.unit} size={size} color={ink} unitColor={quiet} />
    </View>
  );

  return (
    <View style={stacked ? styles.stack : undefined}>
      {stacked ? figure(time, 'hero') : null}
      <View style={styles.row}>
        {cells.flatMap((cell, index) => [
          index > 0 ? <View key={`${cell.key}-divider`} style={[styles.divider, { backgroundColor: divider }]} /> : null,
          figure(cell, stacked ? 'lg' : 'md'),
        ])}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center' },
  cell: { flex: 1, gap: 2, paddingHorizontal: spacing.sm, alignItems: 'center' },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
});

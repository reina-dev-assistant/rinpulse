import { StyleSheet, View } from 'react-native';

import { Txt } from '@/features/workouts/analysis/ui/primitives';

export interface Cell {
  key: string;
  label: string;
  value: string;
  unit?: string;
  sub?: string;
}

/** One labelled figure in the analysis card look: small muted label, bold value, optional unit and sub line. */
export function StatCell({ cell, big = false }: { cell: Cell; big?: boolean }) {
  return (
    <View
      style={big ? styles.heroCell : styles.gridCell}
      accessible
      accessibilityLabel={`${cell.label} ${cell.value} ${cell.unit ?? ''} ${cell.sub ?? ''}`.trim()}>
      <Txt size={11} muted numberOfLines={1}>
        {cell.label}
      </Txt>
      <View style={styles.valueRow}>
        <Txt size={big ? 24 : 17} bold numberOfLines={1} fit>
          {cell.value}
        </Txt>
        {cell.unit ? (
          <Txt size={big ? 12 : 11} muted style={styles.unit}>
            {cell.unit}
          </Txt>
        ) : null}
      </View>
      {cell.sub ? (
        <Txt size={11} muted numberOfLines={big ? 2 : 1}>
          {cell.sub}
        </Txt>
      ) : null}
    </View>
  );
}

/** Figures in two columns (three with `columns`). */
export function StatGrid({ cells, columns = 2 }: { cells: readonly Cell[]; columns?: 2 | 3 }) {
  return (
    <View style={styles.grid}>
      {cells.map((cell) => (
        <View key={cell.key} style={columns === 3 ? styles.third : styles.half}>
          <StatCell cell={cell} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  heroCell: { flex: 1, minWidth: 0 },
  gridCell: { minWidth: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
  half: { width: '50%', paddingRight: 8, minWidth: 0 },
  third: { width: '33.333%', paddingRight: 8, minWidth: 0 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  unit: { flexShrink: 0 },
});

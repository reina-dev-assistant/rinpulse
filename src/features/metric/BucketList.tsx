import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { Card } from '@/components/Screen';
import { spacing, useColors } from '@/theme';

export interface BucketRow {
  key: string | number;
  /** The day, week or month. */
  label: string;
  /** The exact value with its unit; null shows `emptyText`. */
  value: string | null;
  /** The value reached the metric's goal. */
  hit?: boolean;
  /** Opens that period (a day from a week, a week from three months). */
  onPress?: () => void;
}

/**
 * The exact numbers under a chart, one row per bar, newest first. It gives every value without scrubbing and reads straight through
 * with a screen reader. A row with no value says so in words (no fake zero). Rows that open a finer period have a chevron.
 */
export function BucketList({ rows, emptyText }: { rows: readonly BucketRow[]; emptyText: string }) {
  const colors = useColors();
  return (
    <Card style={styles.card}>
      {rows.map((row, i) => {
        const body = (
          <>
            <AppText variant="body" numberOfLines={1} style={styles.label}>
              {row.label}
            </AppText>
            {row.hit ? <Ionicons name="checkmark-circle" size={18} color={colors.linkText} accessibilityLabel="" /> : null}
            <AppText variant="bodyStrong" muted={row.value === null} style={styles.value}>
              {row.value ?? emptyText}
            </AppText>
            {row.onPress ? <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} /> : null}
          </>
        );
        const frame = [styles.row, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline } : null];
        return row.onPress ? (
          <PressableScale
            key={row.key}
            accessibilityRole="button"
            accessibilityLabel={`${row.label}: ${row.value ?? emptyText}`}
            onPress={row.onPress}
            scaleTo={0.985}
            style={frame}>
            {body}
          </PressableScale>
        ) : (
          <View key={row.key} accessible accessibilityLabel={`${row.label}: ${row.value ?? emptyText}`} style={frame}>
            {body}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md + 4, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  label: { flex: 1 },
  value: { fontVariant: ['tabular-nums'] },
});

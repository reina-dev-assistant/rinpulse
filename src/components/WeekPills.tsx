import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { spacing, tintColors, useTheme, type Tint } from '@/theme';

export interface WeekPill {
  key: string | number;
  /** Short weekday under the pill. */
  label: string;
  /** The day reached what the row counts: the pill fills and shows a check. */
  hit: boolean;
  /** Today's pill gets an outline, so the row reads as "up to here". */
  today?: boolean;
  /** A day that has not happened yet is dimmed. */
  future?: boolean;
  /** What a screen reader says for the day. */
  a11y: string;
}

/**
 * Seven pills, one per day, for a yes/no per day: filled with a check when the day counted, empty otherwise. The state is the
 * fill and the check, not color alone. The row is one accessibility element per day.
 */
export function WeekPills({ days, tint }: { days: readonly WeekPill[]; tint: Tint }) {
  const { colors, radius } = useTheme();
  const scheme = tintColors(colors, tint);
  return (
    <View style={styles.row}>
      {days.map((d) => (
        <View key={d.key} accessible accessibilityLabel={d.a11y} style={[styles.day, d.future ? styles.future : null]}>
          <View
            style={[
              styles.pill,
              { borderRadius: Math.min(radius.control, 14) },
              d.hit ? { backgroundColor: scheme.base } : { backgroundColor: colors.muted },
              d.today ? { borderWidth: 2, borderColor: scheme.base } : null,
            ]}>
            {d.hit ? <Ionicons name="checkmark" size={16} color={colors.card} /> : null}
          </View>
          <AppText variant="caption" muted={!d.today} style={styles.label}>
            {d.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm - 2 },
  day: { flex: 1, alignItems: 'center', gap: 2 },
  future: { opacity: 0.45 },
  pill: { alignSelf: 'stretch', height: 28, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, lineHeight: 14 },
});

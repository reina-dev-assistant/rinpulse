import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Metric } from '@/components/Metric';
import { PressableScale } from '@/components/PressableScale';
import { HIT, spacing, useColors } from '@/theme';

interface ValueRowProps {
  title: string;
  /** The figure, already formatted. */
  value: string;
  unit: string;
  open: boolean;
  onPress: () => void;
  /** The editor, shown under the row while it is open. */
  children: ReactNode;
}

/** Room a three-digit value and its unit get before a monospaced numeral face is shrunk to fit. */
const VALUE_FIT = 64;

/** A plain row: the name on the left, the value and a chevron on the right; a tap opens its editor right under it. */
export function ValueRow({ title, value, unit, open, onPress, children }: ValueRowProps) {
  const colors = useColors();
  return (
    <View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${value} ${unit}`}
        accessibilityState={{ expanded: open }}
        scaleTo={0.985}
        onPress={onPress}
        style={styles.row}>
        <AppText variant="bodyStrong" numberOfLines={2} style={styles.title}>
          {title}
        </AppText>
        <Metric value={value} unit={unit} size="sm" fit={VALUE_FIT} />
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.mutedForeground} />
      </PressableScale>
      {open ? <View style={styles.panel}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: HIT },
  title: { flex: 1 },
  panel: { gap: spacing.sm, paddingBottom: spacing.sm },
});

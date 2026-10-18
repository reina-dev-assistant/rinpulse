import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { StatusDot } from '@/components/StatusDot';
import { spacing, useColors } from '@/theme';

import type { SensorStatus } from '../linkStatus';
import { statusLabel } from './format';

interface SensorStatusLineProps {
  status: SensorStatus;
  /** The live reading ("84 rpm"), shown after the state while the sensor is connected. */
  reading: string | null;
  /** Lines the text may take before it is cut off; 2 by default. */
  lines?: number;
}

/**
 * One line about one sensor: a dot, what the link is doing, whether data is coming in and how long ago the last value was ("Tersambung,
 * data masuk · 2 dtk lalu · 84 rpm"). The dot pulses while the link is up or being set up.
 */
export function SensorStatusLine({ status, reading, lines = 2 }: SensorStatusLineProps) {
  const colors = useColors();
  const { phase } = status;
  const color =
    phase === 'receiving' || phase === 'waiting'
      ? colors.link
      : phase === 'quiet' || phase === 'connecting' || phase === 'searching'
        ? colors.warning
        : phase === 'failed'
          ? colors.destructive
          : colors.mutedForeground;
  const text = reading && (phase === 'receiving' || phase === 'quiet') ? `${statusLabel(status)} · ${reading}` : statusLabel(status);
  return (
    <View style={styles.line} accessible accessibilityLabel={text}>
      <StatusDot color={color} live={phase !== 'idle' && phase !== 'failed'} size={8} />
      <AppText variant="caption" style={styles.text} numberOfLines={lines}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  text: { flex: 1 },
});

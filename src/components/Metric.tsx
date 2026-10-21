import { StyleSheet, Text } from 'react-native';

import { useTheme } from '@/theme';

type MetricSize = 'hero' | 'lg' | 'md' | 'sm';

interface MetricProps {
  value: string;
  /** Small unit after the number, e.g. `bpm` or `kcal`. */
  unit?: string;
  size?: MetricSize;
  color?: string;
  unitColor?: string;
}

/** Big tabular number with a small unit on the same baseline. */
export function Metric({ value, unit, size = 'lg', color, unitColor }: MetricProps) {
  const { colors, fonts, numeral } = useTheme();
  const scale = numeral[size];
  return (
    <Text
      style={[
        styles.value,
        { fontFamily: fonts.numeral, fontSize: scale.size, lineHeight: scale.line, letterSpacing: scale.tracking, color: color ?? colors.foreground },
      ]}>
      {value}
      {unit ? (
        <Text style={[styles.unit, { fontFamily: fonts.medium, fontSize: scale.unit, color: unitColor ?? colors.mutedForeground }]}>
          {' '}
          {unit}
        </Text>
      ) : null}
    </Text>
  );
}

const styles = StyleSheet.create({
  value: { fontVariant: ['tabular-nums'] },
  unit: { letterSpacing: 0 },
});

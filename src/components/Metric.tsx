import { StyleSheet, Text } from 'react-native';

import { useTheme } from '@/theme';
import { fitMonoSize, MIN_FIT_SCALE, monoAdvance } from '@/theme/numeralFit';

type MetricSize = 'hero' | 'lg' | 'md' | 'sm';

interface MetricProps {
  value: string;
  /** Small unit after the number, e.g. `bpm` or `kcal`. */
  unit?: string;
  size?: MetricSize;
  color?: string;
  unitColor?: string;
  /** Room for the figure in px when the parent cannot give it a width to fit (inside a ring). A monospaced numeral face is sized to it by its character count. */
  fit?: number;
}

/**
 * Big tabular number with a small unit on the same baseline. One line: a number too wide for its box shrinks (down to half, by
 * `fit` for a monospaced face, else by the platform) instead of wrapping onto a second line.
 */
export function Metric({ value, unit, size = 'lg', color, unitColor, fit }: MetricProps) {
  const { colors, fonts, numeral } = useTheme();
  const scale = numeral[size];
  const advance = monoAdvance(fonts.numeral);
  const fontSize = fit !== undefined && advance !== null ? fitMonoSize({ text: value, size: scale.size, tracking: scale.tracking, advance, maxWidth: fit }) : scale.size;
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={MIN_FIT_SCALE}
      style={[
        styles.value,
        { fontFamily: fonts.numeral, fontSize, lineHeight: Math.round((scale.line * fontSize) / scale.size), letterSpacing: scale.tracking, color: color ?? colors.foreground },
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

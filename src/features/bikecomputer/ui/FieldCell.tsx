import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme';

import type { FieldValue } from '../types';
import { DIGIT_ASPECT, fitFontSize, labelFits, textUnits } from './fitText';
import { toneColor, type RidePalette } from './ridePalette';

interface FieldCellProps {
  /** The full name, for the screen reader. */
  name: string;
  /** The full name, printed above the number when it fits next to the unit. */
  label: string;
  /** The 1-2 word name for a cell too narrow for `label`. */
  shortLabel: string;
  value: FieldValue;
  /** The cell's size in dp; the grid knows it, so the cell does not measure itself. */
  width: number;
  height: number;
  palette: RidePalette;
}

/** The label row is this many times the label's font size tall. */
const LABEL_ROW = 1.35;

/**
 * One data field: a label and the unit on the first line, the value as big as the cell allows (`fitFontSize`), an optional sub line. It
 * is a swipe surface, so it takes no touches of its own: no press, no long press.
 */
function FieldCellView({ name, label, shortLabel, value, width, height, palette }: FieldCellProps) {
  const { t } = useTranslation('bikecomp');
  const { fonts } = useTheme();
  const pad = Math.round(Math.min(14, Math.max(6, Math.min(width, height) * 0.06)));
  const small = Math.round(Math.min(18, Math.max(12, height * 0.1)));
  const labelRow = Math.round(small * LABEL_ROW);
  const subRow = value.sub ? Math.round(small * LABEL_ROW) : 0;
  const innerWidth = width - pad * 2;
  const valueHeight = height - pad * 2 - labelRow - subRow;
  const size = fitFontSize(innerWidth, valueHeight, textUnits(value.value), DIGIT_ASPECT);
  const color = toneColor(palette, value.tone);
  const shown = labelFits(label, value.unit, small, innerWidth) ? label : shortLabel;

  const a11yArgs = { name, value: value.value, unit: value.unit ?? '', sub: value.sub ?? '' };
  const accessibilityLabel =
    value.unit && value.sub
      ? t('a11y.field.valueUnitSub', a11yArgs)
      : value.unit
        ? t('a11y.field.valueUnit', a11yArgs)
        : value.sub
          ? t('a11y.field.valueSub', a11yArgs)
          : t('a11y.field.value', a11yArgs);

  return (
    <View accessible accessibilityLabel={accessibilityLabel} style={[styles.cell, { width, height, padding: pad }]}>
      <View style={[styles.labelRow, { height: labelRow }]}>
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={[styles.label, { color: palette.muted, fontFamily: fonts.bold, fontSize: small, lineHeight: labelRow }]}>
          {shown}
        </Text>
        {value.unit ? (
          <Text
            numberOfLines={1}
            allowFontScaling={false}
            style={[styles.unit, { color: palette.muted, fontFamily: fonts.bold, fontSize: small, lineHeight: labelRow }]}>
            {value.unit}
          </Text>
        ) : null}
      </View>
      <View style={styles.valueBox}>
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={[
            styles.value,
            { color, fontFamily: fonts.numeral, fontSize: size, lineHeight: Math.round(size * 1.05), letterSpacing: -size * 0.02 },
          ]}>
          {value.value}
        </Text>
      </View>
      {value.sub ? (
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={[styles.sub, { color: palette.muted, fontFamily: fonts.bold, fontSize: small, lineHeight: subRow }]}>
          {value.sub}
        </Text>
      ) : null}
    </View>
  );
}

export const FieldCell = memo(FieldCellView);

const styles = StyleSheet.create({
  cell: { overflow: 'hidden' },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  label: { flexShrink: 1 },
  unit: { flexShrink: 0 },
  valueBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  value: { fontVariant: ['tabular-nums'], includeFontPadding: false, textAlign: 'center' },
  sub: { textAlign: 'center' },
});

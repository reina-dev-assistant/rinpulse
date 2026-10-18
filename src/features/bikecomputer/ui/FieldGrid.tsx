import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import type { FieldId, FieldValue, GridSize } from '../types';
import { FieldCell } from './FieldCell';
import { gridShape } from './gridShape';
import type { RidePalette } from './ridePalette';

interface FieldGridProps {
  /** `grid` entries; a missing one draws an empty cell. */
  fields: readonly FieldId[];
  grid: GridSize;
  /** The text of a field: the ride's readings, or sample values in the editor. */
  resolve: (id: FieldId) => FieldValue;
  palette: RidePalette;
  /** The editor: a tap on a slot. The ride screen leaves it out, so cells stay a swipe surface. */
  onSlotPress?: (slot: number) => void;
  style?: StyleProp<ViewStyle>;
}

const EMPTY: FieldValue = { value: '--', unit: null, tone: 'neutral', sub: null };

/**
 * The numbers of one page: 1, 2, 4, 6 or 8 cells in the shape `gridShape` picks for the space it has, split by hairlines. No cards, no
 * radius, no shadow: it is a screen of numbers.
 */
export function FieldGrid({ fields, grid, resolve, palette, onSlotPress, style }: FieldGridProps) {
  const { t } = useTranslation('bikecomp');
  const [box, setBox] = useState({ width: 0, height: 0 });
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBox((old) => (old.width === width && old.height === height ? old : { width, height }));
  };

  const base = [styles.fill, { backgroundColor: palette.background }, style];
  if (box.width <= 0 || box.height <= 0) return <View onLayout={onLayout} style={base} />;

  const { columns, rows } = gridShape(grid, box.width, box.height);
  const cellW = box.width / columns;
  const cellH = box.height / rows;

  return (
    <View onLayout={onLayout} style={base}>
      {Array.from({ length: rows }, (_, row) => (
        <View key={row} style={styles.row}>
          {Array.from({ length: columns }, (_, column) => {
            const slot = row * columns + column;
            const id = fields[slot];
            const name = id ? t(`field.${id}.name`) : '';
            const shortLabel = id ? t(`field.${id}.short`) : '';
            const frame = {
              width: cellW,
              height: cellH,
              borderColor: palette.hairline,
              borderRightWidth: column < columns - 1 ? StyleSheet.hairlineWidth : 0,
              borderBottomWidth: row < rows - 1 ? StyleSheet.hairlineWidth : 0,
            };
            const cell = <FieldCell name={name} label={name} shortLabel={shortLabel} value={id ? resolve(id) : EMPTY} width={cellW} height={cellH} palette={palette} />;
            return onSlotPress ? (
              <Pressable
                key={slot}
                accessibilityRole="button"
                accessibilityLabel={t('editor.slotA11y', { n: slot + 1, name })}
                onPress={() => onSlotPress(slot)}
                style={frame}>
                {cell}
              </Pressable>
            ) : (
              <View key={slot} style={frame}>
                {cell}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row' },
});

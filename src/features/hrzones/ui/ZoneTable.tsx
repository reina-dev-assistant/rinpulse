import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useColors } from '@/theme';

import { boundaries, percentScale, percentToBpm, zoneGeometry } from '../layout';
import type { HrZones } from '../zones';
import { BoundaryBox } from './BoundaryBox';

const BOX_WIDTH = 72;
const BOX_GAP = 8;
const BOXES_WIDTH = BOX_WIDTH * 2 + BOX_GAP;
/** The column the bracket lines run in: its centre carries the vertical line, the left half meets the zone name, the right half the boxes. */
const BRACKET_WIDTH = 20;
const LINE = 1.5;

interface ZoneTableProps {
  zones: HrZones;
  /** Zone names and colours, zero-based, lowest zone first. */
  names: readonly string[];
  colorOf: (zone: number) => string;
  /** The limit `index` (0..4) was typed as `bpm`. */
  onLimit: (index: number, bpm: number) => void;
}

/**
 * The zones as Huawei Health lays them out: the highest zone on top, its name and colour on the left, and the boundaries between the zones
 * as two boxes side by side (bpm and percent), each joined by a bracket to the zones above and below. A boundary is one pair of boxes, so
 * every figure appears once and is edited where it is read. The maximum on top and the reserve method's warm-up start at the bottom are fixed.
 */
export function ZoneTable({ zones, names, colorOf, onLimit }: ZoneTableProps) {
  const { t } = useTranslation('settings');
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  const { box, row } = zoneGeometry(fontScale);
  const list = boundaries(zones);
  const scale = percentScale(zones);
  const n = zones.bounds.length;
  const line = { backgroundColor: colors.mutedForeground, opacity: 0.45 };
  const centre = (position: number) => box / 2 + position * row;

  return (
    <View>
      <View style={styles.head}>
        <AppText variant="caption" muted style={styles.headName}>
          {t('hrZones.zones.head.zone')}
        </AppText>
        <View style={{ width: BRACKET_WIDTH }} />
        <View style={styles.headBoxes}>
          <AppText variant="caption" muted numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.headCell}>
            {t('hrZones.zones.head.bpm')}
          </AppText>
          <AppText variant="caption" muted numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.headCell}>
            {t('hrZones.zones.head.percent')}
          </AppText>
        </View>
      </View>

      <View style={[styles.body, { height: n * row + box }]}>
        <View style={styles.names}>
          {Array.from({ length: n }, (_, r) => {
            const zone = n - 1 - r;
            return (
              <View key={zone} style={[styles.name, { top: centre(r), height: row }]}>
                <View style={[styles.dot, { backgroundColor: colorOf(zone) }]} />
                <AppText variant="bodyStrong" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.nameText}>
                  {names[zone]}
                </AppText>
              </View>
            );
          })}
        </View>

        <View style={{ width: BRACKET_WIDTH }}>
          {Array.from({ length: n }, (_, r) => (
            <Fragment key={`v${r}`}>
              <View style={[styles.abs, line, { left: BRACKET_WIDTH / 2 - LINE / 2, width: LINE, top: centre(r), height: row }]} />
              <View style={[styles.abs, line, { left: 0, width: BRACKET_WIDTH / 2, height: LINE, top: centre(r) + row / 2 - LINE / 2 }]} />
            </Fragment>
          ))}
          {list.map(({ position }) => (
            <View key={`h${position}`} style={[styles.abs, line, { left: BRACKET_WIDTH / 2 - LINE / 2, right: 0, height: LINE, top: centre(position) - LINE / 2 }]} />
          ))}
        </View>

        <View style={{ width: BOXES_WIDTH }}>
          {list.map(({ position, bpm, percent, limit }) => {
            const zoneNumber = n - position + 1;
            return (
              <View key={position} style={[styles.abs, styles.boxes, { top: position * row, height: box }]}>
                <BoundaryBox
                  label={position === 0 ? t('hrZones.zones.maxLabel') : t('hrZones.zones.startLabel', { n: zoneNumber })}
                  value={bpm}
                  width={BOX_WIDTH}
                  height={box}
                  prefix={position === 0 ? '≥' : undefined}
                  onCommit={limit === null ? undefined : (typed) => onLimit(limit, typed)}
                />
                <BoundaryBox
                  label={position === 0 ? t('hrZones.zones.maxPercentLabel') : t('hrZones.zones.startPercentLabel', { n: zoneNumber })}
                  value={percent}
                  width={BOX_WIDTH}
                  height={box}
                  onCommit={limit === null ? undefined : (typed) => onLimit(limit, percentToBpm(typed, scale))}
                />
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-end' },
  headName: { flex: 1 },
  headBoxes: { width: BOXES_WIDTH, flexDirection: 'row', gap: BOX_GAP },
  headCell: { width: BOX_WIDTH, textAlign: 'center' },
  body: { flexDirection: 'row' },
  names: { flex: 1 },
  name: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameText: { flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  abs: { position: 'absolute' },
  boxes: { left: 0, right: 0, flexDirection: 'row', gap: BOX_GAP },
});

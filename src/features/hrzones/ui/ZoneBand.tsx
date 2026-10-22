import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useColors } from '@/theme';

import { bandLayout, bandTicks, percentScale, tickStep, TICK_LABEL_PX } from '../layout';
import type { HrZones } from '../zones';

interface ZoneBandProps {
  zones: HrZones;
  /** Colour of zone `zone` (zero-based). */
  colorOf: (zone: number) => string;
}

/**
 * One thin band that shows where each zone sits: a segment per zone, as wide as the zone is in bpm, lowest zone on the left, with the
 * percent ticks under it. It is the picture of the table below; the table carries the figures, so a screen reader skips the band.
 */
export function ZoneBand({ zones, colorOf }: ZoneBandProps) {
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const band = bandLayout(zones);
  const scale = percentScale(zones);
  const spanPercent = ((zones.maxHr - band.start) * 100) / scale.range;
  const ticks = bandTicks(zones, tickStep(width, spanPercent, fontScale));
  const label = Math.round(TICK_LABEL_PX * Math.max(1, fontScale));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={styles.wrap}>
      <View style={styles.band}>
        <View style={{ flex: band.lead, backgroundColor: colors.muted }} />
        {band.segments.map(({ zone, share }) => (
          <View key={zone} style={{ flex: share, backgroundColor: colorOf(zone) }} />
        ))}
      </View>
      <View style={{ height: Math.ceil(20 * Math.max(1, fontScale)) }}>
        {ticks.map(({ percent, at }) => (
          <AppText
            key={percent}
            variant="caption"
            muted
            numberOfLines={1}
            style={[styles.tick, { width: label, left: Math.min(Math.max(at * width - label / 2, 0), Math.max(0, width - label)) }]}>
            {percent}%
          </AppText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  band: { height: 12, borderRadius: 6, overflow: 'hidden', flexDirection: 'row' },
  tick: { position: 'absolute', top: 0, textAlign: 'center', fontVariant: ['tabular-nums'] },
});

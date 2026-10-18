import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import { useAnalysisContext } from '@/features/workouts/analysis/ui/context';
import { Card, Chip, Note, Txt } from '@/features/workouts/analysis/ui/primitives';
import { fmtDecimal, fmtInt } from '@/i18n';

import { KEY_DURATIONS } from '../power';
import type { AllTimeBest } from '../store';
import type { PowerEffort } from '../types';
import {
  curveDomain,
  curvePath,
  curveTicks,
  curveX,
  curveY,
  durationParts,
  keyEffortRows,
  wattTicks,
  type CurveBox,
} from './format';

const HEIGHT = 176;
const LEFT = 34;
const RIGHT = 10;
const TOP = 10;
const BOTTOM = 22;

interface Props {
  curve: readonly PowerEffort[];
  allTime: readonly AllTimeBest[];
  /** Key durations (seconds) this ride holds the all-time best for. */
  records: readonly number[];
  weightKg: number | null;
}

function PowerCurveCardImpl({ curve, allTime, records, weightKg }: Props) {
  const { palette } = useAnalysisContext();
  const { t } = useTranslation('cycling');
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  const allTimeLine = useMemo(() => (allTime.length >= 2 ? allTime : []), [allTime]);
  const domain = useMemo(() => curveDomain(curve, allTimeLine), [curve, allTimeLine]);
  const rows = useMemo(() => keyEffortRows(curve, KEY_DURATIONS, weightKg, records, allTime), [curve, weightKg, records, allTime]);

  if (!domain) {
    return (
      <Card title={t('section.powerCurve')}>
        <Txt size={13} muted>
          {t('curve.none')}
        </Txt>
      </Card>
    );
  }

  const box: CurveBox = { left: LEFT, top: TOP, width: Math.max(0, width - LEFT - RIGHT), height: HEIGHT - TOP - BOTTOM };
  const tickLabel = (sec: number) => {
    const { value, unit } = durationParts(sec);
    return t(`curve.duration.${unit}`, { value });
  };
  const maxLabel = tickLabel(domain.maxSec);
  const font = palette.fonts?.regular;
  return (
    <Card title={t('section.powerCurve')}>
      <View onLayout={onLayout} style={styles.chart}>
        {width > 0 ? (
          <Svg width={width} height={HEIGHT} accessibilityLabel={t('curve.a11y', { max: maxLabel })}>
            {wattTicks(domain.maxWatts).map((w) => {
              const y = curveY(w, domain, box);
              return (
                <G key={w}>
                  <Line x1={box.left} x2={box.left + box.width} y1={y} y2={y} stroke={palette.grid} strokeWidth={1} />
                  <SvgText x={box.left - 6} y={y + 3} fontSize={10} fill={palette.textMuted} fontFamily={font} textAnchor="end">
                    {fmtInt(w)}
                  </SvgText>
                </G>
              );
            })}
            {curveTicks(domain.minSec, domain.maxSec).map((sec) => {
              const x = curveX(sec, domain, box);
              return (
                <G key={sec}>
                  <Line x1={x} x2={x} y1={box.top} y2={box.top + box.height} stroke={palette.grid} strokeWidth={1} />
                  <SvgText x={x} y={HEIGHT - 6} fontSize={10} fill={palette.textMuted} fontFamily={font} textAnchor="middle">
                    {tickLabel(sec)}
                  </SvgText>
                </G>
              );
            })}
            {allTimeLine.length >= 2 ? (
              <Path d={curvePath(allTimeLine, domain, box)} stroke={palette.textMuted} strokeWidth={1.5} strokeDasharray="5 4" fill="none" />
            ) : null}
            <Path d={curvePath(curve, domain, box)} stroke={palette.power} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {rows.map((row) => (
              <Circle
                key={row.sec}
                cx={curveX(row.sec, domain, box)}
                cy={curveY(row.watts, domain, box)}
                r={row.record ? 5 : 3.5}
                fill={row.record ? palette.positive : palette.power}
                stroke={palette.surface}
                strokeWidth={1.5}
              />
            ))}
          </Svg>
        ) : null}
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: palette.power }]} />
          <Txt size={11} muted>
            {t('curve.mine')}
          </Txt>
        </View>
        {allTimeLine.length >= 2 ? (
          <View style={styles.legendItem}>
            <View style={[styles.swatch, styles.dashed, { borderColor: palette.textMuted }]} />
            <Txt size={11} muted>
              {t('curve.allTime')}
            </Txt>
          </View>
        ) : null}
      </View>
      {rows.map((row) => (
        <View key={row.sec} style={[styles.row, { borderTopColor: palette.border }]} accessible accessibilityLabel={t('curve.a11yRow', { name: t(`curve.key.${row.sec}` as 'curve.key.5'), value: fmtInt(row.watts) })}>
          <View style={styles.rowName}>
            <Txt size={13} bold>
              {t(`curve.key.${row.sec}` as 'curve.key.5')}
            </Txt>
            {row.record ? (
              <Chip label={t('curve.record')} color={palette.positive} filled labelColor={palette.isDark ? '#14100A' : '#FFFFFF'} />
            ) : row.bestWatts !== null ? (
              <Txt size={11} muted>
                {t('curve.best', { value: fmtInt(row.bestWatts) })}
              </Txt>
            ) : null}
          </View>
          <View style={styles.rowValue}>
            <Txt size={15} bold align="right">
              {t('curve.watts', { value: fmtInt(row.watts) })}
            </Txt>
            {row.wkg !== null ? (
              <Txt size={11} muted align="right">
                {t('curve.wkg', { value: fmtDecimal(row.wkg, 2) })}
              </Txt>
            ) : null}
          </View>
        </View>
      ))}
      <Note>{t('curve.note')}</Note>
    </Card>
  );
}

export const PowerCurveCard = memo(PowerCurveCardImpl);

const styles = StyleSheet.create({
  chart: { height: HEIGHT },
  legend: { flexDirection: 'row', gap: 16, marginTop: 4, marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 18, height: 3, borderRadius: 2 },
  dashed: { backgroundColor: 'transparent', borderTopWidth: 2, borderStyle: 'dashed', height: 0 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  rowName: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, flexWrap: 'wrap' },
  rowValue: { flexShrink: 0 },
});

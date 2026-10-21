import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { BarReadout, useBarScrub } from '@/components/BarChart';
import type { DaySeries } from '@/features/trends/series';
import { fmtDate } from '@/i18n';
import { useTheme } from '@/theme';

const HEIGHT = 56;
const PAD = 6;
const DOT = 3;

interface Point {
  x: number;
  y: number;
}

interface TrendChartProps {
  /** One value per day, oldest first; null leaves a gap. */
  values: DaySeries;
  kind: 'line' | 'bar';
  color: string;
  /** Local midnight of the first day, for the axis. */
  firstDay: number;
  /** Fixed value range (recovery 0..100, strain 0..21); otherwise it follows the data. Bars always start at 0. */
  domain?: readonly [number, number];
  /** A second, dashed line drawn over the bars, one value per day (the sleep need). */
  reference?: readonly number[];
  /** Dashed horizontal line at the range's average. */
  average?: number | null;
  /** A value with its unit, e.g. `62 ms`; read out on touch. The card header already shows the latest value, so no bar carries a label. */
  format: (value: number) => string;
  label: string;
  /** The right end of the axis; "Today" unless the last day is another day. */
  endLabel?: string;
}

/**
 * Days as a line or bars on a shared x axis. Days without a value are gaps: a line is cut there, never drawn across,
 * and a lone day is a dot. Dots mark only lone days and the newest day, so 90 days stay readable.
 */
export function TrendChart({ values, kind, color, firstDay, domain, reference, average, format, label, endLabel }: TrendChartProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const [width, setWidth] = useState(0);
  const scrub = useBarScrub(values.length, values, PAD, PAD, 'slot');

  const present = values.flatMap((v) => (v === null ? [] : [v]));
  const all = reference ? [...present, ...reference] : present;
  let lo = domain ? domain[0] : Math.min(...all);
  let hi = domain ? domain[1] : Math.max(...all);
  if (kind === 'bar') lo = 0;
  else if (!domain) {
    // Pad so the extremes do not sit on the frame; a flat series sits in the middle.
    const pad = (hi - lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  const span = hi - lo || 1;
  const n = values.length;
  const inner = Math.max(0, width - 2 * PAD);
  const slot = inner / n;
  const x = (i: number) => PAD + slot * (i + 0.5);
  const top = PAD;
  const height = HEIGHT;
  const y = (v: number) => top + (1 - (v - lo) / span) * (height - PAD - top);

  // Runs of consecutive days with a value.
  const runs: Point[][] = [];
  if (kind === 'line') {
    values.forEach((v, i) => {
      if (v === null) {
        if (runs.length > 0 && runs[runs.length - 1].length > 0) runs.push([]);
        return;
      }
      if (runs.length === 0) runs.push([]);
      runs[runs.length - 1].push({ x: x(i), y: y(v) });
    });
  }
  const lastIndex = values.findLastIndex((v) => v !== null);
  const barWidth = Math.max(1.5, Math.min(14, slot * 0.68));
  const sel = scrub.selected;
  const day = (i: number) => {
    const d = new Date(firstDay * 1000);
    d.setDate(d.getDate() + i);
    return d;
  };
  const selValue = sel !== null ? values[sel] : null;
  const readTitle = sel !== null ? fmtDate(day(sel), 'weekday') : null;
  const readText = sel !== null ? (selValue !== null && selValue !== undefined ? format(selValue) : t('chart.noValue')) : null;
  const a11yDays = values.flatMap((v, i) => (v === null ? [] : [`${fmtDate(day(i), 'weekday')}: ${format(v)}`]));

  return (
    <View accessible accessibilityLabel={`${label}. ${a11yDays.join('. ')}`} style={styles.wrap}>
      <BarReadout title={readTitle} text={readText} color={color} />
      <View
        {...scrub.touch}
        onLayout={(e) => {
          setWidth(e.nativeEvent.layout.width);
          scrub.touch.onLayout(e);
        }}
        style={{ height }}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            <Line x1={PAD} x2={width - PAD} y1={height - PAD} y2={height - PAD} stroke={colors.hairline} strokeWidth={1} />
            {kind === 'bar'
              ? values.map((v, i) =>
                  v === null ? null : (
                    <Rect
                      key={i}
                      x={x(i) - barWidth / 2}
                      y={y(Math.min(v, hi))}
                      width={barWidth}
                      height={Math.max(1.5, height - PAD - y(Math.min(v, hi)))}
                      rx={Math.min(3, barWidth / 2)}
                      fill={color}
                      fillOpacity={sel !== null && sel !== i ? 0.45 : 1}
                    />
                  ),
                )
              : null}
            {kind === 'line' && average !== null && average !== undefined ? (
              <Line
                x1={PAD}
                x2={width - PAD}
                y1={y(average)}
                y2={y(average)}
                stroke={colors.mutedForeground}
                strokeWidth={1}
                strokeDasharray="3 4"
                opacity={0.6}
              />
            ) : null}
            {runs
              .filter((run) => run.length > 1)
              .map((run, i) => (
                <Polyline
                  key={i}
                  points={run.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
            {kind === 'line'
              ? values.map((v, i) => {
                  if (v === null) return null;
                  const lone = values[i - 1] == null && values[i + 1] == null;
                  if (!lone && i !== lastIndex) return null;
                  return (
                    <Circle
                      key={i}
                      cx={x(i)}
                      cy={y(v)}
                      r={DOT}
                      fill={i === lastIndex ? color : colors.card}
                      stroke={color}
                      strokeWidth={2}
                    />
                  );
                })
              : null}
            {kind === 'line' && sel !== null && selValue !== null && selValue !== undefined ? (
              <>
                <Line x1={x(sel)} x2={x(sel)} y1={PAD} y2={height - PAD} stroke={color} strokeOpacity={0.35} strokeWidth={1} />
                <Circle cx={x(sel)} cy={y(selValue)} r={DOT + 2} fill={color} stroke={colors.card} strokeWidth={2} />
              </>
            ) : null}
            {reference ? (
              <Polyline
                points={reference.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
                fill="none"
                stroke={colors.foreground}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                opacity={0.7}
              />
            ) : null}
          </Svg>
        ) : null}
      </View>
      <View style={styles.axis}>
        <AppText variant="caption" muted>
          {fmtDate(firstDay, 'short')}
        </AppText>
        <AppText variant="caption" muted>
          {endLabel ?? t('time.today')}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  chart: { height: HEIGHT },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
});

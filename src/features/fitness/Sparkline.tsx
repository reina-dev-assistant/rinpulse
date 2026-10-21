import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { BarReadout, useBarScrub } from '@/components/BarChart';

const HEIGHT = 44;
const PAD = 5;

/** A small line through `values` (oldest first), the last one marked. `domain` fixes the vertical range; otherwise it follows the data. */
export function Sparkline({
  values,
  color,
  label,
  domain,
  readout,
}: {
  values: readonly number[];
  color: string;
  label: string;
  domain?: readonly [number, number];
  /** One date and value text per entry of `values`; touch then reads a point out above the line. */
  readout?: readonly { title: string; text: string }[];
}) {
  const [width, setWidth] = useState(0);
  const scrub = useBarScrub(readout ? values.length : 0, values, PAD, PAD, 'point');
  const lo = domain ? domain[0] : Math.min(...values);
  const hi = domain ? domain[1] : Math.max(...values);
  const span = hi - lo || 1;
  const inner = Math.max(0, width - 2 * PAD);
  const x = (i: number) => PAD + (values.length <= 1 ? inner / 2 : (inner * i) / (values.length - 1));
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (HEIGHT - 2 * PAD);
  const last = values.length - 1;
  const sel = scrub.selected;
  const picked = sel !== null && readout ? readout[sel] : null;
  const chart = (
    <View
      accessible={!readout}
      accessibilityLabel={label}
      {...(readout ? scrub.touch : {})}
      onLayout={(e) => {
        setWidth(e.nativeEvent.layout.width);
        scrub.touch.onLayout(e);
      }}
      style={styles.wrap}>
      {width > 0 && values.length > 0 ? (
        <Svg width={width} height={HEIGHT}>
          {values.length > 1 ? (
            <Polyline
              points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
          {readout
            ? values.map((v, i) => <Circle key={i} cx={x(i)} cy={y(v)} r={i === sel ? 5 : 2.5} fill={color} />)
            : <Circle cx={x(last)} cy={y(values[last])} r={3.5} fill={color} />}
          {sel !== null ? <Line x1={x(sel)} x2={x(sel)} y1={PAD} y2={HEIGHT - PAD} stroke={color} strokeOpacity={0.35} strokeWidth={1} /> : null}
        </Svg>
      ) : null}
    </View>
  );
  if (!readout) return chart;
  return (
    <View accessible accessibilityLabel={`${label}. ${readout.map((r) => `${r.title}: ${r.text}`).join('. ')}`}>
      <BarReadout title={picked?.title ?? null} text={picked?.text ?? null} color={color} />
      {chart}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { height: HEIGHT, alignSelf: 'stretch' } });

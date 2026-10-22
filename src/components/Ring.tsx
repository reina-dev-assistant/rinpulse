import { useEffect, useId, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Mask } from 'react-native-svg';

import { FILL_MS } from '@/components/motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { dotGeometry, litDots, ringA11yValue, ringRatio } from '@/components/ringMath';
import { useTheme } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface RingProps {
  size: number;
  stroke: number;
  value: number;
  max: number;
  color: string;
  track: string;
  accessibilityLabel: string;
  /** Centered inside the ring. */
  children?: ReactNode;
}

/**
 * Progress ring. Fills once on mount and when the value changes (`FILL_MS`); static under reduced motion. A dotted theme draws it as dots,
 * whole dots only (`litDots`). A value past `max` is a full ring; no value, no goal or a NaN draws an empty one (`ringRatio`).
 */
export function Ring({ size, stroke, value, max, color, track, accessibilityLabel, children }: RingProps) {
  const reduced = useReducedMotion();
  const dotted = useTheme().theme.dottedRings === true;
  const maskId = useId();
  const { r, circumference, count, pitch } = dotGeometry(size, stroke);
  const ratio = ringRatio(value, max);
  // A dotted ring fills in whole dots; the arc under the dot mask starts half a pitch early so the first dot is covered whole, not half.
  const filled = dotted ? litDots(ratio, count) / count : ratio;
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduced) {
      progress.setValue(filled);
      return;
    }
    Animated.timing(progress, {
      toValue: filled,
      duration: FILL_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, filled, reduced]);

  const half = size / 2;
  // A near-zero dash with a round cap is one dot.
  const dotDash = [0.01, pitch - 0.01];
  const fillTurn = -90 - 180 / count;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={ringA11yValue(value, max)}
      style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {dotted ? (
          <>
            <Defs>
              <Mask id={maskId} x={0} y={0} width={size} height={size} maskUnits="userSpaceOnUse">
                <Circle
                  cx={half}
                  cy={half}
                  r={r}
                  stroke="#FFFFFF"
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={dotDash}
                  transform={`rotate(-90 ${half} ${half})`}
                />
              </Mask>
            </Defs>
            <Circle
              cx={half}
              cy={half}
              r={r}
              stroke={track}
              strokeWidth={stroke}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={dotDash}
              transform={`rotate(-90 ${half} ${half})`}
            />
            <AnimatedCircle
              cx={half}
              cy={half}
              r={r}
              stroke={color}
              strokeWidth={stroke}
              fill="none"
              mask={`url(#${maskId})`}
              strokeDasharray={circumference}
              strokeDashoffset={progress.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] })}
              transform={`rotate(${fillTurn} ${half} ${half})`}
            />
          </>
        ) : (
          <>
            <Circle cx={half} cy={half} r={r} stroke={track} strokeWidth={stroke} fill="none" />
            <AnimatedCircle
              cx={half}
              cy={half}
              r={r}
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={progress.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] })}
              transform={`rotate(-90 ${half} ${half})`}
            />
          </>
        )}
      </Svg>
      {children ? (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          {children}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});

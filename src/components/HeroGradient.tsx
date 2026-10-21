import { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useColors } from '@/theme';

/**
 * The gradient of a big hero panel, for themes whose `heroEnd` differs from `hero` (Sunset). Put it as the first child of a panel that
 * has `backgroundColor: colors.hero` and `overflow: 'hidden'`; it fills the panel from the top left (`hero`) to the bottom right
 * (`heroEnd`) and draws nothing for a flat theme, so the panel stays the plain `hero` color. Text on the panel is checked against both ends.
 */
export function HeroGradient() {
  const { hero, heroEnd } = useColors();
  const id = useId();
  if (hero === heroEnd) return null;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none" width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={hero} />
          <Stop offset="1" stopColor={heroEnd} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

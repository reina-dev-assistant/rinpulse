import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  DECORATION_COLORS,
  DECORATION_HEIGHT,
  DECORATION_WIDTH,
  decorationPaths,
} from '@/theme/decorations';
import type { Colors, DecorationId, Scheme } from '@/theme/themes';
import { useTheme } from '@/theme';

/** A dark canvas lifts a faint motif more than a light one does, so dark draws it a little quieter. */
const DARK_STRENGTH = 0.8;

interface ArtProps {
  id: DecorationId;
  colors: Colors;
  scheme: Scheme;
  width: number;
  height: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * One decoration drawn in a palette, anchored to the top-right of a `width` by `height` box. Static: it never animates, so there
 * is nothing for the system's "remove animations" setting to change. Used by `ThemeDecoration` (the Today header) and the
 * theme picker's previews.
 */
export function DecorationArt({ id, colors, scheme, width, height, style }: ArtProps) {
  const paths = useMemo(() => decorationPaths(id, width, height), [id, width, height]);
  const tones = DECORATION_COLORS[id];
  const strength = scheme === 'dark' ? DARK_STRENGTH : 1;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.box, { width, height }, style]}>
      <Svg width={width} height={height}>
        {paths.map((path, index) => {
          const color = colors[path.tone === 'a' ? tones.a : tones.b];
          return path.kind === 'fill' ? (
            <Path key={index} d={path.d} fill={color} fillOpacity={path.opacity * strength} />
          ) : (
            <Path
              key={index}
              d={path.d}
              fill="none"
              stroke={color}
              strokeWidth={path.strokeWidth}
              strokeOpacity={path.opacity * strength}
            />
          );
        })}
      </Svg>
    </View>
  );
}

/**
 * The active theme's header decoration, for the first child of a scrolling screen: it sits in the top-right corner of the scroll
 * content, behind the page title and everything after it, and scrolls away with the header. Draws nothing for a theme without one.
 */
export function ThemeDecoration() {
  const { theme, colors, scheme } = useTheme();
  if (!theme.decoration) return null;
  return (
    <DecorationArt
      id={theme.decoration}
      colors={colors}
      scheme={scheme}
      width={DECORATION_WIDTH}
      height={DECORATION_HEIGHT}
      style={styles.corner}
    />
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
  corner: { position: 'absolute', top: 0, right: 0 },
});

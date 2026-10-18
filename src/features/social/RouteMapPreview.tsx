import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { feedMapPoints, projectRoute, svgPathData } from '@/features/social/feedRoute';
import { spacing, useTheme } from '@/theme';

interface RouteMapPreviewProps {
  /** The post's `mapLine`: a Google encoded polyline, already trimmed and simplified by JoyoRogo. */
  line: string;
  /** The post's title, for the screen reader. */
  title: string;
  /** `card`: 2:1 inside a feed card. `detail`: 4:3 on the post screen, with start and finish labels and the hint. */
  size: 'card' | 'detail';
}

/** The drawing's own coordinate box per size; the view scales it to the width it gets. */
const BOX = {
  card: { width: 320, height: 160, padding: 22, stroke: 3, dot: 5 },
  detail: { width: 320, height: 240, padding: 28, stroke: 3.5, dot: 6 },
} as const;
const GRID_STEP = 40;

/** Faint grid lines every {@link GRID_STEP} units, as one path. */
function gridPath(width: number, height: number): string {
  let d = '';
  for (let x = GRID_STEP; x < width; x += GRID_STEP) d += `M${x} 0V${height}`;
  for (let y = GRID_STEP; y < height; y += GRID_STEP) d += `M0 ${y}H${width}`;
  return d;
}

/**
 * The route of a workout post as a drawing: the shared line on a soft surface with a faint grid, a green start dot and a
 * dark finish dot. No map tiles and no network, north up; the line already left JoyoRogo with its first and last 200 m cut.
 * Renders nothing when the line cannot be drawn.
 */
export function RouteMapPreview({ line, title, size }: RouteMapPreviewProps) {
  const { t } = useTranslation('social');
  const { colors, radius } = useTheme();
  const box = BOX[size];
  const route = useMemo(() => {
    const points = feedMapPoints(line);
    const projected = points ? projectRoute(points, box.width, box.height, box.padding) : null;
    if (!projected) return null;
    return { d: svgPathData(projected.points), start: projected.points[0]!, finish: projected.points[projected.points.length - 1]! };
  }, [line, box]);
  const grid = useMemo(() => gridPath(box.width, box.height), [box]);
  if (!route) return null;

  return (
    <View style={styles.block}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={t('post.map.alt', { title })}
        style={[styles.frame, { aspectRatio: box.width / box.height, backgroundColor: colors.muted, borderRadius: radius.tile }]}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${box.width} ${box.height}`}>
          <Path d={grid} fill="none" stroke={colors.hairline} strokeWidth={1} />
          <Path d={route.d} fill="none" stroke={colors.card} strokeOpacity={0.9} strokeWidth={box.stroke + 3} strokeLinecap="round" strokeLinejoin="round" />
          <Path d={route.d} fill="none" stroke={colors.workouts} strokeWidth={box.stroke} strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx={route.start[0]} cy={route.start[1]} r={box.dot} fill={colors.link} stroke={colors.card} strokeWidth={2} />
          <Circle cx={route.finish[0]} cy={route.finish[1]} r={box.dot} fill={colors.foreground} stroke={colors.card} strokeWidth={2} />
        </Svg>
      </View>
      {size === 'detail' ? (
        <>
          <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <LegendDot color={colors.link} label={t('post.map.start')} />
            <LegendDot color={colors.foreground} label={t('post.map.finish')} />
          </View>
          <AppText variant="caption" muted>
            {t('post.map.hint')}
          </AppText>
        </>
      ) : null}
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <AppText variant="caption" muted>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  frame: { width: '100%', overflow: 'hidden' },
  legend: { flexDirection: 'row', gap: spacing.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
});

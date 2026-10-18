import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { altitudeAt, stripGeometry, type ElevationPoint } from './elevationGeometry';
import type { RidePalette } from './ridePalette';

interface ElevationStripProps {
  elevationStrip: readonly ElevationPoint[];
  /** Metres along the route of the rider; null draws no marker. */
  positionM: number | null;
  /** The climb to highlight, in metres along the route. */
  climb: { startM: number; endM: number } | null;
  width: number;
  height: number;
  palette: RidePalette;
}

/** The route's elevation as a filled strip with the rider's position and the climb in the accent colour. Static: no animation. */
export function ElevationStrip({ elevationStrip, positionM, climb, width, height, palette }: ElevationStripProps) {
  const { t } = useTranslation('bikecomp');
  const geometry = useMemo(() => stripGeometry(elevationStrip, width, height), [elevationStrip, width, height]);
  if (!geometry) return <View style={{ width, height }} />;

  const here = positionM === null ? null : Math.max(0, positionM);
  const hereAlt = here === null ? null : altitudeAt(elevationStrip, here);
  const hereX = here === null ? null : geometry.xOf(here);
  const hereY = hereAlt === null ? null : geometry.yOf(hereAlt);

  let climbLine: string | null = null;
  if (climb) {
    const inside = elevationStrip.filter((p) => p.distM >= climb.startM && p.distM <= climb.endM);
    const startAlt = altitudeAt(elevationStrip, climb.startM);
    const endAlt = altitudeAt(elevationStrip, climb.endM);
    if (startAlt !== null && endAlt !== null) {
      const pts = [{ distM: climb.startM, altM: startAlt }, ...inside, { distM: climb.endM, altM: endAlt }];
      climbLine = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${geometry.xOf(p.distM).toFixed(1)} ${geometry.yOf(p.altM).toFixed(1)}`).join(' ');
    }
  }

  return (
    <View accessible accessibilityLabel={t('page.climb.profileA11y')} style={{ width, height }}>
      <Svg width={width} height={height}>
        <Path d={geometry.area} fill={palette.surface} />
        <Path d={geometry.line} stroke={palette.foreground} strokeWidth={2.5} fill="none" strokeLinejoin="round" />
        {climbLine ? <Path d={climbLine} stroke={palette.accent} strokeWidth={6} fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
        {hereX !== null && hereY !== null ? (
          <>
            <Line x1={hereX} y1={hereY} x2={hereX} y2={height} stroke={palette.foreground} strokeWidth={2} />
            <Circle cx={hereX} cy={hereY} r={9} fill={palette.accent} stroke={palette.background} strokeWidth={3} />
          </>
        ) : null}
      </Svg>
    </View>
  );
}

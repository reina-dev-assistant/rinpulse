import { Ionicons } from '@expo/vector-icons';
import type { CameraRef, MapProps, ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, View, type NativeSyntheticEvent } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { MAP_INK } from '@/features/routes/map/mapConfig';
import { loadMapLibre, type MapLibre } from '@/features/routes/map/maplibre';
import { spacing, useTheme } from '@/theme';

import {
  followAfterRegionChange,
  followStop,
  headingWedge,
  initialView,
  puckCollection,
  routeCollection,
  type BikePosition,
} from './mapGeometry';
import type { ResolvedMapStyle } from './style';

/** Where the licence asks the credit to link: the OpenStreetMap copyright page. */
const COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
const RECENTER_SIZE = 64;
const ROUND_LINE = { 'line-cap': 'round', 'line-join': 'round' } as const;

export interface BikeMapColors {
  route: string;
  routeCasing: string;
  puck: string;
  offCourse: string;
}

export interface BikeMapProps {
  style: ResolvedMapStyle;
  route: readonly { lat: number; lon: number }[] | null;
  position: BikePosition | null;
  /** The camera follows `position`. The map calls `onFollowChange(false)` when the rider pans or zooms by hand. */
  follow: boolean;
  /** The rider is off the route: the line turns `colors.offCourse` and dashed (colour is not the only cue). */
  offCourse: boolean;
  colors: BikeMapColors;
  onFollowChange: (follow: boolean) => void;
  /** dp, or `'fill'` to take the parent's height. Default `'fill'`. */
  height?: number | 'fill';
  /** Rotate the map to the direction of travel while following. Default north-up. */
  headingUp?: boolean;
  /** The map could not load its style or tiles (a missing file, no signal on the online source). */
  onLoadFailed?: () => void;
  /** Square corners, for a map that fills the screen edge to edge instead of sitting in a rounded frame. */
  flat?: boolean;
  /** dp the overlays move in from the top and the bottom edge, where a bar or a sheet covers the map: the source label, the follow button and the credit. Default 0. */
  inset?: { top?: number; bottom?: number };
}

/**
 * The ride map: route line with casing, the rider's puck (with a heading wedge when the heading is known), a camera that
 * follows at zoom 16, and a 64 dp button to follow again after a pan. MapLibre is required lazily; without it a short note
 * takes the map's place. Rotation and pitch gestures are off; the style's source is already the offline file, a stream or
 * the online tiles (`resolveMapStyle`). The map remounts when `style.key` changes (MapLibre does not re-read a source URL).
 */
export function BikeMap(props: BikeMapProps) {
  const maplibre = loadMapLibre();
  const { t } = useTranslation('bikemap');
  const { colors, radius } = useTheme();
  const [failed, setFailed] = useState(false);
  const { height = 'fill', onLoadFailed } = props;

  const frame = [styles.frame, height === 'fill' ? styles.fill : { height }, { borderRadius: props.flat ? 0 : radius.tile, backgroundColor: colors.muted }];

  if (!maplibre || failed) {
    return (
      <View style={[frame, styles.note]}>
        <Ionicons name="map-outline" size={28} color={colors.mutedForeground} />
        <AppText variant="caption" muted style={styles.noteText}>
          {maplibre ? t('map.loadFailed') : t('map.unavailable')}
        </AppText>
        {maplibre && props.style.source !== 'offline' ? (
          <AppText variant="caption" muted style={styles.noteText}>
            {props.style.source === 'stream' ? t('map.stream') : t('map.online')}
          </AppText>
        ) : null}
      </View>
    );
  }

  return (
    <View
      accessible
      accessibilityLabel={props.offCourse ? t('map.labelOffCourse') : t('map.label')}
      style={frame}>
      <LiveMap
        {...props}
        maplibre={maplibre}
        onFail={() => {
          setFailed(true);
          onLoadFailed?.();
        }}
      />
    </View>
  );
}

interface LiveMapProps extends BikeMapProps {
  maplibre: MapLibre;
  onFail: () => void;
}

function LiveMap({
  maplibre,
  style,
  route,
  position,
  follow,
  offCourse,
  colors: ink,
  onFollowChange,
  headingUp = false,
  inset,
  onFail,
}: LiveMapProps) {
  const { t } = useTranslation('bikemap');
  const { colors } = useTheme();
  const { Map: MapView, Camera, GeoJSONSource, Layer } = maplibre;
  const cameraRef = useRef<CameraRef>(null);
  const [creditOpen, setCreditOpen] = useState(false);

  // Hand the native map the same style object until the key changes: a new object with the same content would reload it.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the style object is identified by its key
  const mapStyle = useMemo(() => style.style, [style.key]);

  // Where a fresh map (first mount, or a new key) starts. Later fixes move the camera through `easeTo`.
  const start = useMemo(
    () => initialView(position, route),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new map (style key) restarts the camera
    [style.key],
  );

  // The route data keeps its identity across the 1 Hz position updates: the GeoJSON is rebuilt only for a new route.
  const routeData = useMemo(() => routeCollection(route), [route]);
  const lat = position?.lat;
  const lon = position?.lon;
  const heading = position?.headingDeg ?? null;
  const here = useMemo(
    () => (lat === undefined || lon === undefined ? null : { lat, lon, headingDeg: heading }),
    [lat, lon, heading],
  );
  const puckData = useMemo(() => puckCollection(here), [here]);
  const wedgeData = useMemo(() => headingWedge(here), [here]);

  useEffect(() => {
    if (!follow || !here) return;
    try {
      cameraRef.current?.easeTo(followStop(here, headingUp));
    } catch {
      // The native camera is not ready yet (first frame); initialViewState has already put it on the rider.
    }
  }, [follow, here, headingUp]);

  const onRegionDidChange = (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    if (follow && !followAfterRegionChange(follow, event.nativeEvent.userInteraction)) onFollowChange(false);
  };

  const lineColor = offCourse ? ink.offCourse : ink.route;
  const casingPaint = useMemo(
    () => ({ 'line-color': ink.routeCasing, 'line-width': 9, 'line-opacity': 0.95 }),
    [ink.routeCasing],
  );
  const strokePaint = useMemo(
    () => ({
      'line-color': lineColor,
      'line-width': 5,
      ...(offCourse ? { 'line-dasharray': [2, 1.5] } : {}),
    }),
    [lineColor, offCourse],
  );
  const wedgePaint = useMemo(() => ({ 'fill-color': ink.puck, 'fill-opacity': 0.35 }), [ink.puck]);
  const puckHaloPaint = useMemo(() => ({ 'circle-radius': 13, 'circle-color': ink.routeCasing }), [ink.routeCasing]);
  const puckPaint = useMemo(
    () => ({ 'circle-radius': 8.5, 'circle-color': ink.puck, 'circle-stroke-width': 2.5, 'circle-stroke-color': ink.routeCasing }),
    [ink.puck, ink.routeCasing],
  );

  const initialViewState: NonNullable<React.ComponentProps<typeof Camera>['initialViewState']> =
    'bounds' in start ? { bounds: start.bounds, padding: start.padding } : { center: start.center, zoom: start.zoom };

  return (
    <>
      <MapView
        key={style.key}
        mapStyle={mapStyle as unknown as MapProps['mapStyle']}
        logo={false}
        compass={false}
        attribution={false}
        touchRotate={false}
        touchPitch={false}
        onRegionDidChange={onRegionDidChange}
        onDidFailLoadingMap={onFail}>
        <Camera ref={cameraRef} initialViewState={initialViewState} />
        <GeoJSONSource id="bike-route" data={routeData}>
          <Layer id="bike-route-casing" type="line" layout={ROUND_LINE} paint={casingPaint} />
          <Layer id="bike-route-line" type="line" layout={ROUND_LINE} paint={strokePaint} />
        </GeoJSONSource>
        <GeoJSONSource id="bike-heading" data={wedgeData}>
          <Layer id="bike-heading-wedge" type="fill" paint={wedgePaint} />
        </GeoJSONSource>
        <GeoJSONSource id="bike-puck" data={puckData}>
          <Layer id="bike-puck-halo" type="circle" paint={puckHaloPaint} />
          <Layer id="bike-puck-dot" type="circle" paint={puckPaint} />
        </GeoJSONSource>
      </MapView>

      {!follow ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('map.recenter')}
          scaleTo={0.96}
          onPress={() => onFollowChange(true)}
          style={[styles.recenter, { backgroundColor: colors.card, borderColor: colors.hairline, bottom: spacing.xl + (inset?.bottom ?? 0) }]}>
          <Ionicons name="locate" size={30} color={colors.foreground} />
        </PressableScale>
      ) : null}

      <View style={[styles.credit, { bottom: 6 + (inset?.bottom ?? 0) }]}>
        {creditOpen ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t('map.attributionLabel')}
            onPress={() => void Linking.openURL(COPYRIGHT_URL)}
            style={styles.chip}>
            <AppText variant="caption" color={MAP_INK.chipText} style={styles.chipText}>
              {style.attribution}
            </AppText>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('map.attributionToggle')}
          accessibilityState={{ expanded: creditOpen }}
          hitSlop={10}
          onPress={() => setCreditOpen((open) => !open)}
          style={styles.info}>
          <Ionicons name="information" size={14} color={MAP_INK.chipText} />
        </Pressable>
      </View>
    </>
  );
}

/** Translucent so the credit never reads as a white box on the map. */
const CREDIT_BACKGROUND = 'rgba(255,255,255,0.6)';

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },
  fill: { flex: 1 },
  note: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  noteText: { textAlign: 'center' },
  chip: {
    position: 'absolute',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: CREDIT_BACKGROUND,
  },
  credit: { position: 'absolute', left: 6, flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '86%' },
  info: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: CREDIT_BACKGROUND },
  chipText: { fontSize: 11, lineHeight: 15 },
  recenter: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.xl,
    width: RECENTER_SIZE,
    height: RECENTER_SIZE,
    borderRadius: RECENTER_SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

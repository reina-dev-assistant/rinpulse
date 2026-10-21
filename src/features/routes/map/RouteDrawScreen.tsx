import type { CameraRef } from '@maplibre/maplibre-react-native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, KeyboardAvoidingView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Segmented } from '@/components/Segmented';
import { LoadingState, Notice } from '@/components/States';
import { useTabBarInset } from '@/components/tabBarInset';
import {
  addVerdict,
  drawReducer,
  EMPTY_DRAW,
  linePoints,
  MAX_WAYPOINTS,
  pendingLegs,
  usedRouting,
  type DrawState,
  type Leg,
} from '@/features/routes/map/drawModel';
import { NameSheet, SearchSheet, SheetCard } from '@/features/routes/map/DrawSheets';
import { addElevation } from '@/features/routes/map/elevationClient';
import type { Place } from '@/features/routes/map/geocodeClient';
import { lineCollection, pointCollection, type LatLon } from '@/features/routes/map/geometry';
import { isAborted } from '@/features/routes/map/http';
import { MAP_STYLE_URL, PLACE_ZOOM } from '@/features/routes/map/mapConfig';
import { MapAttribution } from '@/features/routes/map/MapAttribution';
import { MapButton } from '@/features/routes/map/MapButton';
import { loadMapLibre, type MapLibre } from '@/features/routes/map/maplibre';
import { RouteLayers } from '@/features/routes/map/RouteLayers';
import { elevationHeaders, routing } from '@/features/routes/map/services';
import { deviceLocation, locationAllowed, resolveStartView, type StartView } from '@/features/routes/map/startPosition';
import { untitledRouteName } from '@/features/routes/copy';
import { formatRouteDistance, routeStats } from '@/features/routes/routeModel';
import { saveRoute } from '@/features/routes/routeStore';
import { errorMessage } from '@/format';
import { spacing, useTheme } from '@/theme';

type DrawProfile = 'foot' | 'bike' | 'straight';

const PROFILE_VALUES: readonly DrawProfile[] = ['foot', 'bike', 'straight'];

/** How long a message about one leg stays on the map. */
const NOTICE_MS = 6000;

interface Message {
  text: string;
  tone: 'info' | 'danger';
}

type Sheet = 'controls' | 'name' | 'search';

/** The drawing screen: tap the map to add waypoints, each leg follows roads or paths (or a straight line), then save. */
export function RouteDrawScreen() {
  const { t } = useTranslation('routes');
  const maplibre = loadMapLibre();
  if (!maplibre) {
    return (
      <View style={styles.unavailable}>
        <Notice icon="map-outline">{t('map.unavailable')}</Notice>
      </View>
    );
  }
  return <DrawMap maplibre={maplibre} />;
}

function DrawMap({ maplibre }: { maplibre: MapLibre }) {
  const { t } = useTranslation('routes', { keyPrefix: 'map.draw' });
  const { t: tRoot } = useTranslation('routes');
  const router = useRouter();
  const { colors } = useTheme();
  const { Map: MapView, Camera } = maplibre;

  const cameraRef = useRef<CameraRef>(null);
  const tabBarInset = useTabBarInset();
  const rootRef = useRef<View>(null);
  const [rootTop, setRootTop] = useState(0);
  const [startView, setStartView] = useState<StartView | null>(null);
  const [canLocate] = useState(locationAllowed);
  const [locating, setLocating] = useState(false);

  const [draw, setDraw] = useState<DrawState>(EMPTY_DRAW);
  /** The latest state, readable in handlers that run between renders (two quick taps, a late routing answer). */
  const drawRef = useRef(draw);
  const commit = useCallback((next: DrawState) => {
    drawRef.current = next;
    setDraw(next);
  }, []);
  const [profile, setProfile] = useState<DrawProfile>('foot');
  const requests = useRef(new Map<number, AbortController>());

  const [sheet, setSheet] = useState<Sheet>('controls');
  const [suggestedName, setSuggestedName] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [saving, setSaving] = useState<'elevation' | 'saving' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    resolveStartView(maplibre).then((view) => {
      if (alive) setStartView(view);
    });
    return () => {
      alive = false;
    };
  }, [maplibre]);

  useEffect(() => {
    const pending = requests.current;
    return () => {
      for (const controller of pending.values()) controller.abort();
      saveAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  /** Asks the routing service for one leg; a failure keeps the straight segment and says so. */
  const requestLeg = (leg: Leg, routingProfile: 'foot' | 'bike') => {
    const controller = new AbortController();
    requests.current.set(leg.id, controller);
    routing
      .route(routingProfile, leg.points[0], leg.points[1], controller.signal)
      .then(
        (points) => commit(drawReducer(drawRef.current, { type: 'resolve', legId: leg.id, points })),
        (error: unknown) => {
          if (isAborted(error)) return;
          commit(drawReducer(drawRef.current, { type: 'fail', legId: leg.id }));
          setMessage({ text: t('routeFailed'), tone: 'info' });
        },
      )
      .finally(() => requests.current.delete(leg.id));
  };

  const addWaypoint = (point: LatLon) => {
    if (sheet !== 'controls') return;
    const verdict = addVerdict(drawRef.current, point);
    if (verdict === 'full') {
      setMessage({ text: t('pointLimit', { max: MAX_WAYPOINTS }), tone: 'info' });
      return;
    }
    if (verdict === 'duplicate') return;
    const routed = profile !== 'straight' && drawRef.current.waypoints.length > 0;
    const next = drawReducer(drawRef.current, { type: 'add', point, routed });
    commit(next);
    setMessage(null);
    if (routed) requestLeg(next.legs[next.legs.length - 1], profile);
  };

  const undo = () => {
    const last = drawRef.current.legs[drawRef.current.legs.length - 1];
    if (last) requests.current.get(last.id)?.abort();
    setMessage(null);
    commit(drawReducer(drawRef.current, { type: 'undo' }));
  };

  const clear = () => {
    for (const controller of requests.current.values()) controller.abort();
    setConfirmClear(false);
    setMessage(null);
    commit(drawReducer(drawRef.current, { type: 'clear' }));
  };

  const locate = async () => {
    setLocating(true);
    const here = await deviceLocation(maplibre);
    setLocating(false);
    if (!here) {
      setMessage({ text: t('locateFailed'), tone: 'info' });
      return;
    }
    cameraRef.current?.flyTo({ center: [here.lon, here.lat], zoom: PLACE_ZOOM, duration: 800 });
  };

  const goTo = (place: Place) => {
    setSheet('controls');
    cameraRef.current?.flyTo({ center: [place.lon, place.lat], zoom: PLACE_ZOOM, duration: 800 });
  };

  const line = useMemo(() => linePoints(draw), [draw]);
  const distanceM = useMemo(() => routeStats(line.map((p) => ({ ...p, alt: null }))).distanceM, [line]);
  const pending = pendingLegs(draw).length;
  const waypoints = draw.waypoints;

  const layers = useMemo(() => {
    const settled = draw.legs.filter((leg) => leg.status !== 'pending').map((leg) => leg.points);
    const waiting = draw.legs.filter((leg) => leg.status === 'pending').map((leg) => leg.points);
    const last = waypoints.length - 1;
    return {
      line: lineCollection(settled),
      pending: lineCollection(waiting),
      via: pointCollection(waypoints.slice(1, Math.max(last, 1))),
      start: pointCollection(waypoints.slice(0, 1)),
      end: pointCollection(last > 0 ? [waypoints[last]] : []),
    };
  }, [draw.legs, waypoints]);

  /** Altitude for the final line (best effort), then the file on the phone, then the route's page. */
  const save = async (name: string) => {
    const controller = new AbortController();
    saveAbort.current = controller;
    setSaveError(null);
    setSaving('elevation');
    try {
      const flat = line.map((p) => ({ lat: p.lat, lon: p.lon, alt: null }));
      const { points } = await addElevation(flat, { fetch, headers: elevationHeaders, signal: controller.signal });
      if (controller.signal.aborted) return;
      setSaving('saving');
      const saved = await saveRoute({ name, source: 'drawn', points });
      router.replace({ pathname: '/routes/[id]', params: { id: saved.id } });
    } catch (e) {
      setSaveError(t('saveFailed', { message: errorMessage(e) }));
      setSaving(null);
    }
  };

  const summary =
    waypoints.length < 2
      ? waypoints.length === 0
        ? t('hintEmpty')
        : t('hintMore')
      : [formatRouteDistance(distanceM), t('points', { count: waypoints.length })].join(' \u00B7 ');
  const credits = usedRouting(draw) ? [tRoot('map.routingCredit')] : [];
  const profileOptions = PROFILE_VALUES.map((value) => ({ value, label: t(`profiles.${value}`) }));

  return (
    <View
      ref={rootRef}
      style={styles.root}
      onLayout={() => rootRef.current?.measureInWindow((_x, y) => setRootTop(y))}>
      {startView ? (
        <MapView
          style={styles.fill}
          mapStyle={MAP_STYLE_URL}
          logo={false}
          compass={false}
          touchRotate={false}
          touchPitch={false}
          // A double tap would add two waypoints and zoom: zoom stays on pinch.
          doubleTapZoom={false}
          doubleTapHoldZoom={false}
          attribution
          attributionPosition={{ top: 8, right: 8 }}
          onDidFailLoadingMap={() => setMapFailed(true)}
          onDidFinishLoadingMap={() => setMapFailed(false)}
          onPress={(event) => {
            const [lon, lat] = event.nativeEvent.lngLat;
            addWaypoint({ lat, lon });
          }}>
          <Camera ref={cameraRef} initialViewState={{ center: [startView.lon, startView.lat], zoom: startView.zoom }} />
          <RouteLayers
            maplibre={maplibre}
            color={colors.workouts}
            line={layers.line}
            pending={layers.pending}
            via={layers.via}
            start={layers.start}
            end={layers.end}
          />
        </MapView>
      ) : (
        <View style={styles.fill} accessibilityLabel={t('mapLabel')}>
          <LoadingState label={t('preparing')} />
        </View>
      )}

      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <View pointerEvents="box-none" style={styles.top}>
          {mapFailed ? <Notice tone="danger">{t('mapFailed')}</Notice> : null}
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        </View>

        <View pointerEvents="box-none" style={styles.side}>
          <MapButton icon="search" label={t('search')} surface="floating" onPress={() => setSheet('search')} />
          {canLocate ? (
            <MapButton icon="locate" label={t('locate')} surface="floating" loading={locating} onPress={locate} />
          ) : null}
        </View>

        <KeyboardAvoidingView
          pointerEvents="box-none"
          behavior="padding"
          keyboardVerticalOffset={rootTop}
          style={styles.bottom}>
          <View pointerEvents="box-none" style={[styles.stack, { paddingBottom: spacing.sm + tabBarInset }]}>
            <MapAttribution extra={credits} style={styles.credit} />
            {sheet === 'name' ? (
              <NameSheet
                initialName={suggestedName}
                busy={saving}
                error={saveError}
                onSave={save}
                onCancel={() => setSheet('controls')}
              />
            ) : sheet === 'search' ? (
              <SearchSheet onPick={goTo} onClose={() => setSheet('controls')} />
            ) : (
              <SheetCard>
                <View style={styles.summaryRow}>
                  <AppText variant="bodyStrong" style={styles.grow} accessibilityLiveRegion="polite">
                    {summary}
                  </AppText>
                  {pending > 0 ? <ActivityIndicator size="small" color={colors.primary} /> : null}
                  {pending > 0 ? (
                    <AppText variant="caption" muted>
                      {t('findingRoute')}
                    </AppText>
                  ) : null}
                </View>
                <Segmented options={profileOptions} value={profile} onChange={setProfile} />
                <View style={styles.actions}>
                  <MapButton icon="arrow-undo" label={t('undo')} disabled={waypoints.length === 0} onPress={undo} />
                  <MapButton
                    icon="trash-outline"
                    label={t('clear')}
                    danger
                    disabled={waypoints.length === 0}
                    onPress={() => setConfirmClear(true)}
                  />
                  <View style={styles.grow}>
                    <Button
                      label={t('save')}
                      variant="primary"
                      icon="checkmark"
                      disabled={waypoints.length < 2 || pending > 0}
                      onPress={() => {
                        setSuggestedName(untitledRouteName(Date.now()));
                        setSheet('name');
                      }}
                    />
                  </View>
                </View>
                {pending > 0 && waypoints.length >= 2 ? (
                  <AppText variant="caption" muted>
                    {t('waitForRoute')}
                  </AppText>
                ) : null}
              </SheetCard>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>

      <ConfirmDialog
        visible={confirmClear}
        title={t('clearTitle')}
        message={t('clearMessage')}
        confirmLabel={t('clearConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={clear}
        onCancel={() => setConfirmClear(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  unavailable: { padding: spacing.lg },
  top: { position: 'absolute', top: spacing.sm, left: spacing.sm, right: 56, gap: spacing.sm },
  side: { position: 'absolute', top: 56, right: spacing.sm, gap: spacing.sm },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  stack: { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  credit: { position: 'relative', left: 0, bottom: 0, alignSelf: 'flex-start', marginBottom: spacing.xs, marginLeft: spacing.xs },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
});

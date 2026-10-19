import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { CloudWorkoutLine } from '@/cloud/CloudWorkoutLine';
import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { IconChip } from '@/components/IconChip';
import { isIos } from '@/components/IosUnavailable';
import { KeyValue } from '@/components/KeyValue';
import { Metric } from '@/components/Metric';
import { Ring } from '@/components/Ring';
import { HeaderIconButton } from '@/components/HeaderIconButton';
import { Card, Screen, Section } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import {
  getWorkout,
  listStepSamplesSince,
  listWorkoutPoints,
  type WorkoutPointRow,
  type WorkoutRow,
} from '@/db/queries';
import { BurnFigure, FuelBar } from '@/features/live/FuelBar';
import { startOfLocalDay } from '@/features/today/stats';
import { STRAIN_MAX, strainAddedToDay, workoutStrain } from '@/features/today/strain';
import { useWorkoutSource } from '@/features/device/useWorkoutSource';
import { GearWorkoutSection } from '@/features/gear/ui/GearWorkoutSection';
import { CoachFeedbackSection } from '@/features/coach/ui/CoachFeedbackSection';
import { StravaWorkoutSection } from '@/features/strava/StravaWorkoutSection';
import { ShareRunButton } from '@/features/stickers/ui/ShareRunButton';
import { ReplayButton } from '@/features/replay/ui/ReplayButton';
import { ShareToRogoButton } from '@/features/social/ShareToRogo';
import { SaveWorkoutRouteButton } from '@/features/routes/SaveWorkoutRouteButton';
import { useRoleText } from '@/features/record/ui/roleText';
import { listWorkoutSensors, type WorkoutSensor } from '@/features/sensors/store';
import { analyzeWorkout } from '@/features/workouts/analysis/analyze';
import { loadAnalysisHistory } from '@/features/workouts/analysis/history';
import { useAnalysisPalette, useMapTheme } from '@/features/workouts/analysis/palette';
import { workoutElevation } from '@/features/workouts/analysis/elevation';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';
import { WorkoutAnalysisView, useAnalysisT } from '@/features/workouts/analysis/ui';
import { DeleteWorkoutDialog } from '@/features/workouts/ui/DeleteWorkoutDialog';
import { MenuSheet, type MenuItem } from '@/features/strength/ui/Sheet';
import { sportIcon } from '@/features/workouts/sportIcon';
import { sportLabel } from '@/features/workouts/sportLabel';
import { splitWorkout } from '@/features/workouts/substrate';
import {
  formatElapsed,
  formatPace,
  formatSpeed,
  parseSummary,
  routePoints,
  workoutDistanceParts,
  type WorkoutSummary,
} from '@/features/workouts/summary';
import { averagePaceSec, averageSpeedMs, workoutTimes } from '@/features/workouts/times';
import { sourceLabel } from '@/features/fitness/format';
import { effectWord, trainingEffect } from '@/features/fitness/trainingEffect';
import { plausibleVo2 } from '@/features/fitness/vo2max';
import { userMaxHr } from '@/features/workouts/useWorkoutStrain';
import { useStrengthHistory } from '@/features/strength/history';
import { getStrengthWorkoutByStart } from '@/features/strength/store';
import type { StrengthWorkout } from '@/features/strength/types';
import { StrengthDetailSection } from '@/features/strength/ui/StrengthDetailSection';
import { EbikeRow } from '@/features/cycling/ui/EbikeRow';
import { RideAnalysisView } from '@/features/cycling/ui/RideAnalysisView';
import { useRideData } from '@/features/cycling/ui/useRideData';
import { withRideStats } from '@/features/cycling/ui/withRideStats';
import { sportKind } from '@/features/workouts/analysis/sport';
import { errorMessage, formatClock, formatCount, formatDateTime } from '@/format';
import { fmtDecimal, fmtInt, t as translate } from '@/i18n';
import { spacing, useColors } from '@/theme';
import type { StepSample } from '@/wear';

interface Loaded {
  workout: WorkoutRow;
  summary: WorkoutSummary;
  points: WorkoutPointRow[];
  /** Per-minute samples of the workout's day, for its share of that day's strain. */
  daySamples: StepSample[];
  /** The strength workout stored as this row (its own, or the one merged with this watch workout). */
  strength: StrengthWorkout | null;
  /** The sensors a phone recording used; empty for every other workout. */
  sensors: WorkoutSensor[];
}

/** `x,y m`, or null when the summary does not have the value. */
function metres(value: number | undefined): string | null {
  return value === undefined ? null : translate('common:units.m', { value: fmtDecimal(value, 1) });
}

/** `5,5 g` under 10 g, whole grams above. */
function grams(value: number): string {
  return value < 10 ? fmtDecimal(value, 1) : fmtInt(value);
}

/** The pace or speed rows that fit the sport: swimming per 100 m, running and walking per km, the rest km/h. */
function paceRows(summary: WorkoutSummary, distanceM: number, movingSec: number): { key: string; label: string; value: string }[] {
  const avgPace = translate('workouts:detail.more.avgPace');
  const bestPace = translate('workouts:detail.more.bestPace');
  if (summary.avgPaceSecPer100m !== undefined) {
    const rows = [{ key: 'avg', label: avgPace, value: formatPace(averagePaceSec(distanceM, movingSec, 100) ?? summary.avgPaceSecPer100m, '100 m') }];
    if (summary.minPaceSecPer100m !== undefined) {
      rows.push({ key: 'best', label: bestPace, value: formatPace(summary.minPaceSecPer100m, '100 m') });
    }
    return rows;
  }
  if (summary.avgPaceSecPerKm !== undefined) {
    const rows = [{ key: 'avg', label: avgPace, value: formatPace(averagePaceSec(distanceM, movingSec) ?? summary.avgPaceSecPerKm, 'km') }];
    if (summary.minPaceSecPerKm !== undefined) {
      rows.push({ key: 'best', label: bestPace, value: formatPace(summary.minPaceSecPerKm, 'km') });
    }
    return rows;
  }
  const rows: { key: string; label: string; value: string }[] = [];
  const avgSpeed = averageSpeedMs(distanceM, movingSec) ?? summary.avgSpeed;
  if (avgSpeed !== undefined && avgSpeed !== null) rows.push({ key: 'avgSpeed', label: translate('workouts:detail.more.avgSpeed'), value: formatSpeed(avgSpeed) });
  if (summary.maxSpeed !== undefined) rows.push({ key: 'topSpeed', label: translate('workouts:detail.more.topSpeed'), value: formatSpeed(summary.maxSpeed) });
  return rows;
}

/** The analysis of the workout on screen: computed after the rest of the screen is drawn. */
type AnalysisState = { status: 'pending' } | { status: 'none' } | { status: 'ready'; analysis: WorkoutAnalysis } | { status: 'error'; message: string };

export default function WorkoutDetailScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysisState, setAnalysisState] = useState<AnalysisState>({ status: 'pending' });
  const [scrubbing, setScrubbing] = useState(false);
  const palette = useAnalysisPalette();
  const mapTheme = useMapTheme();
  const { t } = useTranslation('workouts');
  const analysisT = useAnalysisT();
  const { catalog } = useStrengthHistory();
  const recordedBy = useWorkoutSource(Number(id));
  const roleText = useRoleText();

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const workoutId = Number(id);
      setAnalysisState({ status: 'pending' });
      (async () => {
        const found = await getWorkout(db, workoutId);
        if (!found) throw new Error(translate('workouts:detail.errors.notStored'));
        const points = await listWorkoutPoints(db, workoutId);
        const strength = await getStrengthWorkoutByStart(db, found.workout.start);
        const day = startOfLocalDay(found.workout.start);
        const daySamples = (await listStepSamplesSince(db, day)).filter((s) => s.timestamp < day + 86400);
        const summary = parseSummary(found.summaryJson);
        const sensors = summary.source === 'phone' ? await listWorkoutSensors(db, workoutId) : [];
        return { workout: found.workout, summary, points, daySamples, strength, sensors };
      })().then(
        async (value) => {
          if (cancelled) return;
          setLoaded(value);
          // The logger's own row has no heart rate, GPS or samples: there is nothing to analyse.
          if (value.strength !== null && value.points.length === 0) {
            setAnalysisState({ status: 'none' });
            return;
          }
          try {
            const maxHr = userMaxHr();
            const history = await loadAnalysisHistory(db, value.workout, maxHr);
            // Let the summary paint before the analysis blocks the JS thread.
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            if (cancelled) return;
            const analysis = analyzeWorkout(
              { workout: value.workout, summary: value.summary, points: value.points, maxHr, daySamples: value.daySamples, history },
              { includeHr: true, includeRoute: true, includeComparison: true },
            );
            setAnalysisState({ status: 'ready', analysis });
          } catch (e) {
            if (!cancelled) setAnalysisState({ status: 'error', message: errorMessage(e) });
          }
        },
        (e: unknown) => {
          if (!cancelled) setError(errorMessage(e));
        },
      );
      return () => {
        cancelled = true;
      };
    }, [db, id]),
  );

  const route = useMemo(() => (loaded ? routePoints(loaded.points) : []), [loaded]);
  const maxHr = useMemo(() => userMaxHr(), []);
  const burn = useMemo(() => {
    if (!loaded) return null;
    return splitWorkout(loaded.workout.calories, loaded.points, maxHr);
  }, [loaded, maxHr]);
  const strain = useMemo(() => {
    if (!loaded) return null;
    const own = workoutStrain(loaded.points, maxHr);
    if (!own) return null;
    return { ...own, share: strainAddedToDay(loaded.daySamples, loaded.workout, own.trimp, maxHr) };
  }, [loaded, maxHr]);
  const effect = useMemo(() => trainingEffect(loaded?.summary ?? {}, strain?.trimp ?? null), [loaded, strain]);
  const vo2 = plausibleVo2(loaded?.summary.vo2max);
  const effectShown =
    effect.aerobic !== null ||
    effect.anaerobic !== null ||
    effect.points !== null ||
    effect.load !== null ||
    (loaded?.summary.recoveryHours ?? 0) > 0 ||
    vo2 !== null;
  // One set of numbers for the whole screen, the same ones the analysis, the share card, the post and the Strava file use.
  const times = useMemo(() => (loaded ? workoutTimes(loaded.workout) : { elapsedSec: 0, movingSec: 0 }), [loaded]);
  const elevation = useMemo(() => (loaded ? workoutElevation(loaded.workout, loaded.summary, loaded.points) : null), [loaded]);
  const shareSummary = useMemo(
    () => (loaded ? { ...loaded.summary, elevationGain: elevation?.gainM, elevationLoss: elevation?.lossM } : {}),
    [loaded, elevation],
  );
  const rideInput = useMemo(
    () =>
      loaded !== null && sportKind(loaded.workout.sportName, loaded.summary.kind) === 'ride'
        ? { workout: loaded.workout, summary: loaded.summary, points: loaded.points }
        : null,
    [loaded],
  );
  const rideData = useRideData(db, rideInput);
  // The consumers of the analysis (share to JoyoRogo, coach) get the ride's own power and speed figures, not the 600-step grid's.
  const sharedAnalysis = useMemo(() => {
    if (analysisState.status !== 'ready') return null;
    return rideData.ride ? withRideStats(analysisState.analysis, rideData.ride) : analysisState.analysis;
  }, [analysisState, rideData.ride]);
  const avgRideSpeed = rideData.ride?.speed.avgMovingMs != null ? rideData.ride.speed.avgMovingMs * 3.6 : null;
  const colors = useColors();

  if (!loaded) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('detail.title') }} />
        {error !== null ? (
          <Notice tone="danger">{error}</Notice>
        ) : (
          <>
            <Skeleton width="100%" height={216} radius="card" />
            <Skeleton width="100%" height={280} radius="card" />
            <Skeleton width="100%" height={200} radius="card" />
          </>
        )}
      </Screen>
    );
  }

  const { workout, summary } = loaded;
  const bare = loaded.strength !== null && loaded.points.length === 0;
  const jumpRope = summary.kind === 'JUMP_ROPING';
  const swim = summary.swim;
  const sport = sportLabel(workout.sportName);
  const { value: distance, unit: distanceUnit } = workoutDistanceParts(workout.distance);
  const swimRows: { key: string; label: string; value: string | null }[] = swim
    ? [
        { key: 'style', label: t('detail.swim.style'), value: swim.style ?? null },
        { key: 'laps', label: t('detail.swim.laps'), value: swim.laps !== undefined ? fmtInt(swim.laps) : null },
        { key: 'pool', label: t('detail.swim.pool'), value: swim.poolLengthCm !== undefined ? translate('common:units.m', { value: fmtDecimal(swim.poolLengthCm / 100, 0) }) : null },
        { key: 'strokes', label: t('detail.swim.strokes'), value: swim.strokes !== undefined ? fmtInt(swim.strokes) : null },
        { key: 'rate', label: t('detail.swim.strokeRate'), value: swim.avgStrokeRate !== undefined ? t('detail.value.perMin', { value: fmtInt(swim.avgStrokeRate) }) : null },
        { key: 'swolf', label: t('detail.swim.swolf'), value: swim.avgSwolf !== undefined ? fmtInt(swim.avgSwolf) : null },
      ].filter((row) => row.value !== null)
    : [];

  return (
    <Screen scrollEnabled={!scrubbing}>
      <Stack.Screen
        options={{
          title: sport,
          headerRight: () => <HeaderIconButton icon="ellipsis-vertical" label={t('delete.menu')} onPress={() => setMenuOpen(true)} />,
        }}
      />
      <MenuSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={[{ key: 'delete', label: t('delete.action'), icon: 'trash-outline', danger: true, onPress: () => setDeleteOpen(true) }] satisfies MenuItem[]}
      />
      <DeleteWorkoutDialog
        target={deleteOpen ? { start: workout.start, sportName: workout.sportName, name: loaded.strength?.name } : null}
        onClose={() => setDeleteOpen(false)}
        onConfirmed={() => (router.canGoBack() ? router.back() : router.replace('/workouts'))}
      />
      <Card>
        <View style={styles.summaryHead}>
          <IconChip sport={sportIcon(workout.sportName)} tint="workouts" size="lg" />
          <View style={styles.summaryTitle}>
            <AppText variant="heading" numberOfLines={2}>
              {sport}
            </AppText>
            <AppText variant="caption" muted>
              {formatDateTime(workout.start)}
            </AppText>
          </View>
        </View>
        <View style={styles.figures}>
          <Figure label={times.elapsedSec > times.movingSec ? t('detail.figure.movingTime') : t('detail.figure.duration')}>
            <Metric value={formatElapsed(times.movingSec)} size="md" />
          </Figure>
          {times.elapsedSec > times.movingSec ? (
            <Figure label={t('detail.figure.elapsed')}>
              <Metric value={formatElapsed(times.elapsedSec)} size="md" />
            </Figure>
          ) : null}
          {workout.distance > 0 ? (
            <Figure label={t('detail.figure.distance')}>
              <Metric value={distance} unit={distanceUnit} size="md" />
            </Figure>
          ) : null}
          {avgRideSpeed !== null ? (
            <Figure label={translate('cycling:header.avgSpeed')}>
              <Metric value={fmtDecimal(avgRideSpeed, 1)} unit={translate('cycling:unit.kmh')} size="md" />
            </Figure>
          ) : null}
          {workout.calories > 0 ? (
            <Figure label={t('detail.figure.calories')}>
              <Metric value={formatCount(workout.calories)} unit={t('detail.unit.kcal')} size="md" />
            </Figure>
          ) : null}
          {workout.steps > 0 ? (
            <Figure label={jumpRope ? t('detail.figure.jumps') : t('detail.figure.steps')}>
              <Metric value={formatCount(workout.steps)} size="md" />
            </Figure>
          ) : null}
          {workout.avgHr !== null ? (
            <Figure label={t('detail.figure.avgHr')}>
              <Metric value={String(workout.avgHr)} unit={t('detail.unit.bpm')} size="md" color={colors.heartText} />
            </Figure>
          ) : null}
          {workout.maxHr !== null ? (
            <Figure label={t('detail.figure.maxHr')}>
              <Metric value={String(workout.maxHr)} unit={t('detail.unit.bpm')} size="md" color={colors.heartText} />
            </Figure>
          ) : null}
        </View>
        {rideInput !== null ? <EbikeRow workoutStart={workout.start} /> : null}
        {bare ? null : (
          <>
            <ShareRunButton
              workout={workout}
              summary={shareSummary}
              route={route}
              analysis={analysisState.status === 'ready' ? analysisState.analysis : null}
              ride={rideData.ride}
            />
            <ReplayButton workout={workout} analysis={sharedAnalysis} climbs={rideData.ride?.climbs ?? null} />
            <ShareToRogoButton
              workout={workout}
              points={loaded.points}
              analysis={sharedAnalysis}
              analysisPending={analysisState.status === 'pending'}
            />
            <SaveWorkoutRouteButton workout={workout} points={loaded.points} />
          </>
        )}
        <CloudWorkoutLine start={workout.start} />
      </Card>

      {loaded.strength ? <StrengthDetailSection strength={loaded.strength} catalog={catalog} /> : null}

      {analysisState.status === 'ready' ? (
        rideData.ride !== null ? (
          <RideAnalysisView
            analysis={analysisState.analysis}
            ride={rideData.ride}
            palette={palette}
            t={analysisT}
            mapTheme={mapTheme}
            onScrubActive={setScrubbing}
            ftp={rideData.ftp}
            weightKg={rideData.weightKg}
            allTime={rideData.allTime}
            records={rideData.records}
            onUseFtp={rideData.setFtpAndRefresh}
          />
        ) : rideInput !== null && rideData.error === null ? (
          <Skeleton width="100%" height={320} radius="card" />
        ) : (
          <>
            {rideData.error !== null ? <Notice tone="danger">{t('detail.errors.analysis', { message: rideData.error })}</Notice> : null}
            <WorkoutAnalysisView analysis={analysisState.analysis} palette={palette} t={analysisT} mapTheme={mapTheme} onScrubActive={setScrubbing} />
          </>
        )
      ) : analysisState.status === 'error' ? (
        <Notice tone="danger">{t('detail.errors.analysis', { message: analysisState.message })}</Notice>
      ) : analysisState.status === 'none' ? null : (
        <Skeleton width="100%" height={320} radius="card" />
      )}
      {summary.gps === 'failed' ? <Notice icon="location-outline">{t('detail.gpsFailed')}</Notice> : null}
      <CoachFeedbackSection workoutStart={workout.start} analysis={sharedAnalysis} />

      {bare ? null : (
        <Section title={t('detail.strain.title')} icon="pulse" tint="workouts">
          {strain ? (
            <>
              <View style={styles.strainRow}>
                <Ring
                  size={72}
                  stroke={7}
                  value={strain.strain}
                  max={STRAIN_MAX}
                  color={colors.workouts}
                  track={colors.workoutsSoft}
                  accessibilityLabel={t('detail.strain.a11y', { value: fmtDecimal(strain.strain, 1), max: STRAIN_MAX })}>
                  <AppText variant="heading" style={styles.strainValue}>
                    {fmtDecimal(strain.strain, 1)}
                  </AppText>
                </Ring>
                <View style={styles.strainText}>
                  <Metric value={`+${fmtDecimal(strain.share.added, 1)}`} unit={t('detail.strain.toTheDay')} size="md" color={colors.workoutsText} unitColor={colors.workoutsText} />
                  <AppText variant="caption" muted>
                    {t('detail.strain.dayNow', { value: fmtDecimal(strain.share.dayStrain, 1) })}
                  </AppText>
                </View>
              </View>
              <Details title={t('detail.strain.how')}>{t('detail.strain.explain', { maxHr })}</Details>
            </>
          ) : (
            <Notice icon="heart-outline">{t('detail.strain.noHr')}</Notice>
          )}
        </Section>
      )}

      {effectShown ? (
        <Section title={t('detail.effect.title')} icon="fitness" tint="workouts">
          {effect.aerobic ? (
            <KeyValue
              icon="fitness-outline"
              label={t('detail.effect.aerobic')}
              value={t('detail.effect.valueWord', { value: fmtDecimal(effect.aerobic.value, 1), word: effectWord(effect.aerobic.value), source: sourceLabel(effect.aerobic.source) })}
            />
          ) : null}
          {effect.anaerobic ? (
            <KeyValue
              icon="fitness-outline"
              label={t('detail.effect.anaerobic')}
              value={t('detail.effect.valueWord', { value: fmtDecimal(effect.anaerobic.value, 1), word: effectWord(effect.anaerobic.value), source: sourceLabel('watch') })}
            />
          ) : null}
          {effect.points !== null ? (
            <KeyValue icon="ribbon-outline" label={t('detail.effect.points')} value={t('detail.effect.valueSource', { value: fmtInt(effect.points), source: sourceLabel('watch') })} />
          ) : null}
          {effect.load !== null ? (
            <KeyValue icon="barbell-outline" label={t('detail.effect.watchLoad')} value={t('detail.effect.valueSource', { value: fmtInt(effect.load), source: sourceLabel('watch') })} />
          ) : null}
          {summary.recoveryHours !== undefined && summary.recoveryHours > 0 ? (
            <KeyValue
              icon="bed-outline"
              label={t('detail.effect.recovery')}
              value={t('detail.effect.recoveryValue', { count: Math.round(summary.recoveryHours), value: fmtInt(summary.recoveryHours), source: sourceLabel('watch') })}
            />
          ) : null}
          {vo2 !== null ? (
            <KeyValue icon="pulse-outline" label={t('detail.effect.vo2max')} value={t('detail.effect.vo2Value', { value: vo2, source: sourceLabel('watch') })} />
          ) : null}
          <Details title={t('detail.effect.how')}>
            {t(effect.aerobic?.source === 'estimate' ? 'detail.effect.explainEstimate' : 'detail.effect.explainWatch')}
          </Details>
        </Section>
      ) : null}

      {burn ? (
        <Section title={t('detail.burn.title')} icon="flame" tint="workouts">
          <View style={styles.tiles}>
            <BurnFigure label={t('detail.burn.fat')} grams={burn.fatGrams} color={colors.workoutsText} />
            <BurnFigure label={t('detail.burn.carbs')} grams={burn.carbGrams} color={colors.stepsText} />
          </View>
          <FuelBar fatShare={burn.fatShare} />
          {burn.zones.map((z) => {
            const time = formatElapsed(z.seconds);
            const zoneName = t(`detail.burn.zone.${z.zone as 0 | 1 | 2 | 3 | 4 | 5}`);
            return (
              <KeyValue
                key={z.zone}
                label={z.zone === 0 ? t('detail.burn.zoneRowBelow', { label: zoneName, time }) : t('detail.burn.zoneRow', { zone: z.zone, label: zoneName, time })}
                value={t('detail.burn.grams', { fat: grams(z.fatGrams), carbs: grams(z.carbGrams) })}
              />
            );
          })}
          <Details title={t('detail.burn.how')}>{t('detail.burn.explain', { kcal: formatCount(workout.calories), maxHr })}</Details>
        </Section>
      ) : null}

      <GearWorkoutSection workout={workout} />
      <StravaWorkoutSection workout={workout} />

      <Section title={t('detail.more.title')} icon="list">
        <KeyValue
          icon="time-outline"
          label={t('detail.more.timeOfDay')}
          value={t('detail.more.timeRange', { from: formatClock(workout.start), to: formatClock(workout.end) })}
        />
        {recordedBy !== null ? <KeyValue icon="watch-outline" label={t('detail.more.recordedBy')} value={recordedBy} /> : null}
        {summary.source === 'phone' ? (
          <>
            <KeyValue icon="phone-portrait-outline" label={t('detail.more.recordedBy')} value={t('detail.more.phone')} />
            {loaded.sensors.map((sensor) => {
              const name = roleText(sensor.kinds) === '' ? sensor.name : `${sensor.name} (${roleText(sensor.kinds)})`;
              const silent = summary.sensors?.find((s) => s.id === sensor.id)?.frames === 0;
              return (
                <KeyValue
                  key={sensor.id}
                  icon="bluetooth-outline"
                  label={t('detail.more.sensor')}
                  value={silent ? `${name} · ${t('detail.more.sensorSilent')}` : name}
                />
              );
            })}
            {(summary.sensors ?? []).map((sensor) =>
              sensor.frames === 0 && (sensor.kinds.includes('csc') || sensor.kinds.includes('power')) ? (
                <Notice key={`${sensor.id}-silent`} icon="bluetooth">
                  {t('detail.more.sensorNoDataNotice', { name: sensor.name })}
                </Notice>
              ) : sensor.mode === 'speed' && sensor.kinds.includes('csc') ? (
                <Notice key={`${sensor.id}-speed`} icon="speedometer-outline">
                  {t('detail.more.sensorSpeedNotice', { name: sensor.name })}
                </Notice>
              ) : null,
            )}
          </>
        ) : null}
        {paceRows(summary, workout.distance, times.movingSec).map((row) => (
          <KeyValue key={row.key} icon="speedometer-outline" label={row.label} value={row.value} />
        ))}
        {summary.minHr !== undefined ? (
          <KeyValue icon="heart-outline" label={t('detail.more.lowestHr')} value={`${summary.minHr} ${t('detail.unit.bpm')}`} />
        ) : null}
        {elevation !== null ? (
          <>
            <KeyValue icon="trending-up-outline" label={t('detail.more.elevGain')} value={translate('common:units.m', { value: fmtInt(elevation.gainM) })} />
            <KeyValue icon="trending-down-outline" label={t('detail.more.elevLoss')} value={translate('common:units.m', { value: fmtInt(elevation.lossM) })} />
          </>
        ) : null}
        {summary.maxAltitude !== undefined ? (
          <KeyValue icon="chevron-up-circle-outline" label={t('detail.more.highest')} value={metres(summary.maxAltitude)} />
        ) : null}
        {summary.minAltitude !== undefined ? (
          <KeyValue icon="chevron-down-circle-outline" label={t('detail.more.lowest')} value={metres(summary.minAltitude)} />
        ) : null}
        {summary.avgPower !== undefined ? (
          <KeyValue icon="flash-outline" label={t('detail.more.avgPower')} value={`${fmtInt(summary.avgPower)} ${t('analysis.unit.w')}`} />
        ) : null}
        {summary.normalizedPower !== undefined ? (
          <KeyValue icon="flash-outline" label={t('detail.more.normPower')} value={`${fmtInt(summary.normalizedPower)} ${t('analysis.unit.w')}`} />
        ) : null}
        {summary.maxPower !== undefined ? (
          <KeyValue icon="flash-outline" label={t('detail.more.peakPower')} value={`${fmtInt(summary.maxPower)} ${t('analysis.unit.w')}`} />
        ) : null}
        {summary.avgCadence !== undefined ? (
          <KeyValue icon="sync-outline" label={t('detail.more.avgCadence')} value={`${fmtInt(summary.avgCadence)} ${t('analysis.unit.rpm')}`} />
        ) : null}
        {summary.maxCadence !== undefined ? (
          <KeyValue icon="sync-outline" label={t('detail.more.peakCadence')} value={`${fmtInt(summary.maxCadence)} ${t('analysis.unit.rpm')}`} />
        ) : null}
        {summary.maxDepth !== undefined ? (
          <KeyValue icon="water-outline" label={t('detail.more.maxDepth')} value={metres(summary.maxDepth)} />
        ) : null}
        {summary.importedFrom !== undefined ? (
          <Notice icon="document-outline">
            {t('detail.more.imported', { brand: summary.importedFrom, health: isIos ? t('detail.more.healthIos') : t('detail.more.healthAndroid') })}
          </Notice>
        ) : null}
        {summary.source === 'phone' && summary.kcalSource !== undefined ? (
          <Notice icon="flame-outline">{t(summary.kcalSource === 'hr' ? 'detail.more.kcalHr' : 'detail.more.kcalMet')}</Notice>
        ) : null}
        {!workout.complete ? <Notice icon="cloud-download-outline">{t('detail.more.partial')}</Notice> : null}
        {summary.missingData ? <Notice>{t('detail.more.missing')}</Notice> : null}
      </Section>

      {swimRows.length > 0 ? (
        <Section title={t('detail.swim.title')} icon="water" tint="workouts">
          {swimRows.map((row) => (
            <KeyValue key={row.key} label={row.label} value={row.value} />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

/** A small label over one summary number. */
function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.figure}>
      <AppText variant="label" muted>
        {label}
      </AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  strainRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  strainText: { flex: 1, gap: spacing.xs },
  strainValue: { fontVariant: ['tabular-nums'] },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryTitle: { flex: 1, gap: 2 },
  figures: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: spacing.sm },
  figure: { gap: 0, minWidth: '30%' },
  tiles: { flexDirection: 'row', gap: spacing.md },
});

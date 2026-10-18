import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Metric } from '@/components/Metric';
import { StatusDot } from '@/components/StatusDot';
import { Card, Divider, Section } from '@/components/Screen';
import { StatTile } from '@/components/StatTile';
import { Notice } from '@/components/States';
import { heartZone } from '@/features/live/liveWorkout';
import { kindChannels } from '@/features/sensors/store';
import { SensorLinkRow } from '@/features/sensors/ui/SensorLinkRow';
import { useAnalysisPalette } from '@/features/workouts/analysis/palette';
import { SPORT_ROWS } from '@/features/workouts/manual';
import { sportLabel } from '@/features/workouts/sportLabel';
import { formatElapsed, workoutDistanceParts } from '@/features/workouts/summary';
import { userMaxHr } from '@/features/workouts/useWorkoutStrain';
import { fmtDistance, fmtInt } from '@/i18n';
import { useRecorder } from '@/state/RecorderProvider';
import { useSensors } from '@/state/SensorsProvider';
import { spacing, useTheme } from '@/theme';

import { GpsLine } from './GpsLine';
import { lapRows, liveTiles, sensorErrorKind, speedFigure, type SensorChannel } from './format';

const DASH = '--';

interface LiveViewProps {
  /** The recording is being written to the database. */
  saving: boolean;
  /** Why the last save failed; the recording is still held and can be saved again. */
  saveError: string | null;
  onFinish: () => void;
  onSaveAgain: () => void;
  onDiscard: () => void;
}

/** Phases `active` and `saving`: the numbers of the workout on a dark panel, then the controls, the other figures and the laps. */
export function LiveView({ saving, saveError, onFinish, onSaveAgain, onDiscard }: LiveViewProps) {
  const { t } = useTranslation(['workouts', 'common']);
  const { colors, radius } = useTheme();
  const palette = useAnalysisPalette();
  const { snapshot, pause, resume, lap } = useRecorder();
  const { saved } = useSensors();
  const maxHr = useMemo(() => userMaxHr(), []);
  const { live, sport } = snapshot;

  if (!live || !sport) return null;

  const paused = live.status === 'paused';
  const failed = live.status === 'finished' && !saving;
  const busy = saving || failed;
  const channels = new Set<SensorChannel>(
    snapshot.sensorIds.flatMap((id) => kindChannels(saved.find((s) => s.id === id)?.kinds ?? [])),
  );
  const tiles = liveTiles(live, channels);
  const zone = live.hr !== null ? heartZone(live.hr, maxHr) : null;
  const distance = workoutDistanceParts(live.distanceM);
  const speed = speedFigure(sport, live.speedMps);
  const foot = SPORT_ROWS[sport].foot;
  const sportName = sportLabel(SPORT_ROWS[sport].name);
  const statusColor = paused ? colors.heroWarn : colors.heroLink;
  const laps = lapRows(snapshot.laps);
  // On a bike the cadence sits in the dark panel beside the heart rate; on foot it stays a tile below.
  const cadenceInHero = tiles.cadence && !foot;
  const sensorRows = snapshot.sensorIds.flatMap((id) => saved.find((s) => s.id === id) ?? []);

  return (
    <>
      {paused && !busy ? <Notice icon="pause-circle">{t('record.live.pausedBanner')}</Notice> : null}

      <Card style={[styles.hero, { backgroundColor: colors.hero, borderRadius: radius.card }]}>
        <View style={styles.heroHead}>
          <AppText variant="label" color={colors.heroMuted} numberOfLines={1} style={styles.sport}>
            {sportName}
          </AppText>
          <StatusDot color={statusColor} live={!paused} />
          <AppText variant="label" color={statusColor}>
            {paused ? t('record.live.status.paused') : t('record.live.status.recording')}
          </AppText>
        </View>
        {snapshot.gps ? <GpsLine fix={{ accuracyM: live.fixAccuracyM, ageSec: live.fixAgeSec }} color={colors.heroMuted} /> : null}

        <View accessible accessibilityLabel={t('record.live.timeA11y', { value: formatElapsed(live.movingSec) })} style={styles.clock}>
          <Metric value={formatElapsed(live.movingSec)} size="hero" color={colors.heroForeground} />
        </View>

        <View style={styles.pair}>
          <View accessible accessibilityLabel={`${t('record.live.distance')}: ${distance.value} ${distance.unit}`} style={styles.pairCell}>
            <AppText variant="label" color={colors.heroMuted}>
              {t('record.live.distance')}
            </AppText>
            <Metric value={distance.value} unit={distance.unit} size="lg" color={colors.heroForeground} unitColor={colors.heroMuted} />
          </View>
          <View
            accessible
            accessibilityLabel={`${speed.kind === 'pace' ? t('record.live.pace') : t('record.live.speed')}: ${speed.value ?? DASH}`}
            style={styles.pairCell}>
            <AppText variant="label" color={colors.heroMuted}>
              {speed.kind === 'pace' ? t('record.live.pace') : t('record.live.speed')}
            </AppText>
            <Metric
              value={speed.value ?? DASH}
              unit={speed.kind === 'pace' ? t('analysis.unit.perKm') : t('analysis.unit.kmh')}
              size="lg"
              color={colors.heroForeground}
              unitColor={colors.heroMuted}
            />
          </View>
        </View>

        {tiles.hr || cadenceInHero ? (
          <View style={styles.pair}>
            {tiles.hr ? (
              <View accessible accessibilityLabel={`${t('record.live.hr')}: ${live.hr === null ? DASH : fmtInt(live.hr)}`} style={styles.pairCell}>
                <AppText variant="label" color={colors.heroMuted}>
                  {t('record.live.hr')}
                </AppText>
                <Metric
                  value={live.hr === null ? DASH : fmtInt(live.hr)}
                  unit={t('analysis.unit.bpm')}
                  size="lg"
                  color={colors.heroHeart}
                  unitColor={colors.heroMuted}
                />
                {zone ? (
                  <View style={styles.zone}>
                    <View style={[styles.zoneDot, { backgroundColor: palette.zones[zone.zone - 1] }]} />
                    <AppText variant="label" color={colors.heroForeground}>
                      {t('record.live.zone', { zone: zone.zone, label: zone.label })}
                    </AppText>
                  </View>
                ) : null}
              </View>
            ) : null}
            {cadenceInHero ? (
              <View accessible accessibilityLabel={`${t('record.live.cadence')}: ${live.cadence === null ? DASH : fmtInt(live.cadence)}`} style={styles.pairCell}>
                <AppText variant="label" color={colors.heroMuted}>
                  {t('record.live.cadence')}
                </AppText>
                <Metric
                  value={live.cadence === null ? DASH : fmtInt(live.cadence)}
                  unit={t('analysis.unit.rpm')}
                  size="lg"
                  color={colors.heroForeground}
                  unitColor={colors.heroMuted}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </Card>

      {failed ? (
        <>
          <Notice tone="danger">{t('record.live.saveFailed', { error: saveError ?? DASH })}</Notice>
          <Button label={t('record.live.saveAgain')} variant="primary" icon="refresh" style={styles.big} onPress={onSaveAgain} />
          <Button label={t('record.finish.discard')} variant="destructive" icon="trash-outline" onPress={onDiscard} />
        </>
      ) : (
        <View style={styles.controls}>
          <Button
            label={paused ? t('record.live.resume') : t('record.live.pause')}
            variant="primary"
            icon={paused ? 'play' : 'pause'}
            disabled={saving}
            style={styles.big}
            onPress={paused ? resume : pause}
          />
          <View style={styles.controlRow}>
            <Button label={t('record.live.lap')} icon="flag" disabled={busy || paused} style={styles.half} onPress={lap} />
            <Button label={t('record.live.finish')} icon="stop-circle" loading={saving} disabled={saving} style={styles.half} onPress={onFinish} />
          </View>
        </View>
      )}

      <View style={styles.tiles}>
        {tiles.cadence && !cadenceInHero ? (
          <StatTile
            icon="sync"
            tint="steps"
            label={t('record.live.cadence')}
            value={live.cadence === null ? DASH : fmtInt(live.cadence)}
            unit={t(foot ? 'analysis.unit.spm' : 'analysis.unit.rpm')}
          />
        ) : null}
        {tiles.power ? (
          <StatTile icon="flash" tint="workouts" label={t('record.live.power')} value={live.watts === null ? DASH : fmtInt(live.watts)} unit={t('analysis.unit.w')} />
        ) : null}
        <StatTile icon="flame" tint="workouts" label={t('record.live.calories')} value={fmtInt(live.calories)} unit={t('analysis.unit.kcal')} />
      </View>

      <Card>
        <View style={styles.lapHead}>
          <AppText variant="bodyStrong">{t('record.live.lapName', { number: live.lapNumber })}</AppText>
          <AppText variant="caption" muted>
            {t('record.live.lapNow')}
          </AppText>
        </View>
        <AppText variant="figure" style={styles.lapStats}>
          {t('record.live.lapStats', { distance: fmtDistance(live.lapDistanceM), time: formatElapsed(live.lapMovingSec) })}
        </AppText>
      </Card>

      {laps.length > 0 ? (
        <Section title={t('record.live.laps')} icon="flag">
          {laps.map((row) => (
            <KeyValue
              key={row.number}
              label={t('record.live.lapName', { number: row.number })}
              value={
                row.avgHr === null
                  ? t('record.live.lapStats', { distance: fmtDistance(row.distanceM), time: formatElapsed(row.movingSec) })
                  : t('record.live.lapStatsHr', { distance: fmtDistance(row.distanceM), time: formatElapsed(row.movingSec), hr: fmtInt(row.avgHr) })
              }
            />
          ))}
        </Section>
      ) : null}

      {sensorRows.length > 0 ? (
        <Section title={t('record.live.sensors')} icon="bluetooth" tint="link">
          {sensorRows.map((sensor, index) => (
            <Fragment key={sensor.id}>
              {index > 0 ? <Divider /> : null}
              <SensorLinkRow sensor={sensor} managed />
            </Fragment>
          ))}
        </Section>
      ) : null}
      {snapshot.sensorError !== null ? (
        <Notice
          icon="bluetooth"
          action={
            sensorErrorKind(snapshot.sensorError) === 'permission'
              ? { label: t('record.permission.openSettings'), onPress: () => void Linking.openSettings() }
              : undefined
          }>
          {t(`record.sensorError.${sensorErrorKind(snapshot.sensorError)}`)}
        </Notice>
      ) : null}
      {snapshot.noService ? <Notice icon="battery-half">{t('record.ready.noService')}</Notice> : null}
    </>
  );
}

const styles = StyleSheet.create({
  hero: { gap: spacing.md, padding: spacing.lg },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  sport: { flex: 1 },
  clock: { alignItems: 'center', paddingVertical: spacing.xs },
  pair: { flexDirection: 'row', gap: spacing.md },
  pairCell: { flex: 1, gap: 2 },
  zone: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  zoneDot: { width: 12, height: 12, borderRadius: 6 },
  controls: { gap: spacing.sm },
  controlRow: { flexDirection: 'row', gap: spacing.sm },
  big: { minHeight: 64 },
  half: { flex: 1, minHeight: 52 },
  tiles: { flexDirection: 'row', gap: spacing.md },
  lapHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  lapStats: { fontVariant: ['tabular-nums'] },
});

import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { IconChip } from '@/components/IconChip';
import { Metric } from '@/components/Metric';
import { Card, Screen, Section } from '@/components/Screen';
import { StatTile } from '@/components/StatTile';
import { EmptyState } from '@/components/States';
import { useHrZones } from '@/features/hrzones/settings';
import { BurnFigure, FuelBar } from '@/features/live/FuelBar';
import {
  distanceParts,
  elapsedSec,
  endPromptVisible,
  heartZone,
  isActive,
  livePhase,
  paceValue,
  prefersSpeed,
  showsClock,
} from '@/features/live/liveWorkout';
import { isStrengthSport } from '@/features/strength/watchLive';
import { sportIcon } from '@/features/workouts/sportIcon';
import { formatElapsed } from '@/features/workouts/summary';
import { fmtDecimal, fmtInt } from '@/i18n';
import { useNow } from '@/hooks/useNow';
import { isLinkUp } from '@/features/device/linkState';
import { useLiveWorkout } from '@/state/LiveWorkoutProvider';
import { useWatch } from '@/state/WatchProvider';
import { radius, spacing, useColors } from '@/theme';
import { HuaweiWear, type LiveWorkout } from '@/wear';
import { sportLabel } from '@/features/workouts/sportLabel';

const TICK_MS = 1_000;
const DASH = '--';

/** A workout started on the watch, as it happens: time, heart rate, distance, pace, calories, and fat and carbs burned. */
export function LiveWorkoutScreen() {
  const { t } = useTranslation(['sharing', 'common']);
  const live = useLiveWorkout();
  const router = useRouter();
  const { linkState } = useWatch();
  // "Keep going" holds while the suspicion lasts; when the watch proves itself running again, a later one asks again.
  const [kept, setKept] = useState(false);
  const suspected = live?.endSuspected === true;
  // Adjusting state while rendering (not in an effect): the answer is forgotten as soon as the suspicion is gone.
  if (kept && !suspected) setKept(false);

  if (!live) {
    return (
      <Screen>
        <HiddenTabHeader title={t('live.title')} />
        <EmptyState
          icon="walk"
          title={t('live.emptyTitle')}
          description={t('live.emptyDescription')}
          action={isLinkUp(linkState) ? { label: t('live.start'), icon: 'play', onPress: () => HuaweiWear.startLiveWorkout() } : undefined}
        />
      </Screen>
    );
  }

  // A strength workout belongs in the strength logger, not here.
  if (isActive(live) && isStrengthSport(live.sportType)) return <Redirect href="/strength/watch-pick" />;

  return (
    <Screen>
      <HiddenTabHeader title={live.sportName ? sportLabel(live.sportName) : t('live.title')} />
      {isActive(live) && live.sportType === null ? (
        <Button label={t('live.logStrength')} icon="barbell" onPress={() => router.push('/strength/watch-pick')} />
      ) : null}
      {endPromptVisible(live, kept) ? (
        <Card>
          <AppText variant="bodyStrong">{t('live.endPrompt.title')}</AppText>
          <AppText variant="caption" muted>
            {t('live.endPrompt.body')}
          </AppText>
          <Button label={t('live.endPrompt.finish')} variant="primary" icon="stop" onPress={() => HuaweiWear.finishLiveWorkout()} />
          <Button label={t('live.endPrompt.keep')} onPress={() => setKept(true)} />
        </Card>
      ) : null}
      <LiveBody live={live} />
      {live.status === 'ended' ? (
        <Button
          label={t('common:actions.done')}
          variant="primary"
          icon="checkmark"
          onPress={() => {
            HuaweiWear.dismissLiveWorkout();
            router.replace('/workouts');
          }}
        />
      ) : live.source !== 'watch' ? (
        <Button label={t('live.finish')} icon="stop" onPress={() => HuaweiWear.finishLiveWorkout()} />
      ) : null}
    </Screen>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.pair}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={styles.pairValue}>
        {value}
      </AppText>
    </View>
  );
}

function LiveBody({ live }: { live: LiveWorkout }) {
  const { t } = useTranslation('sharing');
  const colors = useColors();
  const zones = useHrZones();
  const nowMs = useNow(TICK_MS);
  const seconds = elapsedSec(live, nowMs);
  const phase = livePhase(live);
  const zone = live.heartRate !== null ? heartZone(live.heartRate, zones) : null;
  const distance = live.distanceM !== null ? distanceParts(live.distanceM) : null;
  const speed = prefersSpeed(live);
  const statusColor = live.status === 'running' ? colors.link : live.status === 'paused' ? colors.warning : colors.mutedForeground;

  return (
    <>
      <Card>
        <View style={styles.head}>
          <IconChip sport={sportIcon(live.sportName ?? '')} tint="workouts" size="lg" />
          <View style={styles.headText}>
            <AppText variant="heading" numberOfLines={1}>
              {live.sportName ? sportLabel(live.sportName) : t('live.workout')}
            </AppText>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: statusColor }]} />
              <AppText variant="label" color={statusColor}>
                {t(`live.status.${phase}`)}
              </AppText>
            </View>
          </View>
        </View>
        <View accessible accessibilityLabel={t('live.timeA11y', { value: formatElapsed(seconds) })} style={styles.clock}>
          <Metric value={showsClock(live) ? formatElapsed(seconds) : DASH} size="hero" />
        </View>
        {phase === 'searching' ? (
          <AppText variant="caption" muted style={styles.hint}>
            {t('live.searchingHint')}
          </AppText>
        ) : null}
        <View style={styles.heartRow}>
          <Metric
            value={live.heartRate !== null ? fmtInt(live.heartRate) : DASH}
            unit="bpm"
            size="lg"
            color={colors.heartText}
            unitColor={colors.mutedForeground}
          />
          {zone ? (
            <View style={[styles.zone, { backgroundColor: colors.heartSoft }]}>
              <AppText variant="label" color={colors.heartText}>
                {t('live.zone', { zone: zone.zone, label: zone.label })}
              </AppText>
            </View>
          ) : null}
        </View>
      </Card>

      <View style={styles.tiles}>
        <StatTile icon="trail-sign" tint="steps" label={t('live.tiles.distance')} value={distance?.value ?? DASH} unit={distance?.unit} />
        {speed ? (
          <StatTile icon="speedometer" tint="steps" label={t('live.tiles.speed')} value={live.speedKmh !== null ? fmtDecimal(live.speedKmh, 1) : DASH} unit="km/h" />
        ) : (
          <StatTile icon="speedometer" tint="steps" label={t('live.tiles.pace')} value={live.paceSecPerKm ? paceValue(live.paceSecPerKm) : DASH} unit="/km" />
        )}
      </View>

      <Section title={t('live.burned.title')} icon="flame" tint="workouts">
        <View style={styles.burnRow}>
          <BurnFigure label={t('live.burned.fat')} grams={live.fatGrams} color={colors.workoutsText} />
          <BurnFigure label={t('live.burned.carbs')} grams={live.carbGrams} color={colors.stepsText} />
          <View style={styles.burnFigure}>
            <AppText variant="label" muted>
              {t('live.burned.calories')}
            </AppText>
            <Metric value={live.calories !== null ? fmtInt(live.calories) : DASH} unit="kcal" size="md" />
          </View>
        </View>
        <FuelBar fatShare={live.fatShare} />
        <Details title={t('live.calc.title')}>
          {t(live.source !== 'watch' ? 'live.calc.phone' : 'live.calc.watch', { max: live.maxHeartRate })}
        </Details>
      </Section>

      <Section title={t('live.more.title')} icon="list">
        <View style={styles.grid}>
          {live.steps !== null ? <Pair label={t('live.more.steps')} value={fmtInt(live.steps)} /> : null}
          {live.stepRate !== null ? <Pair label={t('live.more.cadence')} value={t('live.more.stepRate', { value: fmtInt(live.stepRate) })} /> : null}
          {live.cadence !== null && live.cadence > 0 ? <Pair label={t('live.more.cadence')} value={`${fmtInt(live.cadence)} rpm`} /> : null}
          {speed ? null : live.speedKmh !== null ? <Pair label={t('live.more.speed')} value={`${fmtDecimal(live.speedKmh, 1)} km/h`} /> : null}
          {live.altitudeM !== null ? <Pair label={t('live.more.altitude')} value={`${fmtInt(live.altitudeM)} m`} /> : null}
          {live.riseM !== null ? <Pair label={t('live.more.climb')} value={`${fmtInt(live.riseM)} m`} /> : null}
          {live.descentM !== null ? <Pair label={t('live.more.descent')} value={`${fmtInt(live.descentM)} m`} /> : null}
          {live.aerobicTe !== null ? <Pair label={t('live.more.aerobicEffect')} value={fmtDecimal(live.aerobicTe, 1)} /> : null}
          {live.anaerobicTe !== null ? <Pair label={t('live.more.anaerobicEffect')} value={fmtDecimal(live.anaerobicTe, 1)} /> : null}
        </View>
        {live.durationSec === null ? (
          <AppText variant="caption" muted>
            {t('live.more.waiting')}
          </AppText>
        ) : null}
        {live.status === 'ended' ? (
          <Details>{t('live.more.ended')}</Details>
        ) : null}
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headText: { flex: 1, gap: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  clock: { alignItems: 'center' },
  hint: { textAlign: 'center' },
  heartRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  zone: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  burnRow: { flexDirection: 'row', gap: spacing.md },
  burnFigure: { flex: 1, gap: 2 },
  tiles: { flexDirection: 'row', gap: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm, columnGap: spacing.md },
  pair: { width: '47%' },
  pairValue: { fontVariant: ['tabular-nums'] },
});

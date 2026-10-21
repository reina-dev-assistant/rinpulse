import { useSQLiteContext } from 'expo-sqlite';
import { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { FadeIn } from '@/components/motion';
import { Metric } from '@/components/Metric';
import { KeyValue } from '@/components/KeyValue';
import { Ring } from '@/components/Ring';
import { Screen, Section } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { computeFitnessOverview } from '@/features/fitness/compute';
import { formatRaceTime, sourceLabel } from '@/features/fitness/format';
import { WEEKLY_TARGET_MIN } from '@/features/fitness/intensityMinutes';
import { recentRuns, useRunEfforts } from '@/features/fitness/runEfforts';
import { Sparkline } from '@/features/fitness/Sparkline';
import { raceLabel } from '@/features/fitness/racePredictor';
import { CHRONIC_DAYS, MIN_LOAD_DAYS } from '@/features/fitness/trainingLoad';
import { useFitnessData } from '@/features/fitness/useFitnessData';
import { availabilityText } from '@/features/today/nightHrv';
import { useNightHrvAvailability } from '@/features/today/useNightHrvAvailability';
import { TrendChart } from '@/features/trends/TrendChart';
import { dayStarts } from '@/features/trends/series';
import { fmtDate, fmtDecimal, fmtInt, useLocale, useTranslation } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useColors } from '@/theme';

function Tag({ source }: { source: 'watch' | 'estimate' }) {
  return (
    <AppText variant="caption" muted>
      {sourceLabel(source)}
    </AppText>
  );
}

/** Kebugaran: VO2max, training status and load, race predictions, HRV status and the week's intensity minutes. */
export function FitnessScreen() {
  const { t } = useTranslation(['health', 'common']);
  const locale = useLocale();
  const db = useSQLiteContext();
  const colors = useColors();
  const { linkState, device, dataVersion, sync } = useWatch();
  const { data, error } = useFitnessData(dataVersion, 'full');
  const availability = useNightHrvAvailability(dataVersion);
  const canSync = linkState === 'connected' && device !== null;

  const runs = useMemo(() => (data ? recentRuns(data.workouts, data.nowSec) : null), [data]);
  const efforts = useRunEfforts(db, runs);
  const view = useMemo(() => (data && efforts ? computeFitnessOverview(data, efforts) : null), [data, efforts, locale]);
  // Everything but the race predictor is ready as soon as the data is; the predictor waits for the GPS points of the runs.
  const early = useMemo(() => (data ? computeFitnessOverview(data, []) : null), [data, locale]);
  const shown = view ?? early;

  const loadDays = useMemo(() => (data ? dayStarts(data.dayStart, CHRONIC_DAYS) : []), [data]);
  const loadSeries = useMemo(() => {
    if (!data) return [];
    const byDay = new Map(data.strain.map((d) => [d.day, d.trimp]));
    return loadDays.map((day) => byDay.get(day) ?? null);
  }, [data, loadDays]);

  const ios = Platform.OS === 'ios';
  const vo2Decimals = shown?.vo2?.source === 'watch' ? 0 : 1;

  return (
    <Screen refresh={{ refreshing: linkState === 'syncing', onRefresh: () => void sync(), enabled: canSync }}>
      <HiddenTabHeader title={t('fitness.title')} />
      {error ? <Notice tone="danger">{t('fitness.screen.loadError', { error })}</Notice> : null}
      {!data || !shown ? (
        error ? null : <Skeleton width="100%" height={260} radius="card" />
      ) : (
        <>
          <FadeIn>
            <Section title={t('fitness.screen.vo2.title')} icon="pulse" tint="heart">
              {shown.vo2 ? (
                <>
                  <View style={styles.row}>
                    <Metric value={fmtDecimal(shown.vo2.value, vo2Decimals)} unit={t('fitness.screen.vo2.unit')} size="lg" color={colors.heartText} unitColor={colors.mutedForeground} />
                    <View style={styles.text}>
                      <Tag source={shown.vo2.source} />
                      {shown.vo2.delta !== null ? (
                        <AppText variant="caption" muted>
                          {t('fitness.screen.vo2.delta', {
                            delta: `${shown.vo2.delta >= 0 ? '+' : ''}${fmtDecimal(shown.vo2.delta, vo2Decimals)}`,
                            date: fmtDate(shown.vo2.trend[0].at, 'short'),
                          })}
                        </AppText>
                      ) : null}
                    </View>
                  </View>
                  {shown.vo2.trend.length > 1 ? <Sparkline values={shown.vo2.trend.map((p) => p.value)} color={colors.heart} label={t('fitness.screen.vo2.trend')} readout={shown.vo2.trend.map((p) => ({ title: fmtDate(p.at, 'medium'), text: `${fmtDecimal(p.value, vo2Decimals)} ${t('fitness.screen.vo2.unit')}` }))} /> : null}
                </>
              ) : (
                <AppText variant="caption" muted>
                  {t('fitness.screen.vo2.none')}
                </AppText>
              )}
              <Details title={t('fitness.screen.howTitle')}>
                {t('fitness.screen.vo2.how')}
              </Details>
            </Section>
          </FadeIn>

          <FadeIn delay={40}>
            <Section title={t('fitness.screen.load.title')} icon="trending-up" tint="workouts">
              {shown.load.kind === 'ok' ? (
                <>
                  <View style={styles.row}>
                    <Metric value={t(`fitness.trainingStatus.${shown.load.status}.word`)} size="md" color={colors.workoutsText} />
                    <View style={styles.text}>
                      <AppText variant="caption" muted>
                        {t('fitness.screen.load.ratio', { ratio: fmtDecimal(shown.load.ratio, 2) })}
                      </AppText>
                    </View>
                  </View>
                  <AppText variant="caption" muted>
                    {t(`fitness.trainingStatus.${shown.load.status}.hint`)}
                  </AppText>
                  <KeyValue icon="flash-outline" label={t('fitness.screen.load.avg7')} value={t('fitness.screen.load.perDay', { value: fmtInt(shown.load.acute) })} />
                  <KeyValue icon="calendar-outline" label={t('fitness.screen.load.avg28')} value={t('fitness.screen.load.perDay', { value: fmtInt(shown.load.chronic) })} />
                  <TrendChart values={loadSeries} kind="bar" color={colors.workouts} format={(v) => t('fitness.screen.load.perDay', { value: fmtInt(v) })} firstDay={loadDays[0]} label={t('fitness.screen.load.chart')} endLabel={t('common:time.yesterday')} />
                </>
              ) : (
                <AppText variant="caption" muted>
                  {shown.load.kind === 'short'
                    ? t('fitness.screen.load.short', { need: MIN_LOAD_DAYS, count: shown.load.daysWithData })
                    : t('fitness.screen.load.none')}
                </AppText>
              )}
              <Details title={t('fitness.screen.howTitle')}>
                {t('fitness.screen.load.how')}
              </Details>
            </Section>
          </FadeIn>

          <FadeIn delay={80}>
            <Section title={t('fitness.screen.races.title')} icon="trophy" tint="steps">
              {view === null ? (
                <Skeleton width="100%" height={96} radius="card" />
              ) : view.races.kind === 'ok' ? (
                <>
                  {view.races.predictions.map((p) => (
                    <KeyValue key={p.key} icon="stopwatch-outline" label={raceLabel(p.key)} value={formatRaceTime(p.seconds)} />
                  ))}
                  <AppText variant="caption" muted>
                    {t('fitness.screen.races.note')}
                  </AppText>
                </>
              ) : (
                <AppText variant="caption" muted>
                  {t('fitness.screen.races.short', { need: view.races.need, count: view.races.runs })}
                </AppText>
              )}
              <Details title={t('fitness.screen.howTitle')}>
                {t('fitness.screen.races.how')}
              </Details>
            </Section>
          </FadeIn>

          <FadeIn delay={120}>
            <Section title={t('fitness.screen.hrv.title')} icon="heart" tint="heart">
              {ios ? (
                <Notice icon="phone-portrait-outline">{availabilityText(availability) ?? t('fitness.screen.hrv.iosFallback')}</Notice>
              ) : 'status' in shown.hrv ? (
                <>
                  <View style={styles.row}>
                    <Metric value={t(`fitness.hrvState.${shown.hrv.status.state}`)} size="md" color={colors.heartText} />
                    <View style={styles.text}>
                      <AppText variant="caption" muted>
                        {t('fitness.screen.hrv.estimate', { value: fmtInt(shown.hrv.status.recentMs) })}
                      </AppText>
                    </View>
                  </View>
                  <AppText variant="caption" muted>
                    {t(`fitness.hrvHint.${shown.hrv.status.state}`)}
                  </AppText>
                  <KeyValue label={t('fitness.screen.hrv.range')} value={t('fitness.screen.hrv.rangeValue', { low: fmtInt(shown.hrv.status.lowMs), high: fmtInt(shown.hrv.status.highMs) })} />
                  <KeyValue label={t('fitness.screen.hrv.avg')} value={t('fitness.screen.hrv.avgValue', { value: fmtInt(shown.hrv.status.recentMs), count: shown.hrv.status.recentNights })} />
                </>
              ) : (
                <AppText variant="caption" muted>
                  {[t('fitness.screen.hrv.missing', { reason: shown.hrv.missing }), availabilityText(availability)].filter(Boolean).join(' ')}
                </AppText>
              )}
              <Details title={t('fitness.screen.howTitle')}>
                {t('fitness.screen.hrv.how')}
              </Details>
            </Section>
          </FadeIn>

          <FadeIn delay={160}>
            <Section title={t('fitness.screen.intensity.title')} icon="timer" tint="link">
              <View style={styles.row}>
                <Ring
                  size={84}
                  stroke={8}
                  value={shown.intensity.total}
                  max={WEEKLY_TARGET_MIN}
                  color={colors.link}
                  track={colors.linkSoft}
                  accessibilityLabel={t('fitness.screen.intensity.a11y', { value: fmtInt(shown.intensity.total), target: WEEKLY_TARGET_MIN })}>
                  <AppText variant="heading" style={styles.figure}>
                    {Math.round(shown.intensity.total)}
                  </AppText>
                </Ring>
                <View style={styles.text}>
                  <AppText variant="bodyStrong">{t('fitness.screen.intensity.headline', { target: WEEKLY_TARGET_MIN })}</AppText>
                  <AppText variant="caption" muted>
                    {t('fitness.screen.intensity.breakdown', { moderate: fmtInt(shown.intensity.moderate), vigorous: fmtInt(shown.intensity.vigorous) })}
                  </AppText>
                </View>
              </View>
              <TrendChart
                values={shown.intensity.days.map((d) => (d.day <= data.dayStart ? d.total : null))}
                kind="bar"
                color={colors.link}
                format={(v) => t('fitness.screen.intensity.minutes', { value: fmtInt(v) })}
                firstDay={shown.intensity.weekStart}
                label={t('fitness.screen.intensity.chart')}
                endLabel={t('fitness.screen.intensity.endLabel')}
              />
              <Details title={t('fitness.screen.howTitle')}>
                {t('fitness.screen.intensity.how', { maxHr: data.maxHr })}
              </Details>
            </Section>
          </FadeIn>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  text: { flex: 1, gap: 2 },
  figure: { fontVariant: ['tabular-nums'] },
});

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Notice, Skeleton } from '@/components/States';
import { ShareMenuButton } from '@/features/stickers/ui/ShareMenuButton';
import { buildNights } from '@/features/sleep/nights';
import { nightHrvTrendEmpty, recoveryTrendEmpty } from '@/features/today/nightHrv';
import { useNightHrvAvailability } from '@/features/today/useNightHrvAvailability';
import { STRAIN_MAX } from '@/features/today/strain';
import {
  hrvSeries,
  recoverySeries,
  seriesFromMap,
  sleepSeries,
  strainSeries,
  TREND_RANGES,
  type TrendRange,
} from '@/features/trends/series';
import { TrendCard } from '@/features/trends/TrendCard';
import { useTrendsData } from '@/features/trends/useTrendsData';
import { fmtDecimal, fmtDuration, fmtInt, fmtPercent, useLocale } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';


/** Recovery, strain, sleep, HRV and resting heart rate per day over 30 or 90 days, from the stored history. */
export function TrendsScreen() {
  const { t } = useTranslation('today');
  const locale = useLocale();
  const { linkState, device, dataVersion, sync } = useWatch();
  const [range, setRange] = useState<TrendRange>(30);
  const { data, error } = useTrendsData(range, dataVersion);
  const nightHrv = useNightHrvAvailability(dataVersion);
  const canSync = linkState === 'connected' && device !== null;
  const rangeOptions = TREND_RANGES.map((value) => ({ value, label: t('trends.range', { count: value }) }));

  const trends = useMemo(() => {
    if (!data) return null;
    const { maxHr, strain } = data;
    return {
      days: data.days,
      maxHr,
      recovery: recoverySeries(data.days, data.hrv),
      hrvNight: hrvSeries(data.days, data.hrv, 'night'),
      hrvSpot: hrvSeries(data.days, data.hrv, 'spot'),
      resting: seriesFromMap(data.days, data.resting),
      strain: strainSeries(data.days, strain),
      sleep: sleepSeries(data.days, buildNights(data.sleep, []), strain),
    };
  }, [data]);

  return (
    <Screen refresh={{ refreshing: linkState === 'syncing', onRefresh: () => void sync(), enabled: canSync }}>
      <HiddenTabHeader title={t('trends.title')} right={<ShareMenuButton dataVersion={dataVersion} />} />
      <Segmented options={rangeOptions} value={range} onChange={setRange} />
      {error ? <Notice tone="danger">{t('trends.loadError', { error })}</Notice> : null}
      {trends ? (
        <View style={styles.cards}>
          <TrendCard
            title={t('trends.recovery')}
            tint="link"
            kind="line"
            values={trends.recovery}
            firstDay={trends.days[0]}
            domain={[0, 100]}
            format={(v) => fmtPercent(v)}
            empty={recoveryTrendEmpty(nightHrv)}
          />
          <TrendCard
            title={t('trends.strain')}
            tint="workouts"
            kind="bar"
            values={trends.strain}
            firstDay={trends.days[0]}
            domain={[0, STRAIN_MAX]}
            format={(v) => fmtDecimal(v, 1)}
            empty={t('trends.emptyStrain')}
          />
          <TrendCard
            title={t('trends.sleep')}
            tint="sleep"
            kind="bar"
            values={trends.sleep.hours}
            firstDay={trends.days[0]}
            reference={trends.sleep.need}
            format={(v) => fmtDuration(v * 3600)}
            empty={t('trends.emptySleep')}
          />
          <TrendCard
            title={t('trends.hrvNights')}
            tint="sleep"
            kind="line"
            values={trends.hrvNight}
            firstDay={trends.days[0]}
            format={(v) => `${fmtInt(v)} ms`}
            empty={nightHrvTrendEmpty(nightHrv)}
          />
          <TrendCard
            title={t('trends.hrvSpot')}
            tint="steps"
            kind="line"
            values={trends.hrvSpot}
            firstDay={trends.days[0]}
            format={(v) => `${fmtInt(v)} ms`}
            empty={t('trends.emptySpot')}
          />
          <TrendCard
            title={t('trends.resting')}
            tint="heart"
            kind="line"
            values={trends.resting}
            firstDay={trends.days[0]}
            format={(v) => `${fmtInt(v)} bpm`}
            empty={t('trends.emptyResting')}
          />
          <Details title={t('trends.howTitle')}>
            <AppText variant="caption" muted>
              {t('trends.howRecovery')}
            </AppText>
            <AppText variant="caption" muted>
              {t('trends.howStrain', { maxHr: trends.maxHr })}
            </AppText>
            <AppText variant="caption" muted>
              {t('trends.howSleep')}
            </AppText>
            <AppText variant="caption" muted>
              {t('trends.howHrv')}
            </AppText>
            <AppText variant="caption" muted>
              {t('trends.howResting')}
            </AppText>
          </Details>
        </View>
      ) : error ? null : (
        <Skeleton width="100%" height={260} radius="card" />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cards: { gap: spacing.sm },
});

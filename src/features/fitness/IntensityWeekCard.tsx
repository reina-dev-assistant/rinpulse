import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { FadeIn } from '@/components/motion';
import { InfoPill } from '@/components/InfoPill';
import { Metric } from '@/components/Metric';
import { Section } from '@/components/Screen';
import { Skeleton } from '@/components/States';
import { WeekPills, type WeekPill } from '@/components/WeekPills';
import { ACTIVE_DAY_MIN, intensityMinutes, mondayOf } from '@/features/fitness/intensityMinutes';
import type { FitnessData } from '@/features/fitness/useFitnessData';
import { fmtDate, fmtInt, useTranslation } from '@/i18n';
import { spacing } from '@/theme';

/**
 * Today card: this week's intensity minutes against the 150-minute guideline (WHO 2020, ACSM 2018), Monday to Sunday, from the
 * heart rate the watch stored (`intensityMinutes`). One figure, the pills for which days counted, one chip for what is left. The whole
 * card opens Kebugaran, where the split between moderate and vigorous minutes and the chart live.
 *
 * A week with no stored heart rate says so instead of showing 0: zero minutes and "no heart rate yet" are different things.
 */
export function IntensityWeekCard({ data }: { data: FitnessData | null }) {
  const { t } = useTranslation('health');
  const router = useRouter();

  const week = useMemo(() => {
    if (!data) return null;
    const intensity = intensityMinutes(data.strain, mondayOf(data.dayStart), data.zones.method);
    const hasHeartRate = data.strain.some((d) => d.day >= intensity.weekStart && d.coveredMinutes > 0);
    return { intensity, hasHeartRate, dayStart: data.dayStart };
  }, [data]);

  if (!week) return <Skeleton width="100%" height={190} radius="card" />;

  const { intensity, hasHeartRate, dayStart } = week;
  const total = Math.round(intensity.total);
  const left = Math.max(0, intensity.target - total);
  const pills: WeekPill[] = intensity.days.map((d) => {
    const minutes = Math.round(d.total);
    const hit = d.total >= ACTIVE_DAY_MIN;
    const day = fmtDate(d.day, 'dayShort');
    return {
      key: d.day,
      label: day,
      hit,
      today: d.day === dayStart,
      future: d.day > dayStart,
      a11y: d.day > dayStart ? day : t('fitness.today.intensity.dayA11y', { day, minutes: fmtInt(minutes), count: minutes }),
    };
  });

  return (
    <FadeIn>
      <Section
        title={t('fitness.today.intensity.title')}
        icon="timer"
        tint="link"
        trailing={
          <AppText variant="caption" muted>
            {t('fitness.today.navTitle')}
          </AppText>
        }
        onPress={() => router.push('/fitness')}>
        <View style={styles.head}>
          <View style={styles.figure}>
            <Metric value={hasHeartRate ? fmtInt(total) : '--'} unit={t('fitness.today.intensity.unit')} size="md" />
            <AppText variant="caption" muted>
              {t('fitness.today.intensity.of', { target: fmtInt(intensity.target) })}
            </AppText>
          </View>
          {hasHeartRate ? (
            <InfoPill
              label={left === 0 ? t('fitness.today.intensity.done') : t('fitness.today.intensity.left', { value: fmtInt(left) })}
              tint={left === 0 ? 'link' : undefined}
            />
          ) : null}
        </View>
        <WeekPills days={pills} tint="link" />
        {hasHeartRate ? null : (
          <AppText variant="caption" muted>
            {t('fitness.today.intensity.noHeartRate')}
          </AppText>
        )}
      </Section>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  figure: { flexShrink: 1 },
});

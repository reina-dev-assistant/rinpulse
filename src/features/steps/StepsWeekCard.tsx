import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BarChart, type BarDatum } from '@/components/BarChart';
import { FadeIn } from '@/components/motion';
import { InfoPill } from '@/components/InfoPill';
import { PressableScale } from '@/components/PressableScale';
import { Section } from '@/components/Screen';
import { Skeleton } from '@/components/States';
import { useDailySteps } from '@/features/steps/useStepsData';
import { stepsLeft, weekSteps } from '@/features/steps/weekView';
import { dayStarts } from '@/features/trends/series';
import { fmtDate, fmtInt } from '@/i18n';
import { spacing, useColors } from '@/theme';

const BAR_AREA_HEIGHT = 96;
const DAYS = 7;

interface Props {
  /** Local midnight of today; null until Today's data has been read. */
  dayStart: number | null;
  /** Today's steps as the hero ring shows them (the watch's own counter when it has one); the last bar uses it so the two always agree. */
  todaySteps: number;
  goal: number;
  /** The goal is the app's default (no profile saved): the legend says so. */
  goalIsDefault: boolean;
  dataVersion: number;
}

/**
 * Today card: the last seven days of steps as bars, the daily goal as a dashed line, a check on the days that reached it, and two
 * chips: what is left of today's goal, and the seven-day total. Today's own number is the hero ring's, so it is not printed again here.
 * "Detail" opens the steps screen (day, week, month, 3 months, year).
 */
export function StepsWeekCard({ dayStart, todaySteps, goal, goalIsDefault, dataVersion }: Props) {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation('today');
  const days = useMemo(() => (dayStart === null ? [] : dayStarts(dayStart, DAYS)), [dayStart]);
  const daily = useDailySteps(days, dataVersion);

  const view = useMemo(() => {
    if (!daily || dayStart === null) return null;
    const { values, total, today } = weekSteps(days, daily, dayStart, todaySteps);
    const data: BarDatum[] = days.map((day, i) => ({
      key: day,
      value: values[i],
      title: fmtDate(day, 'weekday'),
      text: t('week.bar', { steps: fmtInt(values[i]), count: values[i] }),
      short: fmtInt(values[i]),
      hit: values[i] >= goal,
    }));
    return { data, total, today };
  }, [daily, days, dayStart, todaySteps, goal, t]);

  if (!view) return <Skeleton width="100%" height={210} radius="card" />;

  const left = stepsLeft(goal, view.today);

  return (
    <FadeIn>
      <Section
        title={t('home.stepsTitle')}
        icon="footsteps"
        tint="steps"
        trailing={
          <PressableScale
            accessibilityRole="link"
            accessibilityLabel={t('week.detailA11y')}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 4 }}
            onPress={() => router.push('/steps')}
            style={styles.detail}>
            <AppText variant="caption" muted>
              {t('week.detail')}
            </AppText>
            <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
          </PressableScale>
        }>
        <BarChart
          data={view.data}
          color={colors.steps}
          height={BAR_AREA_HEIGHT}
          gap={6}
          goal={goal}
          tick={(i) => fmtDate(days[i], 'dayShort')}
          tickWidth={34}
        />
        <View style={styles.chips}>
          <InfoPill label={left === 0 ? t('week.reached') : t('week.left', { value: fmtInt(left) })} tint={left === 0 ? 'steps' : undefined} />
          <InfoPill label={t('week.total', { value: fmtInt(view.total) })} />
        </View>
        <AppText variant="caption" muted>
          {goalIsDefault ? t('week.legendDefault') : t('week.legend')}
        </AppText>
      </Section>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  detail: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

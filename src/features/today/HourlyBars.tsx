import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BarChart, type BarDatum } from '@/components/BarChart';
import { fmtClock, fmtInt } from '@/i18n';
import { useColors } from '@/theme';

const BAR_AREA_HEIGHT = 96;
const LABEL_EVERY_HOURS = 6;

/** 24 bars, one per local hour, scaled to the busiest hour. Touch a bar to read its steps. */
export function HourlyBars({ steps }: { steps: readonly number[] }) {
  const colors = useColors();
  const { t } = useTranslation('today');
  const peak = Math.max(...steps);
  const peakHour = steps.indexOf(peak);
  const hour = fmtClock(new Date(2000, 0, 1, peakHour));
  const data: BarDatum[] = steps.map((value, h) => ({
    key: h,
    value,
    title: fmtClock(new Date(2000, 0, 1, h)),
    text: t('hourly.bar', { steps: fmtInt(value), count: value }),
    short: fmtInt(value),
  }));

  return (
    <View style={styles.wrap}>
      <BarChart
        data={data}
        color={colors.steps}
        height={BAR_AREA_HEIGHT}
        gap={3}
        current={null}
        tick={(h) => (h % LABEL_EVERY_HOURS === 0 || h === 23 ? String(h) : null)}
        tickWidth={24}
      />
      <AppText variant="caption" muted>
        {peak > 0 ? t('hourly.peak', { hour, steps: fmtInt(peak), count: peak }) : t('hourly.empty')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
});

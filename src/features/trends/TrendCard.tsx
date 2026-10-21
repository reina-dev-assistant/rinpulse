import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Screen';
import { TrendChart } from '@/features/trends/TrendChart';
import { summarize, type DaySeries } from '@/features/trends/series';
import { t as translate } from '@/i18n';
import { spacing, tintColors, useColors, type Tint } from '@/theme';

interface TrendCardProps {
  title: string;
  tint: Tint;
  values: DaySeries;
  kind: 'line' | 'bar';
  /** Number with its unit, e.g. `62 ms`. */
  format: (value: number) => string;
  /** First day of the range, local midnight. */
  firstDay: number;
  domain?: readonly [number, number];
  reference?: readonly number[];
  /** Shown when the whole range has no value: what is missing and how to get it. */
  empty: string;
}

function ago(days: number): string {
  if (days === 0) return translate('today:trends.today');
  if (days === 1) return translate('today:trends.yesterday');
  return translate('today:trends.daysAgo', { count: days });
}

/** One metric over the range: latest value, the range average, a chart, and an empty state that says what is missing. */
export function TrendCard({ title, tint, values, kind, format, firstDay, domain, reference, empty }: TrendCardProps) {
  const colors = useColors();
  const { t } = useTranslation('today');
  const tinted = tintColors(colors, tint);
  const summary = summarize(values);

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.title}>
          <AppText variant="bodyStrong">{title}</AppText>
          {summary ? (
            <AppText variant="caption" muted>
              {t('trends.summary', { average: format(summary.average), count: summary.count, total: values.length })}
            </AppText>
          ) : null}
        </View>
        {summary ? (
          <View style={styles.latest}>
            <AppText variant="heading" color={tinted.text} style={styles.figure}>
              {format(summary.latest)}
            </AppText>
            <AppText variant="caption" muted>
              {ago(summary.daysAgo)}
            </AppText>
          </View>
        ) : null}
      </View>
      {summary ? (
        <>
          <TrendChart
            values={values}
            kind={kind}
            color={tinted.base}
            firstDay={firstDay}
            domain={domain}
            reference={reference}
            average={summary.average}
            format={format}
            label={t('trends.chartA11y', {
              title,
              count: values.length,
              latest: format(summary.latest),
              when: ago(summary.daysAgo),
              average: format(summary.average),
            })}
          />
        </>
      ) : (
        <AppText variant="caption" muted>
          {empty}
        </AppText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  title: { flex: 1, gap: 0 },
  latest: { alignItems: 'flex-end' },
  figure: { fontVariant: ['tabular-nums'] },
});

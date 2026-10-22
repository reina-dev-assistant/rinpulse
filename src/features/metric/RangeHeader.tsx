import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { Segmented } from '@/components/Segmented';
import { METRIC_RANGES, type MetricRange } from '@/features/metric/range';
import { HIT, spacing, useColors } from '@/theme';

interface RangeHeaderProps {
  range: MetricRange;
  onRange: (range: MetricRange) => void;
  /** The period in words: "Today", "19 - 25 Oct", "October 2026", "2026". */
  label: string;
  onPrev: () => void;
  /** Null when the period already holds today: there is nothing later. */
  onNext: (() => void) | null;
  /** Null when the period already holds today. */
  onToday: (() => void) | null;
}

/**
 * The top of every metric detail screen: Day / Week / Month / 3 months / Year, and under it the period with step-back, step-forward
 * and a way back to today. Each button is a 48 dp target; stepping forward is absent (dimmed) on the current period, never a dead end.
 */
export function RangeHeader({ range, onRange, label, onPrev, onNext, onToday }: RangeHeaderProps) {
  const { t } = useTranslation('common');
  const colors = useColors();
  const options = METRIC_RANGES.map((value) => ({ value, label: t(`metric.range.${value}`) }));
  return (
    <View style={styles.wrap}>
      <Segmented options={options} value={range} onChange={onRange} />
      <View style={styles.period}>
        <PressableScale accessibilityRole="button" accessibilityLabel={t('metric.previous')} onPress={onPrev} style={styles.step}>
          <Ionicons name="chevron-back" size={22} color={colors.foreground} />
        </PressableScale>
        <View style={styles.label} accessibilityRole="header" accessibilityLiveRegion="polite">
          <AppText variant="bodyStrong" numberOfLines={1}>
            {label}
          </AppText>
        </View>
        {onToday ? (
          <PressableScale accessibilityRole="button" accessibilityLabel={t('metric.backToToday')} hitSlop={{ top: 4, bottom: 4 }} onPress={onToday} style={styles.today}>
            <AppText variant="label" color={colors.linkText}>
              {t('time.today')}
            </AppText>
          </PressableScale>
        ) : null}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('metric.next')}
          accessibilityState={{ disabled: onNext === null }}
          disabled={onNext === null}
          onPress={onNext ?? undefined}
          style={styles.step}>
          <Ionicons name="chevron-forward" size={22} color={colors.foreground} />
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  period: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  step: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, alignItems: 'center' },
  today: { minHeight: 40, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
});

import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BarReadout, useBarScrub } from '@/components/BarChart';
import type { HourStages, NightStage } from '@/features/sleep/nights';
import { fmtClock, useTranslation } from '@/i18n';
import { STAGE_LABELS, stageColor } from '@/features/sleep/stageStyle';
import { useColors } from '@/theme';

const BAR_AREA_HEIGHT = 120;
/** Stacking order from the floor up: deepest sleep at the bottom, awake on top. */
const STACK: readonly NightStage[] = ['deep', 'light', 'asleep', 'rem', 'awake'];

/** One bar per clock hour, full height = 60 minutes, split into the minutes of each stage. Plain Views. */
export function HourlyStages({ hours }: { hours: readonly HourStages[] }) {
  const { t } = useTranslation('health');
  const colors = useColors();
  const labelEvery = hours.length > 10 ? 2 : 1;
  const lines = hours.map((h) => {
    const parts = STACK.filter((s) => h.seconds[s] >= 60).map((s) => t('hourly.part', { stage: STAGE_LABELS[s], minutes: Math.round(h.seconds[s] / 60) }));
    return { title: fmtClock(h.hour), text: parts.length > 0 ? parts.join(', ') : t('hourly.none') };
  });
  const scrub = useBarScrub(hours.length, hours);
  const picked = scrub.selected !== null ? lines[scrub.selected]! : null;

  return (
    <View style={styles.wrap}>
      <BarReadout title={picked?.title ?? null} text={picked?.text ?? null} color={colors.foreground} />
      <View {...scrub.touch} style={styles.bars}>
        {hours.map((h, i) => (
          <View
            key={h.hour}
            accessible
            accessibilityLabel={t('hourly.line', { hour: lines[i]!.title, parts: lines[i]!.text })}
            style={[styles.slot, { backgroundColor: colors.muted, opacity: scrub.selected !== null && scrub.selected !== i ? 0.5 : 1 }]}>
            {STACK.map((stage) =>
              h.seconds[stage] > 0 ? (
                <View
                  key={stage}
                  style={{ height: (Math.min(h.seconds[stage], 3600) / 3600) * BAR_AREA_HEIGHT, backgroundColor: stageColor(stage, colors) }}
                />
              ) : null,
            )}
          </View>
        ))}
      </View>
      <View style={styles.axis}>
        {hours.map((h, i) => (
          <View key={h.hour} style={styles.axisSlot}>
            {i % labelEvery === 0 ? (
              <AppText variant="caption" muted numberOfLines={1} style={styles.tick}>
                {new Date(h.hour * 1000).getHours()}
              </AppText>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  bars: { flexDirection: 'row', height: BAR_AREA_HEIGHT, gap: 4 },
  // column-reverse stacks the first stage at the floor.
  slot: { flex: 1, flexDirection: 'column-reverse', borderRadius: 4, overflow: 'hidden' },
  axis: { flexDirection: 'row', gap: 4 },
  axisSlot: { flex: 1, alignItems: 'center' },
  tick: { fontSize: 11, lineHeight: 15 },
});

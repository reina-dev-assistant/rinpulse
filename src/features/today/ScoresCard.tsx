import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { CountUpText, FadeIn } from '@/components/motion';
import { PressableScale } from '@/components/PressableScale';
import { Ring } from '@/components/Ring';
import { Card } from '@/components/Screen';
import type { Readiness } from '@/features/today/readiness';
import { STRAIN_MAX, type DayStrain } from '@/features/today/strain';
import { headlineLabel } from '@/features/today/readiness';
import { recoveryWaitHint, sleepWaitHint, strainWaitHint, type GaugeWait } from '@/features/today/scoresHints';
import { fmtDecimal, fmtPercent } from '@/i18n';
import { spacing, useColors } from '@/theme';

const SIZE = 84;
const STROKE = 7;

/**
 * Today at a glance: recovery (or the readiness word until HRV has a baseline), strain, and sleep against need, side by
 * side. The whole card opens the Readiness screen, where each number is explained; Today itself stays short.
 *
 * A gauge with nothing to show goes grey and says what is missing under its label (how many more nights the recovery baseline
 * needs, no heart rate yet today, no sleep stored) instead of a bare `--`.
 */
export function ScoresCard({ readiness, today, onPress }: { readiness: Readiness; today: DayStrain | null; onPress: () => void }) {
  const colors = useColors();
  const { t } = useTranslation('today');
  const sleep = readiness.signals.find((s) => s.key === 'sleep') ?? null;
  const recovery = readiness.recovery;
  // Without recovery, the ring fills with the share of signals that look good (neutral counts half); the word is the read.
  const fill = readiness.signals.length
    ? readiness.signals.reduce((a, s) => a + (s.tone === 'good' ? 1 : s.tone === 'neutral' ? 0.5 : 0), 0) / readiness.signals.length
    : 0;
  const readinessColor =
    readiness.headline === 'Primed' || readiness.headline === 'Balanced'
      ? colors.link
      : readiness.headline
        ? colors.heart
        : colors.mutedForeground;
  const recoveryColor = recovery
    ? recovery.band === 'green'
      ? colors.link
      : recovery.band === 'yellow'
        ? colors.workouts
        : colors.heart
    : readinessColor;
  // Wait states: recovery missing. With a readiness word the ring keeps it and only the caption names what recovery lacks.
  const recoveryWait: GaugeWait | null = !recovery && readiness.recoveryWait ? recoveryWaitHint(readiness.recoveryWait, readiness.headline !== null) : null;
  const countingRecovery = !recovery && readiness.headline === null && recoveryWait?.progress != null;
  const strainWait = today ? null : strainWaitHint();
  const sleepWait = sleep ? null : sleepWaitHint();

  return (
    <FadeIn>
      <Card>
        <PressableScale
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={t('scores.a11y')}
          style={styles.row}>
          <Gauge
            label={recovery ? t('scores.recovery') : t('scores.readiness')}
            value={countingRecovery ? (recoveryWait?.progress ?? 0) : recovery ? recovery.percent : fill}
            max={recovery ? 100 : 1}
            color={recoveryColor}
            track={recovery || readiness.headline ? colors.linkSoft : colors.muted}
            center={
              recovery
                ? fmtPercent(recovery.percent)
                : readiness.headline
                  ? headlineLabel(readiness.headline)
                  : (recoveryWait?.center ?? '--')
            }
            count={recovery ? { value: recovery.percent, decimals: 0, suffix: '%' } : null}
            small={!recovery}
            hint={recoveryWait?.caption ?? null}
          />
          <Gauge
            label={t('scores.strain')}
            value={today?.strain ?? 0}
            max={STRAIN_MAX}
            color={today ? colors.workouts : colors.mutedForeground}
            track={today ? colors.workoutsSoft : colors.muted}
            center={today ? fmtDecimal(today.strain, 1) : '--'}
            count={today ? { value: Number(today.strain.toFixed(1)), decimals: 1, suffix: '' } : null}
            hint={strainWait?.caption ?? null}
          />
          <Gauge
            label={t('scores.sleep')}
            value={sleep?.amount ?? 0}
            max={1}
            color={sleep ? colors.sleep : colors.mutedForeground}
            track={sleep ? colors.sleepSoft : colors.muted}
            center={sleep ? fmtPercent(sleep.amount * 100) : '--'}
            count={sleep ? { value: Math.round(sleep.amount * 100), decimals: 0, suffix: '%' } : null}
            hint={sleepWait?.caption ?? null}
          />
        </PressableScale>
      </Card>
    </FadeIn>
  );
}

interface GaugeProps {
  label: string;
  value: number;
  max: number;
  color: string;
  track: string;
  /** What the ring says; also its accessibility label. */
  center: string;
  /** The number behind `center` when there is one, so it counts up as the ring fills; null shows `center` as is. */
  count: { value: number; decimals: number; suffix: string } | null;
  small?: boolean;
  /** What is missing while there is no number: one short line under the label. */
  hint?: string | null;
}

function Gauge(props: GaugeProps) {
  const variant = props.small ? 'label' : 'heading';
  return (
    <View style={styles.gauge}>
      <Ring size={SIZE} stroke={STROKE} value={props.value} max={props.max} color={props.color} track={props.track} accessibilityLabel={props.hint ? `${props.label} ${props.center}, ${props.hint}` : `${props.label} ${props.center}`}>
        {props.count ? (
          <CountUpText
            variant={variant}
            value={props.count.value}
            decimals={props.count.decimals}
            suffix={props.count.suffix}
            numberOfLines={1}
            adjustsFontSizeToFit
            style={styles.center}
          />
        ) : (
          <AppText variant={variant} numberOfLines={1} adjustsFontSizeToFit style={styles.center}>
            {props.center}
          </AppText>
        )}
      </Ring>
      <AppText variant="caption" muted>
        {props.label}
      </AppText>
      {props.hint ? (
        <AppText variant="caption" muted numberOfLines={3} style={styles.hint}>
          {props.hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  gauge: { flex: 1, alignItems: 'center', gap: spacing.xs },
  hint: { textAlign: 'center', fontSize: 12, lineHeight: 15 },
  center: { maxWidth: SIZE - 2 * STROKE - 8, textAlign: 'center', fontVariant: ['tabular-nums'] },
});

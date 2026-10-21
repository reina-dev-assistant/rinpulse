import { Ionicons } from '@expo/vector-icons';
import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { IconName } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { StatusDot } from '@/components/StatusDot';
import { HIT, spacing, useTheme } from '@/theme';

export interface PillSegment {
  key: string;
  /** What the segment says, short enough for a third of a phone's width. */
  label: string;
  /** The same in full, with the state, for screen readers. */
  a11yLabel: string;
  /** A state dot (solid when `on`, hollow when not; it also pulses when `pulse`, for a link that is up) or an icon in front of the label. */
  lead: { kind: 'dot'; color: string; on: boolean; pulse?: boolean } | { kind: 'icon'; icon: IconName };
  /** The segment reads as secondary (nothing connected, permission off). */
  quiet?: boolean;
  /** A segment with no action is plain text; one with an action is a button. */
  onPress?: () => void;
  /** The state changes under the person's eyes (a GPS signal arriving): read it out when it does. */
  live?: boolean;
}

interface StatusPillProps {
  segments: readonly PillSegment[];
}

/**
 * The few facts that decide whether a recording will work, in one floating pill above the map: the GPS signal, the sensors that will
 * connect, the phone's step counter. Each segment is 48 dp tall; the ones with an action open the screen or question behind them.
 */
export function StatusPill({ segments }: StatusPillProps) {
  const { colors, radius } = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: colors.card, borderColor: colors.hairline, borderRadius: Math.min(radius.bar, HIT / 2) }]}>
      {segments.map((segment, index) => (
        <Fragment key={segment.key}>
          {index > 0 ? <View style={[styles.divider, { backgroundColor: colors.hairline }]} /> : null}
          <Segment segment={segment} />
        </Fragment>
      ))}
    </View>
  );
}

function Segment({ segment }: { segment: PillSegment }) {
  const { colors } = useTheme();
  const body = (
    <>
      {segment.lead.kind === 'dot' ? (
        segment.lead.pulse ? (
          <View style={styles.dotBox}>
            <StatusDot color={segment.lead.color} live={segment.lead.on} size={8} />
          </View>
        ) : (
          <View style={styles.dotBox}>
            <View
              style={[
                styles.dot,
                segment.lead.on
                  ? { backgroundColor: segment.lead.color }
                  : { borderWidth: 2, borderColor: segment.lead.color },
              ]}
            />
          </View>
        )
      ) : (
        <Ionicons name={segment.lead.icon} size={16} color={segment.quiet ? colors.mutedForeground : colors.foreground} />
      )}
      <AppText variant="label" numberOfLines={1} color={segment.quiet ? colors.mutedForeground : colors.foreground} style={styles.label}>
        {segment.label}
      </AppText>
    </>
  );
  if (!segment.onPress) {
    return (
      <View accessible accessibilityLabel={segment.a11yLabel} accessibilityLiveRegion={segment.live ? 'polite' : undefined} style={styles.segment}>
        {body}
      </View>
    );
  }
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={segment.a11yLabel}
      onPress={segment.onPress}
      scaleTo={0.96}
      style={styles.segment}>
      {body}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: HIT,
    borderWidth: StyleSheet.hairlineWidth,
    // The pill floats over a map, so it needs one short lift to stay readable on it; no glow.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  segment: {
    flexShrink: 1,
    minHeight: HIT,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: { flexShrink: 1 },
  divider: { width: StyleSheet.hairlineWidth, height: 20 },
  dotBox: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});

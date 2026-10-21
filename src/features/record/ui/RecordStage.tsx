import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FadeIn } from '@/components/motion';
import { PressableScale } from '@/components/PressableScale';
import { HIT, spacing, useTheme } from '@/theme';

import { StatusPill, type PillSegment } from './StatusPill';

/** How far the sheet's rounded top corners reach up over the backdrop. */
function useSheetOverlap(): number {
  return useTheme().radius.card;
}

/**
 * What the backdrop has to keep its own overlays out of: the back button and the pill above (`top`), the sheet's rounded corners
 * below (`bottom`). The map's follow button and credit move by these.
 */
export function useStageInset(): { top: number; bottom: number } {
  const insets = useSafeAreaInsets();
  return { top: insets.top + spacing.sm + HIT + spacing.sm, bottom: useSheetOverlap() };
}

interface RecordStageProps {
  onBack: () => void;
  segments: readonly PillSegment[];
  /** Fills the screen above the sheet: the map, or the figures of a sport without GPS. */
  backdrop: ReactNode;
  /** The bottom sheet's content. */
  children: ReactNode;
}

/**
 * The shared frame of the recording screens before the clock runs: a backdrop that fills the screen, a back button and the status pill
 * floating over its top, and a sheet of the screen's own colour rising from the bottom with the controls. The sheet takes the height its
 * content needs; the backdrop gets the rest.
 */
export function RecordStage({ onBack, segments, backdrop, children }: RecordStageProps) {
  const { t } = useTranslation('common');
  const { colors, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const overlap = useSheetOverlap();

  return (
    <View style={[styles.stage, { backgroundColor: colors.background }]}>
      <View style={styles.top}>
        {backdrop}
        <View style={[styles.bar, { top: insets.top + spacing.sm }]}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('actions.back')}
            onPress={onBack}
            style={[styles.back, { backgroundColor: colors.card, borderColor: colors.hairline }]}>
            <Ionicons name="chevron-back" size={24} color={colors.foreground} />
          </PressableScale>
          <StatusPill segments={segments} />
        </View>
      </View>
      <FadeIn distance={24} style={[styles.rise, { marginTop: -overlap }]}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderTopLeftRadius: radius.card,
              borderTopRightRadius: radius.card,
              borderColor: colors.hairline,
              paddingBottom: insets.bottom + spacing.md,
            },
          ]}>
          {children}
        </View>
      </FadeIn>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
  top: { flex: 1, minHeight: 0 },
  bar: { position: 'absolute', left: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: {
    width: HIT,
    height: HIT,
    borderRadius: HIT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    // Floats over a map like the pill: one short lift, no glow.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  rise: { flexShrink: 0 },
  sheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
});

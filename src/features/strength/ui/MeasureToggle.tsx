import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { spacing, useColors } from '@/theme';

interface MeasureToggleProps {
  /** true = measured in seconds. */
  timed: boolean;
  /** Exercise name, for the screen reader. */
  name: string;
  onChange: (timed: boolean) => void;
}

/** Repetisi / Waktu: how an exercise is counted. Small enough for the chip row of an exercise card; the selected side is filled, not only recoloured. */
function MeasureToggleView({ timed, name, onChange }: MeasureToggleProps) {
  const { t } = useTranslation('strength');
  const colors = useColors();
  const options = [
    { timed: false, label: t('table.reps') },
    { timed: true, label: t('table.time') },
  ] as const;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('measure.label', { name })} style={[styles.track, { backgroundColor: colors.muted }]}>
      {options.map((option) => {
        const selected = option.timed === timed;
        return (
          <PressableScale
            key={String(option.timed)}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            hitSlop={{ top: 8, bottom: 8 }}
            scaleTo={0.96}
            onPress={() => {
              if (!selected) onChange(option.timed);
            }}
            style={[styles.option, selected && { backgroundColor: colors.primary }]}>
            <AppText variant="label" color={selected ? colors.primaryForeground : colors.mutedForeground}>
              {option.label}
            </AppText>
          </PressableScale>
        );
      })}
    </View>
  );
}

export const MeasureToggle = memo(MeasureToggleView);

const styles = StyleSheet.create({
  track: { flexDirection: 'row', alignItems: 'center', padding: 2, borderRadius: 16, gap: 2 },
  option: { minHeight: 28, minWidth: 72, paddingHorizontal: spacing.md, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
